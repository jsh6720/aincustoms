const { deliverMailDigestOnce, pages, preflight, skipped } = require("./cargo-mail-digest");
const { buildMissingWarehousePlanMail, missingPlanIdentity } = require("./cargo-missing-warehouse-plan-notification");
const TYPE = "warehouse_plan_missing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = value => String(value || "").trim();
const blKey = value => clean(value).replace(/\s+/g, "").toUpperCase();
const truthy = value => value === true || ["true", "1", "yes"].includes(clean(value).toLowerCase());
const retryable = row => ["pending", "failed"].includes(row.status);

function parseDate(value) {
  const text = clean(value);
  const date = /^\d{8}$/.test(text) ? text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6) : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return null;
  return new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date ? date : null;
}
function currentMissingPlanSnapshot(event, card, input, lifecycle, today) {
  if (!card || !input || truthy(input.is_hidden) || truthy(lifecycle?.source_missing)
      || truthy(lifecycle?.permanently_excluded)) return null;
  const releaseDate = parseDate(card.last_release_date);
  if (truthy(card.fully_released) && releaseDate && (Date.parse(today) - Date.parse(releaseDate)) / 86400000 > 7) return null;
  const oblDate = parseDate(input.obl_carrier_submitted_date);
  // Match the existing NEWMAIN priority: customs arrival, manual ETA, then card ETA.
  const arrival = parseDate(card.entry_date) || parseDate(input.eta_date) || parseDate(card.eta_date);
  if (!oblDate || !arrival) return null;
  const days = (Date.parse(arrival) - Date.parse(today)) / 86400000;
  if (days < 0 || days > 3) return null;
  const fields = [];
  if (!clean(input.storage_yard)) fields.push("반입예정구역");
  if (!clean(input.warehouse_expected_date)) fields.push("반입예정일");
  if (!fields.length) return null;
  const current = { ...event.card_snapshot, ...card, obl_carrier_submitted_date: oblDate,
    arrival_notice_date: arrival, missing_warehouse_plan_fields: fields, notice_date: today };
  if (JSON.stringify(missingPlanIdentity(current)) !== JSON.stringify(missingPlanIdentity(event.card_snapshot))) return null;
  return current;
}

async function deliverMissingWarehousePlanDigest({ db, eventId, sendMail, now = new Date() }) {
  if (!UUID.test(eventId)) throw preflight("알림 식별자가 올바르지 않습니다.");
  const [root] = await db("/rest/v1/cargo_status_notifications?select=*&id=eq." + eventId);
  if (!root || root.event_type !== TYPE) throw preflight("반입예정정보 확인 알림을 찾을 수 없습니다.");
  if (!retryable(root)) return skipped(root.status);
  const account = clean(root.account_id);
  if (!UUID.test(account) || root.card_snapshot?.account_id !== account) throw preflight("알림 화주가 올바르지 않습니다.");
  const [owner] = await db("/rest/v1/shipper_accounts?select=id,login_id&id=eq." + account);
  if (clean(owner?.login_id).toUpperCase() !== "HCH") throw preflight("HCH 반입예정정보 알림이 아닙니다.");
  const kst = new Date(now.getTime() + 9 * 3600000), today = kst.toISOString().slice(0, 10);
  if (kst.getUTCHours() < 9 || root.card_snapshot?.notice_date !== today) return skipped();
  const validEvent = event => UUID.test(event.id) && event.account_id === account && event.event_type === TYPE
    && retryable(event) && event.card_snapshot?.account_id === account && event.card_snapshot?.notice_date === today
    && blKey(event.bl_number) === blKey(event.card_snapshot?.bl_number)
    && event.event_key === "hch:" + TYPE + ":" + blKey(event.bl_number) + ":" + today;
  if (!validEvent(root)) return skipped();
  const query = new URLSearchParams({ select: "*", account_id: "eq." + account, event_type: "eq." + TYPE,
    status: "in.(pending,failed)", "card_snapshot->>notice_date": "eq." + today, order: "id.asc" });
  const events = await pages(db, "/rest/v1/cargo_status_notifications?" + query);
  const scope = "&account_id=eq." + account + "&order=bl_number.asc";
  const cards = await pages(db, "/rest/v1/cargo_cards?select=bl_number,consignee,destination,entry_date,eta_date,fully_released,last_release_date" + scope);
  const inputs = await pages(db, "/rest/v1/cargo_card_user_inputs?select=bl_number,is_hidden,eta_date,obl_carrier_submitted_date,storage_yard,warehouse_expected_date" + scope);
  const lifecycle = await pages(db, "/rest/v1/cargo_card_lifecycle?select=bl_number,source_missing,permanently_excluded" + scope);
  const index = rows => new Map(rows.map(row => [blKey(row.bl_number), row]));
  const cardByBl = index(cards), inputByBl = index(inputs), lifecycleByBl = index(lifecycle);
  const group = [];
  for (const event of events) {
    if (!validEvent(event) || JSON.stringify(missingPlanIdentity(event.card_snapshot)) !== JSON.stringify(missingPlanIdentity(root.card_snapshot))) continue;
    const bl = blKey(event.bl_number);
    const snapshot = currentMissingPlanSnapshot(event, cardByBl.get(bl), inputByBl.get(bl), lifecycleByBl.get(bl), today);
    if (snapshot) group.push({ ...event, card_snapshot: snapshot });
  }
  if (!group.some(event => event.id === root.id)) return skipped();
  buildMissingWarehousePlanMail(group.map(row => row.card_snapshot));
  // This event type has a single fixed internal recipient list in its existing API sender.
  return deliverMailDigestOnce({ db, group, sendMail, now });
}

module.exports = { deliverMissingWarehousePlanDigest, currentMissingPlanSnapshot, parseDate };
