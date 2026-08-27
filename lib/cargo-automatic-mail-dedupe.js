const KNOWN_PRE_ACCEPTANCE_CODES = new Set([
  "EAUTH",
  "EENVELOPE",
  "EMESSAGE",
  "ERECIPIENT",
]);

function countAddresses(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeCode(value) {
  const code = String(value || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return code.slice(0, 40) || "UNKNOWN";
}

function classifySmtpFailure(error) {
  if (error?.deliveryStage === "pre_acceptance" || error?.smtpDeliveryAttempted === false) {
    return "failed";
  }
  if (countAddresses(error?.accepted) > 0) return "delivery_uncertain";
  if (KNOWN_PRE_ACCEPTANCE_CODES.has(safeCode(error?.code))) return "failed";
  return "delivery_uncertain";
}

function smtpResultIsUncertain(info) {
  return countAddresses(info?.rejected) > 0 || countAddresses(info?.pending) > 0;
}

function sanitizedSmtpSummary(kind, value) {
  return [
    kind,
    "code=" + safeCode(value?.code),
    "accepted=" + countAddresses(value?.accepted),
    "rejected=" + countAddresses(value?.rejected),
    "pending=" + countAddresses(value?.pending),
  ].join(" ");
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] : rows;
}

async function settleClaim(supabaseFetch, claim, status, errorMessage = null) {
  const rows = await supabaseFetch("/rest/v1/rpc/settle_cargo_mail", {
    method: "POST",
    body: JSON.stringify({
      p_event_id: claim.id,
      p_claim_token: claim.claim_token,
      p_status: status,
      p_error_message: errorMessage,
    }),
  });
  const settlement = firstRow(rows);
  if (!settlement?.settled) {
    const error = new Error("메일 발송 상태를 확정하지 못했습니다.");
    error.code = "MAIL_SETTLEMENT_REFUSED";
    throw error;
  }
  return settlement;
}

function uncertainResult(claim) {
  return {
    sent: false,
    deduplicated: false,
    deliveryUncertain: true,
    eventId: claim?.id || null,
    status: "delivery_uncertain",
    message: "메일 전달 결과를 자동 확정할 수 없어 재발송을 중단했습니다.",
  };
}

async function deliverClaimedMailOnce({ supabaseFetch, claim, sendMail }) {
  if (!claim?.id || !claim?.claim_token) {
    const error = new Error("메일 발송 데이터베이스 버전을 확인해 주세요.");
    error.code = "CARGO_MAIL_SCHEMA_MISMATCH";
    error.smtpDeliveryAttempted = false;
    throw error;
  }

  let info;
  try {
    info = await sendMail(claim);
  } catch (error) {
    const requestedStatus = classifySmtpFailure(error);
    let settledStatus = requestedStatus;
    try {
      await settleClaim(
        supabaseFetch,
        claim,
        requestedStatus,
        sanitizedSmtpSummary(
          requestedStatus === "failed" ? "smtp_not_accepted" : "smtp_delivery_uncertain",
          error
        )
      );
    } catch {
      settledStatus = "delivery_uncertain";
    }
    error.deliveryStatus = settledStatus;
    error.deliveryUncertain = settledStatus === "delivery_uncertain";
    error.publicMessage = error.deliveryUncertain
      ? "메일 전달 결과를 자동 확정할 수 없어 재발송을 중단했습니다."
      : "메일 서버가 발송 전에 요청을 거절했습니다. 다시 시도할 수 있습니다.";
    throw error;
  }

  if (smtpResultIsUncertain(info)) {
    try {
      await settleClaim(
        supabaseFetch,
        claim,
        "delivery_uncertain",
        sanitizedSmtpSummary("smtp_partial_or_rejected", info)
      );
    } catch {
      // The row remains sending and the database will quarantine a stale claim.
    }
    return uncertainResult(claim);
  }

  try {
    await settleClaim(supabaseFetch, claim, "sent", null);
  } catch {
    return uncertainResult(claim);
  }

  return {
    sent: true,
    deduplicated: false,
    deliveryUncertain: false,
    eventId: claim.id,
    status: "sent",
    message: "메일 발송 완료",
  };
}

async function deliverAutomaticMailOnce({
  supabaseFetch,
  eventId,
  allowedEventTypes,
  sendMail,
}) {
  const rows = await supabaseFetch("/rest/v1/rpc/claim_cargo_automatic_mail", {
    method: "POST",
    body: JSON.stringify({
      p_event_id: eventId,
      p_allowed_event_types: allowedEventTypes,
    }),
  });
  const claim = firstRow(rows);
  if (!claim) {
    const error = new Error("알림 이벤트를 찾을 수 없습니다.");
    error.code = "CARGO_MAIL_EVENT_NOT_FOUND";
    throw error;
  }
  if (!claim.claimed) {
    return {
      sent: false,
      deduplicated: true,
      deliveryUncertain: claim.status === "delivery_uncertain",
      eventId: claim.id || null,
      status: claim.status || null,
      message: claim.status === "delivery_uncertain"
        ? "이전 메일의 전달 결과를 확인해야 하므로 재발송하지 않았습니다."
        : "동일한 메일이 이미 발송되었거나 발송 처리 중입니다.",
    };
  }
  return deliverClaimedMailOnce({ supabaseFetch, claim, sendMail });
}

module.exports = {
  classifySmtpFailure,
  deliverAutomaticMailOnce,
  deliverClaimedMailOnce,
};
