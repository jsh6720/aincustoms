const nodemailer = require("nodemailer");
const { requireWritableSession, supabaseFetch } = require("../lib/cargo-auth");
const { koreaDate, normalizeIsoDate } = require("../lib/cargo-request-utils");
const { fetchMailSetting, resolveMailRecipients } = require("../lib/cargo-mail-settings");
const {
  isImportProgressStatus,
  verifySyncSignature,
} = require("../lib/cargo-import-progress-notification");

const ALLOWED_STAGES = ["입항", "반입"];

function env(name) {
  return process.env[name] || "";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatWeight(value, unit) {
  const parsed = numberOrNull(value);
  if (parsed === null) return "-";
  return `${parsed.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit || "KG"}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getRequestRecipient(session, account) {
  return (
    account?.release_request_to ||
    session.release_request_to ||
    env("RELEASE_REQUEST_TO") ||
    env("NOTIFY_TO") ||
    env("SMTP_USER")
  );
}

function displayDate(value) {
  return value || "미정";
}

function displayText(value) {
  return value || "미정";
}

function buildMail(card, request, session) {
  const lines = [
    "홈페이지에서 수입통관 요청이 접수되었습니다.",
    "통관요청 내용을 확인해 주세요.",
    "",
    "[통관요청 정보]",
    `요청화주: ${session.display_name || session.login_id || "-"}`,
    `요청담당자: ${request.requester_name || "-"}`,
    `요청인 메일(CC): ${request.requester_email || "-"}`,
    `출고지주소: ${displayText(request.delivery_address)}`,
    `출고일자: ${displayDate(request.requested_release_date)}`,
    `수입신고 요청일자: ${request.requested_import_date || "-"}`,
    `요청사항: ${request.memo || "-"}`,
    `요청시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    "",
    "[카드 정보]",
    `화주명: ${card.consignee || "-"}`,
    `B/L: ${card.bl_number || "-"}`,
    `반출처: ${card.destination || "-"}`,
    `품명: ${card.product_name || "-"}`,
    `적출국: ${card.load_country_name || "-"}${card.load_country ? ` (${card.load_country})` : ""}`,
    `총중량: ${formatWeight(card.total_weight, card.weight_unit)}`,
    `최초반입: ${card.first_arrival_date || "-"}`,
    `창고반입: ${card.warehouse_arrival_date || "-"}`,
    `장치장: ${card.shed_name || "-"}`,
    `진행상태: ${card.prgs_stts || "-"}`,
  ];
  return {
    subject: `[수입통관 요청] ${card.consignee || session.display_name || ""} / ${card.bl_number || ""}`,
    text: lines.join("\n"),
  };
}

function buildAutomaticProgressMail(card) {
  const lines = [
    "수입신고 진행이 확인되어 안내드립니다.",
    "",
    "[화물 정보]",
    `화주명: ${card.consignee || "현대코퍼레이션H"}`,
    `B/L: ${card.bl_number || "-"}`,
    `납품처: ${card.destination || "-"}`,
    `품명: ${card.product_name || "-"}`,
    `진행상태: ${card.prgs_stts || "-"}`,
    `확인시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
  ];
  return {
    subject: `[수입신고 진행 안내] ${card.consignee || "현대코퍼레이션H"} / ${card.bl_number || ""}`,
    text: lines.join("\n"),
  };
}

async function updateNotification(eventId, payload) {
  return supabaseFetch(
    `/rest/v1/cargo_status_notifications?id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    }
  );
}

async function sendAutomaticProgressMail(card) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    throw new Error("메일 환경변수가 설정되지 않았습니다.");
  }

  const setting = await fetchMailSetting(supabaseFetch, "original_doc_receipt");
  const recipients = resolveMailRecipients({
    setting,
    fallbackTo: ["dmswk@hyundaicorp.com", "ye25@hyundaicorp.com"],
    fallbackCc: ["jsh@aincustoms.com", "jhcho@aincustoms.com", "bill@aincustoms.com"],
  });
  if (!recipients.to.length) {
    throw new Error("수입신고 진행 안내 수신처가 설정되지 않았습니다.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env("SMTP_PORT") || 465),
    secure: String(env("SMTP_SECURE") || "true").toLowerCase() !== "false",
    auth: { user, pass },
  });
  const mail = buildAutomaticProgressMail(card);
  await transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.to.join(","),
    cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
    subject: mail.subject,
    text: mail.text,
  });
}

