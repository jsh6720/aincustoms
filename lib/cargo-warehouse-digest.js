const { randomUUID } = require("node:crypto");
const { scheduleIdentity, buildWarehouseScheduleMail } = require("./cargo-warehouse-schedule-notification");
const { deliverClaimedMailOnce } = require("./cargo-automatic-mail-dedupe");

const EVENT_TYPES = ["warehouse_arrival_eve", "warehouse_arrival_today"];
const TEST_TO = "jsh@aincustoms.com";
const RETRYABLE = ["pending", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const truthy = value => value === true || ["true", "1", "yes"].includes(String(value || "").toLowerCase());
const clean = value => String(value || "").trim();
const blKey = value => clean(value).toUpperCase();
const yardKey = value => clean(value).replace(/\s+/g, "").toUpperCase();

function preflight(message) {
  const error = new Error(message);
  error.smtpDeliveryAttempted = false;
  return error;
}
function skipped(status = "skipped") {
  return { sent: false, deduplicated: true, status, deliveryUncertain: status === "delivery_uncertain",
    message: "이미 처리 중이거나 현재 발송 대상이 아닙니다." };
}
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
async function pages(db, path) {
  const result = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const rows = await db(path + "&limit=200&offset=" + offset);
    if (!Array.isArray(rows)) throw preflight("알림 목록을 확인하지 못했습니다.");
    result.push(...rows);
    if (rows.length < 200) return result;
  }
  throw preflight("통합 대상이 너무 많아 발송을 중단했습니다.");
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
  const token = randomUUID(), stamp = now.toISOString();
  const claimPath = "/rest/v1/cargo_status_notifications?id=in.(" + group.map(row => row.id).sort().join(",")
    + ")&status=in.(pending,failed)&account_id=eq." + accountId + "&event_type=eq." + root.event_type;
  // One conditional UPDATE transaction claims the whole set; concurrent callers cannot claim the same row.
  const claims = await db(claimPath, { method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "sending", claim_token: token, claimed_at: stamp, last_attempt_at: stamp, error_message: null }) });
  if (!claims?.length) return skipped();
  if (claims.some(row => row.claim_token !== token || !group.some(source => source.id === row.id))) throw preflight("발송 잠금 검증에 실패했습니다.");
  const claimedRows = claims.map(claim => ({ ...claim, card_snapshot: group.find(row => row.id === claim.id).card_snapshot }));
  let info;
  const smtp = (async () => {
    try {
      await Promise.all(claims.map(row =>
        db("/rest/v1/cargo_status_notifications?id=eq." + row.id + "&claim_token=eq." + token + "&status=eq.sending",
          { method: "PATCH", body: JSON.stringify({ attempt_count: Number(row.attempt_count || 0) + 1 }) })
      ));
    } catch {
      throw preflight("메일 발송 이력을 준비하지 못했습니다.");
    }
    info = await sendMail(root.event_type, claimedRows.map(row => row.card_snapshot), target.recipients, isTest(root));
    return info;
  })();
  // Share one SMTP operation, but settle each existing B/L event with its own claim token.
  const results = await Promise.allSettled(claimedRows.map(claim => deliverClaimedMailOnce({
    supabaseFetch: db, claim, sendMail: () => smtp.catch(error => { throw Object.assign(new Error(error.message), error); }),
  })));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  const deliveries = results.map(result => result.value);
  const uncertain = deliveries.some(result => result.deliveryUncertain);
  return { sent: !uncertain, deduplicated: false, deliveryUncertain: uncertain,
    status: uncertain ? "delivery_uncertain" : "sent", count: new Set(claimedRows.map(row => blKey(row.bl_number))).size,
    messageId: info?.messageId || null,
    message: uncertain ? "전달 결과를 확인해야 하므로 자동 재발송을 중단했습니다." : "통합 안내메일 발송 완료" };
}

module.exports = { deliverWarehouseDigest, recipientKey, groupKey, currentSnapshot, isTest };
