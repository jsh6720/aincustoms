const crypto = require("crypto");
const { destinationName } = require("./cargo-mail-utils");
const { buildManualMailEventKey } = require("./cargo-mail-dedupe");
const { classifySmtpFailure } = require("./cargo-automatic-mail-dedupe");
const { koreaDate } = require("./cargo-original-doc-receipt");

const text = (v) => String(v ?? "").trim();
function fail(message, httpStatus = 400, extra = {}) {
  return Object.assign(new Error(message), { httpStatus, ...extra });
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function documents(value) {
  if (!Array.isArray(value) || !value.includes("obl") || value.some(v => !["obl", "hc"].includes(v))) {
    throw fail("OBL 접수는 필수입니다. OBL을 포함하고 H/C는 추가로 선택해 주세요.");
  }
  return ["obl", "hc"].filter(v => value.includes(v));
}
function documentLabels(value) { return value.map(v => v === "obl" ? "OBL" : "H/C").join("·"); }

async function mapLimited(values, concurrency, operation) {
  let next = 0;
  const results = await Promise.allSettled(Array.from({length: Math.min(concurrency, values.length)}, async () => {
    while (next < values.length) {
      const index = next++;
      await operation(values[index], index);
    }
  }));
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
}
async function prepareBatch(body, { supabaseFetch, recipients }) {
  const carrier = body.action === "obl_carrier_batch";
  if (!["original_doc_batch", "obl_carrier_batch"].includes(body.action)) throw fail("지원하지 않는 묶음 유형입니다.");
  const date = text(body.date);
  if (!validDate(date) || date > koreaDate()) throw fail("수령·접수일을 오늘 또는 이전의 실제 날짜로 입력해 주세요.");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw fail("B/L을 1~50건 선택해 주세요.");
  const carrierName = text(body.carrier_name);
  const groupName = text(body.group_name);
  if (carrier && (!carrierName || carrierName.length > 80 || /[\r\n]/.test(carrierName))) throw fail("이번 묶음의 선사명을 입력해 주세요.");
  if (groupName.length > 80 || text(body.memo).length > 1500) throw fail("묶음명 또는 확인사항이 너무 깁니다.");
  const items = [];
  const seen = new Set();
  await mapLimited(body.items, 5, async input => {
    const account = text(input.account_id), bl = text(input.bl_number);
    const pages = Number(input.total_pages);
    if (!carrier && (!Number.isSafeInteger(pages) || pages < 1 || pages > 99999)) throw fail(bl + ": 원본서류 페이지를 1~99999의 정수로 입력해 주세요.");
    if (!account || !bl || account.length > 80 || bl.length > 80) throw fail("B/L 정보가 올바르지 않습니다.");
    const rows = await supabaseFetch(`/rest/v1/cargo_cards?select=*&account_id=eq.${encodeURIComponent(account)}&bl_number=eq.${encodeURIComponent(bl)}&limit=1`);
    const card = rows?.[0];
    if (!card) throw fail(`B/L을 찾지 못했습니다: ${bl}`, 404);
    const folder = text(card.folder_name);
    const linked = folder ? await supabaseFetch(`/rest/v1/cargo_cards?select=account_id,bl_number,folder_name&bl_number=eq.${encodeURIComponent(bl)}&folder_name=eq.${encodeURIComponent(folder)}`) : [card];
    const targets = [...new Set([card.account_id, ...(linked || []).map(v => v.account_id)])].sort();
    const source = `${bl.toUpperCase()}|${folder || targets[0]}`;
    if (seen.has(source)) throw fail(`같은 B/L이 두 번 선택되었습니다: ${bl}`);
    seen.add(source);
    const selected = carrier ? ["obl"] : documents(input.received_documents);
    const keys = selected.map(document => ({document, key: buildManualMailEventKey({
      mailType: "original_document_item_v1", accountId: source, blNumber: bl,
      businessPayload: { action: body.action, date, document },
    })}));
    items.push({ card, targets, documents: selected, keys, pages: carrier ? null : pages });
  });
  items.sort((a, b) => a.card.bl_number.localeCompare(b.card.bl_number));
  const consignee = text(items[0].card.consignee);
  if (!consignee || items.some(v => text(v.card.consignee) !== consignee)) throw fail("같은 화주의 B/L만 한 메일로 묶을 수 있습니다.");
  const allDocuments = ["obl", "hc"].filter(d => items.some(v => v.documents.includes(d)));
  const blNames = items.map(item => item.card.bl_number).join(", ");
  const subject = carrier
    ? `[OBL 선사 접수 확인] ${consignee} / ${blNames} / ${carrierName} / ${date} / ${items.length}건${groupName ? ` / ${groupName}` : ""}`
    : `[${documentLabels(allDocuments)} 원본서류 수령 확인] ${consignee} / ${blNames} / ${date} / ${items.length}건`;
  const lines = ["안녕하세요.", "", carrier ? "아래 건의 OBL 원본을 선사에 접수하였습니다." : "아래 건의 원본 서류를 수령하였습니다.",
    `${carrier ? "선사 접수일" : "수령일"}: ${date}`,
    ...(carrier ? [`선사: ${carrierName}`, ...(groupName ? [`접수 묶음: ${groupName}`] : [])] : [`수령한 원본 서류 페이지: ${items.map(item => item.pages).join(", ")} page (아래 B/L 순서)`]),
    `총 B/L: ${items.length}건`, ""];
  items.forEach((item, index) => lines.push(`[${index + 1}] B/L: ${item.card.bl_number}`,
    `화주명: ${consignee}`, `반출처: ${destinationName(item.card.destination)}`, `품명: ${item.card.product_name || "-"}`,
    ...(!carrier ? [`수령 서류: ${documentLabels(item.documents)}`, `원본 서류 페이지: ${item.pages} page`] : []), ""));
  lines.push("[확인사항]", text(body.memo) || "-", "", "감사합니다.", "아인합동관세사무소");
  const mail = { subject, text: lines.join("\n"), to: recipients.to, cc: recipients.cc };
  const token = crypto.createHash("sha256").update(JSON.stringify({ mail, keys: items.flatMap(v => v.keys.map(k => k.key)).sort() })).digest("hex");
  return { items, date, carrier, carrierName, groupName, mail, token };
}

async function settle(supabaseFetch, claim, status) {
  const rows = await supabaseFetch("/rest/v1/rpc/settle_cargo_mail", { method: "POST", body: JSON.stringify({
    p_event_id: claim.id, p_claim_token: claim.claim_token, p_status: status,
    p_error_message: status === "sent" ? null : "document_batch_delivery_status",
  }) });
  if (!(Array.isArray(rows) ? rows[0] : rows)?.settled) throw fail("메일 발송 상태를 확정하지 못했습니다.", 503);
}
async function saveBatchItem(item, batch, { supabaseFetch, loginId }) {
  for (const accountId of item.targets) {
    if (batch.carrier) {
      await supabaseFetch("/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number", { method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({
          account_id: accountId, bl_number: item.card.bl_number, obl_carrier_submitted: true,
          obl_carrier_submitted_date: batch.date, obl_carrier_submitted_by: loginId, obl_carrier_submitted_at: new Date().toISOString(),
        }) });
    } else {
      const existing = await supabaseFetch(`/rest/v1/cargo_original_docs?select=actual_received_date&account_id=eq.${encodeURIComponent(accountId)}&bl_number=eq.${encodeURIComponent(item.card.bl_number)}&limit=1`);
      const payload = { account_id: accountId, bl_number: item.card.bl_number, updated_by: loginId };
      for (const doc of item.documents) payload[`${doc}_received`] = true;
      if (!existing?.[0]?.actual_received_date) payload.actual_received_date = batch.date;
      await supabaseFetch("/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number", { method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
    }
  }
}

async function processBatch(body, deps) {
  const startedAt = Date.now();
  const batch = await prepareBatch(body, deps);
  if (body.preview === true) return { success: true, preview: true, mail: batch.mail, preview_token: batch.token, count: batch.items.length };
  if (body.preview_token !== batch.token) throw fail("발송 내용이 변경되었습니다. 메일 미리보기를 다시 확인해 주세요.", 409);
  const claims = [], blocked = [];
  try {
    const units = batch.items.flatMap(item => item.keys.map(unit => ({item, ...unit}))).sort((a,b) => a.key.localeCompare(b.key));
    for (const {item, key, document} of units) {
      if (Date.now() - startedAt > 35000) throw fail("조회가 지연되어 발송 전에 중단했습니다. 묶음 건수를 줄여 다시 시도해 주세요.", 503);
      const rows = await deps.supabaseFetch("/rest/v1/rpc/claim_cargo_manual_mail", { method: "POST", body: JSON.stringify({
        p_event_key: key, p_account_id: item.targets[0], p_bl_number: item.card.bl_number,
        p_detected_status: body.action, p_card_snapshot: { mail_type: body.action, business_payload: {
          date: batch.date, carrier_name: batch.carrierName, group_name: batch.groupName,
          batch_token: batch.token, documents: [document], bl_numbers: batch.items.map(v => v.card.bl_number),
        }, card: item.card },
      }) });
      const claim = Array.isArray(rows) ? rows[0] : rows;
      if (!claim?.claimed) blocked.push({ bl_number: item.card.bl_number, document, status: claim?.status || "unknown" });
      else {
        claims.push(claim);
        if (!claim.id || !claim.claim_token) throw fail("메일 원장 버전을 확인해 주세요.", 503);
      }
    }
  } catch (error) {
    await Promise.allSettled(claims.map(c => settle(deps.supabaseFetch, c, "failed")));
    throw error;
  }
  if (blocked.length) {
    await Promise.allSettled(claims.map(c => settle(deps.supabaseFetch, c, "failed")));
    if (blocked.length === batch.items.reduce((n, item) => n + item.keys.length, 0) && blocked.every(v => v.status === "sent")) {
      // Sending again never repairs status with a newly edited request.
      return { success: true, deduplicated: true, email_sent: false, state_saved: false, blocked,
        message: "선택한 B/L은 해당 날짜에 이미 안내했습니다. 중복 발송하지 않았습니다." };
    }
    throw fail("이미 안내했거나 발송 처리 중인 B/L이 있습니다. 표시된 B/L 또는 서류 종류를 제외하고 다시 미리보기해 주세요.", 409, { blocked });
  }
  if (Date.now() - startedAt > 35000) {
    await Promise.allSettled(claims.map(c => settle(deps.supabaseFetch, c, "failed")));
    throw fail("조회가 지연되어 발송 전에 중단했습니다. 묶음 건수를 줄여 다시 시도해 주세요.", 503);
  }
  let info;
  try { info = await deps.sendMail(batch.mail); }
  catch (error) {
    const status = classifySmtpFailure(error);
    const settled = await Promise.allSettled(claims.map(c => settle(deps.supabaseFetch, c, status)));
    const uncertain = status !== "failed" || settled.some(v => v.status === "rejected");
    throw fail(uncertain ? "메일 전달 결과 확인이 필요합니다. 자동 재발송하지 않습니다." : "발송 전에 메일 서버가 요청을 거절했습니다. 다시 시도할 수 있습니다.", 503, { deliveryUncertain: uncertain });
  }
  const uncertain = !!(info?.rejected?.length || info?.pending?.length);
  const settled = await Promise.allSettled(claims.map(c => settle(deps.supabaseFetch, c, uncertain ? "delivery_uncertain" : "sent")));
  if (uncertain || settled.some(v => v.status === "rejected")) return { success: false, delivery_uncertain: true, email_sent: false,
    message: "메일 전달 결과 확인이 필요합니다. 자동 재발송하지 않습니다." };
  const outcomes = new Map();
  await mapLimited(batch.items, 5, async item => {
    try { await saveBatchItem(item, batch, deps); outcomes.set(item, true); }
    catch { outcomes.set(item, false); }
  });
  const failed = batch.items.filter(item => !outcomes.get(item)).map(v => v.card.bl_number);
  return { success: !failed.length, email_sent: true, state_saved: !failed.length, count: batch.items.length, failed_bl_numbers: failed,
    message: failed.length ? `메일은 1통 발송됐지만 상태 저장에 실패했습니다: ${failed.join(", ")}. 메일을 다시 보내지 말고 해당 상태만 저장해 주세요.`
      : `${batch.items.length}건을 메일 1통으로 발송하고 ${batch.carrier ? "선사 접수" : "선택한 서류의 수령"} 상태를 저장했습니다.` };
}
module.exports = { prepareBatch, processBatch, validDate, saveBatchItem };