async function handleAutomaticProgressNotice(req, res, body) {
  const eventId = String(body.event_id || "").trim();
  const timestamp = String(req.headers?.["x-cargo-sync-timestamp"] || "").trim();
  const signature = String(req.headers?.["x-cargo-sync-signature"] || "").trim();
  if (!verifySyncSignature({
    secret: env("SUPABASE_SERVICE_ROLE_KEY"),
    timestamp,
    eventId,
    signature,
  })) {
    return res.status(401).json({ success: false, message: "Invalid sync signature" });
  }

  const events = await supabaseFetch(
    `/rest/v1/cargo_status_notifications?select=*&id=eq.${encodeURIComponent(eventId)}&event_type=eq.import_progress_started&limit=1`
  );
  const event = events && events[0];
  if (!event) {
    return res.status(404).json({ success: false, message: "알림 이벤트를 찾을 수 없습니다." });
  }
  if (event.status === "sent") {
    return res.status(200).json({ success: true, email_sent: false, deduplicated: true });
  }

  const accounts = await supabaseFetch(
    `/rest/v1/shipper_accounts?select=id,login_id,display_name&id=eq.${encodeURIComponent(event.account_id)}&limit=1`
  );
  const account = accounts && accounts[0];
  if (!account || String(account.login_id || "").trim().toUpperCase() !== "HCH") {
    return res.status(403).json({ success: false, message: "HCH 알림 이벤트가 아닙니다." });
  }

  const cards = await supabaseFetch(
    `/rest/v1/cargo_cards?select=*&account_id=eq.${encodeURIComponent(event.account_id)}&bl_number=eq.${encodeURIComponent(event.bl_number)}&limit=1`
  );
  const card = cards && cards[0];
  if (!card || !isImportProgressStatus(card.prgs_stts)) {
    return res.status(409).json({ success: false, message: "현재 수입신고 진행 상태를 확인할 수 없습니다." });
  }

  const attemptedAt = new Date().toISOString();
  const attemptCount = Number(event.attempt_count || 0) + 1;
  try {
    await sendAutomaticProgressMail(card);
    await updateNotification(event.id, {
      status: "sent",
      attempt_count: attemptCount,
      last_attempt_at: attemptedAt,
      sent_at: attemptedAt,
      error_message: null,
    });
    return res.status(200).json({ success: true, email_sent: true, deduplicated: false });
  } catch (error) {
    try {
      await updateNotification(event.id, {
        status: "failed",
        attempt_count: attemptCount,
        last_attempt_at: attemptedAt,
        error_message: String(error.message || error).slice(0, 2000),
      });
    } catch {
      // The caller will retry the pending event even if failure bookkeeping is unavailable.
    }
    return res.status(502).json({ success: false, email_sent: false, message: error.message });
  }
}

async function sendMail(card, request, session, account) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const setting = await fetchMailSetting(supabaseFetch, "import_request");
  const recipients = resolveMailRecipients({
    accountOverride: account?.release_request_to || session.release_request_to,
    setting,
    fallbackTo: [env("RELEASE_REQUEST_TO"), env("NOTIFY_TO"), user],
    extraCc: request.requester_email,
  });
  if (!host || !user || !pass || !recipients.to.length) {
    return { sent: false, skipped: true, message: "메일 환경변수가 설정되지 않았습니다." };
  }

  const port = Number(env("SMTP_PORT") || 465);
  const secure = String(env("SMTP_SECURE") || "true").toLowerCase() !== "false";
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  const mail = buildMail(card, request, session);
  await transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.to.join(","),
    cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
    subject: mail.subject,
    text: mail.text,
  });
  return { sent: true, skipped: false, message: "메일 발송 완료" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (body.action === "auto_import_progress_notice") {
      return await handleAutomaticProgressNotice(req, res, body);
    }

    const session = requireWritableSession(req, res);
    if (!session) return;

    const blNumber = String(body.bl_number || "").trim();
    const memo = String(body.memo || "").trim().slice(0, 1000);
    const requesterName = String(body.requester_name || "").trim().slice(0, 120);
    const requesterEmail = String(body.requester_email || "").trim().slice(0, 254);
    const deliveryAddress = String(body.delivery_address || "").trim().slice(0, 500);
    const requestedReleaseDate = String(body.requested_release_date || "").trim().slice(0, 10);
    const requestedImportDate = normalizeIsoDate(body.requested_import_date, koreaDate());

    if (!blNumber) {
      return res.status(400).json({ success: false, message: "BL 번호가 없습니다." });
    }
    if (!requesterName) {
      return res.status(400).json({ success: false, message: "요청담당자를 입력해 주세요." });
    }
    if (requesterEmail && !isValidEmail(requesterEmail)) {
      return res.status(400).json({ success: false, message: "요청인 메일을 정확히 입력해 주세요." });
    }
    if (!requestedImportDate) {
      return res.status(400).json({ success: false, message: "수입신고 요청일자 형식이 올바르지 않습니다." });
    }

    const accountId = encodeURIComponent(session.account_id);
    const bl = encodeURIComponent(blNumber);
    const accountRows = await supabaseFetch(
      `/rest/v1/shipper_accounts?select=id,release_request_to&role=eq.shipper&id=eq.${accountId}&limit=1`
    );
    const account = accountRows && accountRows[0] ? accountRows[0] : null;
    const cards = await supabaseFetch(
      `/rest/v1/cargo_cards?select=*&account_id=eq.${accountId}&bl_number=eq.${bl}&limit=1`
    );
    if (!cards || !cards.length) {
      return res.status(404).json({ success: false, message: "조회 권한이 없는 BL입니다." });
    }
    const card = cards[0];
    if (!ALLOWED_STAGES.includes(card.stage)) {
      return res.status(400).json({ success: false, message: "입항 또는 반입 마일스톤의 카드만 수입신고요청할 수 있습니다." });
    }

    const requestPayload = {
      account_id: session.account_id,
      bl_number: blNumber,
      requester_name: requesterName,
      requester_email: requesterEmail,
      delivery_address: deliveryAddress || null,
      requested_release_date: requestedReleaseDate || null,
      requested_import_date: requestedImportDate,
      memo,
      status: "requested",
      card_snapshot: card,
    };
    const rows = await supabaseFetch("/rest/v1/cargo_import_requests", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(requestPayload),
    });
    const savedRequest = rows && rows[0] ? rows[0] : requestPayload;

    let mailResult;
    try {
      mailResult = await sendMail(card, savedRequest, session, account);
    } catch (error) {
      mailResult = { sent: false, skipped: false, message: error.message };
    }

    return res.status(200).json({
      success: true,
      request: savedRequest,
      email_sent: !!mailResult.sent,
      email_message: mailResult.message,
    });
  } catch (error) {
    if (String(error.message || "").includes("cargo_import_requests")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_import_requests 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
