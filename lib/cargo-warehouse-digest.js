const { scheduleIdentity, buildWarehouseScheduleMail } = require("./cargo-warehouse-schedule-notification");
const { deliverMailDigestOnce, pages, preflight, skipped } = require("./cargo-mail-digest");

const EVENT_TYPES = ["warehouse_arrival_eve", "warehouse_arrival_today"];
const TEST_TO = "jsh@aincustoms.com";
const RETRYABLE = ["pending", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const truthy = value => value === true || ["true", "1", "yes"].includes(String(value || "").toLowerCase());
const clean = value => String(value || "").trim();
const blKey = value => clean(value).toUpperCase();
const yardKey = value => clean(value).replace(/\s+/g, "").toUpperCase();

function isTest(row) {
  return row.card_snapshot?.warehouse_digest_test === true
    && clean(row.event_key).startsWith("test:warehouse-digest:");
}
function recipientKey(recipients) {
  return JSON.stringify(["to", "cc"].map(key => [...new Set((recipients[key] || []).map(v => clean(v).toLowerCase()))].sort()));
}
function groupKey(row, recipients) {
  return JSON.stringify([row.event_type, row.account_id, ...scheduleIdentity(row.card_snapshot), isTest(row), recipientKey(recipients)]);
}
function currentSnapshot(row, card, manual, lifecycle, nowDate) {
  const snapshot = row.card_snapshot || {};
  if (!card || !manual || truthy(manual.is_hidden) || truthy(lifecycle?.source_missing)
      || truthy(lifecycle?.permanently_excluded)) return null;
  if (truthy(card.fully_released) && card.last_release_date
      && (Date.parse(nowDate) - Date.parse(card.last_release_date.slice(0, 10))) / 86400000 > 7) return null;
  // A changed plan gets its own event from the existing scanner. Never send the old snapshot.
  if (clean(manual.warehouse_expected_date) !== clean(snapshot.warehouse_expected_date)
      || !clean(manual.storage_yard) || yardKey(manual.storage_yard) !== yardKey(snapshot.planned_storage_yard)) return null;
  if (JSON.stringify(scheduleIdentity({ ...card, warehouse_expected_date: manual.warehouse_expected_date }))
      !== JSON.stringify(scheduleIdentity(snapshot))) return null;
  return { ...snapshot, planned_storage_yard: manual.storage_yard };
}

async function deliverWarehouseDigest({ db, eventId, resolveRecipients, sendMail, now = new Date() }) {
  if (!UUID.test(eventId)) throw preflight("알림 식별자가 올바르지 않습니다.");
  const [root] = await db("/rest/v1/cargo_status_notifications?select=*&id=eq." + eventId);
  if (!root || !EVENT_TYPES.includes(root.event_type)) throw preflight("입고 일정 알림을 찾을 수 없습니다.");
  if (!RETRYABLE.includes(root.status)) return skipped(root.status);
  const accountId = clean(root.account_id);
  if (!UUID.test(accountId) || root.card_snapshot?.account_id !== accountId) throw preflight("알림 화주가 올바르지 않습니다.");
  const [account] = await db("/rest/v1/shipper_accounts?select=id,login_id&id=eq." + accountId);
  if (clean(account?.login_id).toUpperCase() !== "HCH") throw preflight("HCH 입고 알림이 아닙니다.");
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const expected = new Date(Date.parse(today) + (root.event_type === EVENT_TYPES[0] ? 86400000 : 0)).toISOString().slice(0, 10);
  if (root.card_snapshot?.warehouse_expected_date !== expected) return skipped();
  const filter = new URLSearchParams({ select: "*", account_id: "eq." + accountId,
    event_type: "eq." + root.event_type, status: "in.(pending,failed)",
    "card_snapshot->>warehouse_expected_date": "eq." + expected, order: "id.asc" });
  const events = await pages(db, "/rest/v1/cargo_status_notifications?" + filter);
  const accountFilter = "&account_id=eq." + accountId + "&order=bl_number.asc";
  const cards = await pages(db, "/rest/v1/cargo_cards?select=bl_number,consignee,destination,fully_released,last_release_date" + accountFilter);
  const inputs = await pages(db, "/rest/v1/cargo_card_user_inputs?select=bl_number,is_hidden,warehouse_expected_date,storage_yard" + accountFilter);
  const lifecycle = await pages(db, "/rest/v1/cargo_card_lifecycle?select=bl_number,source_missing,permanently_excluded" + accountFilter);
  const index = rows => new Map(rows.map(row => [blKey(row.bl_number), row]));
  const cardByBl = index(cards), inputByBl = index(inputs), lifecycleByBl = index(lifecycle);
  const candidates = [];
  for (const event of events) {
    if (!UUID.test(event.id) || event.account_id !== accountId || event.event_type !== root.event_type
        || !RETRYABLE.includes(event.status) || isTest(event) !== isTest(root)
        || event.card_snapshot?.account_id !== accountId
        || blKey(event.bl_number) !== blKey(event.card_snapshot?.bl_number)) continue;
    if (JSON.stringify(scheduleIdentity(event.card_snapshot)) !== JSON.stringify(scheduleIdentity(root.card_snapshot))) continue;
    const key = blKey(event.bl_number);
    const snapshot = currentSnapshot(event, cardByBl.get(key), inputByBl.get(key), lifecycleByBl.get(key), today);
    if (!snapshot) continue;
    const recipients = isTest(event) ? { to: [TEST_TO], cc: [] } : await resolveRecipients(snapshot);
    if (!recipients.to?.length) throw preflight("입고 일정 수신처가 없습니다.");
    candidates.push({ ...event, card_snapshot: snapshot, recipients });
  }
  const target = candidates.find(row => row.id === root.id);
  if (!target) return skipped();
  const group = candidates.filter(row => groupKey(row, row.recipients) === groupKey(target, target.recipients));
  // Check all rows before claiming. No live changes or SMTP on invalid input.
  buildWarehouseScheduleMail(root.event_type, group.map(row => row.card_snapshot));
  return deliverMailDigestOnce({ db, group, now,
    sendMail: snapshots => sendMail(root.event_type, snapshots, target.recipients, isTest(root)) });
}

module.exports = { deliverWarehouseDigest, recipientKey, groupKey, currentSnapshot, isTest };
