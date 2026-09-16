const { randomUUID } = require("node:crypto");
const { deliverClaimedMailOnce } = require("./cargo-automatic-mail-dedupe");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function preflight(message) {
  return Object.assign(new Error(message), { smtpDeliveryAttempted: false });
}
function skipped(status = "skipped") {
  return { sent: false, deduplicated: true, status, deliveryUncertain: status === "delivery_uncertain",
    message: "이미 처리 중이거나 현재 발송 대상이 아닙니다." };
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
async function deliverMailDigestOnce({ db, group, sendMail, now = new Date() }) {
  if (!group.length) return skipped();
  const { account_id: accountId, event_type: eventType } = group[0];
  if (!UUID.test(accountId) || !/^[a-z_]+$/.test(eventType)
      || group.some(row => !UUID.test(row.id) || row.account_id !== accountId || row.event_type !== eventType)) {
    throw preflight("통합 발송 식별정보가 올바르지 않습니다.");
  }
  const token = randomUUID(), stamp = now.toISOString();
  const claimPath = "/rest/v1/cargo_status_notifications?id=in.(" + group.map(row => row.id).sort().join(",")
    + ")&status=in.(pending,failed)&account_id=eq." + accountId + "&event_type=eq." + eventType;
  // One conditional UPDATE claims all available rows, including concurrent callers' overlap.
  const claims = await db(claimPath, { method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "sending", claim_token: token, claimed_at: stamp, last_attempt_at: stamp, error_message: null }) });
  if (!claims?.length) return skipped();
  if (claims.some(row => row.claim_token !== token || !group.some(source => source.id === row.id))) {
    throw preflight("발송 잠금 검증에 실패했습니다.");
  }
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
    info = await sendMail(claimedRows.map(row => row.card_snapshot));
    return info;
  })();
  // A single SMTP promise, but each original B/L retains its own settlement record.
  const results = await Promise.allSettled(claimedRows.map(claim => deliverClaimedMailOnce({
    supabaseFetch: db, claim, sendMail: () => smtp.catch(error => { throw Object.assign(new Error(error.message), error); }),
  })));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  const uncertain = results.some(result => result.value.deliveryUncertain);
  return { sent: !uncertain, deduplicated: false, deliveryUncertain: uncertain,
    status: uncertain ? "delivery_uncertain" : "sent",
    count: new Set(claimedRows.map(row => String(row.bl_number || "").trim().toUpperCase())).size,
    messageId: info?.messageId || null,
    message: uncertain ? "전달 결과를 확인해야 하므로 자동 재발송을 중단했습니다." : "통합 안내메일 발송 완료" };
}

module.exports = { deliverMailDigestOnce, pages, preflight, skipped };
