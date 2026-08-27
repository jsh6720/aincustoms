const crypto = require("crypto");
const { deliverClaimedMailOnce } = require("./cargo-automatic-mail-dedupe");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value ?? null;
}

function normalizeBlNumber(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function buildManualMailEventKey({ mailType, accountId, blNumber, businessPayload }) {
  const canonical = JSON.stringify(stableValue({
    mail_type: String(mailType || "").trim(),
    account_id: String(accountId || "").trim(),
    bl_number: normalizeBlNumber(blNumber),
    payload: businessPayload || {},
  }));
  return `manual_mail:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

async function deliverManualMailOnce({
  supabaseFetch,
  mailType,
  accountId,
  blNumber,
  businessPayload,
  cardSnapshot = {},
  send,
}) {
  const eventKey = buildManualMailEventKey({ mailType, accountId, blNumber, businessPayload });
  const claimedRows = await supabaseFetch("/rest/v1/rpc/claim_cargo_manual_mail", {
    method: "POST",
    body: JSON.stringify({
      p_event_key: eventKey,
      p_account_id: accountId,
      p_bl_number: normalizeBlNumber(blNumber),
      p_detected_status: String(mailType || "manual_mail"),
      p_card_snapshot: {
        mail_type: mailType,
        business_payload: businessPayload || {},
        card: cardSnapshot || {},
      },
    }),
  });
  const claim = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!claim?.claimed) {
    return {
      sent: false,
      deduplicated: true,
      deliveryUncertain: claim?.status === "delivery_uncertain",
      eventId: claim?.id || null,
      status: claim?.status || null,
      message: claim?.status === "delivery_uncertain"
        ? "이전 메일의 전달 결과를 확인해야 하므로 재발송하지 않았습니다."
        : "동일한 내용의 메일이 이미 발송되었거나 발송 처리 중입니다.",
    };
  }
  return deliverClaimedMailOnce({
    supabaseFetch,
    claim,
    sendMail: send,
  });
}

module.exports = { buildManualMailEventKey, deliverManualMailOnce };
