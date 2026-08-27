const nodemailer = require("nodemailer");
const { requireWritableSession, supabaseFetch } = require("../lib/cargo-auth");
const { koreaDate, normalizeIsoDate } = require("../lib/cargo-request-utils");
const { mailTextToHtml } = require("../lib/cargo-mail-utils");
const {
  defaultMailSettings,
  fetchEffectiveRoleMailSettings,
  fetchMailSetting,
  resolveDirectoryNoticeRecipients,
  resolveMailRecipients,
  resolveRoleMailRecipients,
} = require("../lib/cargo-mail-settings");
const {
  isImportProgressStatus,
  verifySyncSignature,
} = require("../lib/cargo-import-progress-notification");
const {
  buildWarehouseScheduleMail,
} = require("../lib/cargo-warehouse-schedule-notification");
const {
  buildMissingWarehousePlanMail,
} = require("../lib/cargo-missing-warehouse-plan-notification");
const { deliverManualMailOnce } = require("../lib/cargo-mail-dedupe");
const {
  deliverAutomaticMailOnce,
} = require("../lib/cargo-automatic-mail-dedupe");

const ALLOWED_STAGES = ["입항", "반입"];
const MISSING_WAREHOUSE_PLAN_RECIPIENTS = [
  "jsh@aincustoms.com", "jhcho@aincustoms.com", "bill@aincustoms.com",
];

function env(name) {
  return process.env[name] || "";
}

function preDeliveryError(message, code = "MAIL_PREFLIGHT_FAILED") {
  const error = new Error(message);
  error.code = code;
  error.smtpDeliveryAttempted = false;
  return error;
}

async function hchCardFromClaim(claim) {
  const card = claim?.card_snapshot && typeof claim.card_snapshot === "object"
    ? claim.card_snapshot
    : {};
  const accountId = String(card.account_id || "").trim();
  if (!accountId) {
    throw preDeliveryError("알림 이벤트의 화주 식별정보가 없습니다.", "CARGO_EVENT_ACCOUNT_MISSING");
  }
  const accounts = await supabaseFetch(
    "/rest/v1/shipper_accounts?select=id,login_id,display_name&id=eq."
      + encodeURIComponent(accountId)
      + "&limit=1"
  );
  const account = accounts && accounts[0];
  if (!account || String(account.login_id || "").trim().toUpperCase() !== "HCH") {
    throw preDeliveryError("HCH 알림 이벤트가 아닙니다.", "CARGO_EVENT_NOT_HCH");
  }
  return card;
}

function automaticDeliveryResponse(res, delivery) {
  if (delivery.deliveryUncertain && !delivery.deduplicated) {
    return res.status(502).json({
      success: false,
      email_sent: false,
      deduplicated: false,
      delivery_uncertain: true,
      message: delivery.message,
    });
  }
  return res.status(200).json({
    success: true,
    email_sent: !!delivery.sent,
    deduplicated: !!delivery.deduplicated,
    delivery_uncertain: !!delivery.deliveryUncertain,
    message: delivery.message,
  });
}

function automaticDeliveryError(res, error) {
  if (error?.httpStatus === 503) {
    return res.status(503).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  if (error?.code === "CARGO_MAIL_EVENT_NOT_FOUND") {
    return res.status(404).json({ success: false, message: "알림 이벤트를 찾을 수 없습니다." });
  }
  return res.status(502).json({
    success: false,
    email_sent: false,
    delivery_uncertain: !!error?.deliveryUncertain,
    message: error?.publicMessage || "메일 발송에 실패했습니다.",
  });
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

async function sendAutomaticProgressMail(card) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    throw preDeliveryError("메일 환경변수가 설정되지 않았습니다.");
  }

  const setting = await fetchMailSetting(supabaseFetch, "original_doc_receipt");
  const fallback = defaultMailSettings(process.env).original_doc_receipt;
  const recipients = resolveMailRecipients({
    setting,
    fallbackTo: fallback.to,
    fallbackCc: fallback.cc,
  });
  if (!recipients.to.length) {
    throw preDeliveryError("수입신고 진행 안내 수신처가 설정되지 않았습니다.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env("SMTP_PORT") || 465),
    secure: String(env("SMTP_SECURE") || "true").toLowerCase() !== "false",
    auth: { user, pass },
  });
  const mail = buildAutomaticProgressMail(card);
  return transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.to.join(","),
    cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
    subject: mail.subject,
    text: mail.text,
    html: mailTextToHtml(mail.text),
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

  try {
    const delivery = await deliverAutomaticMailOnce({
      supabaseFetch,
      eventId,
      allowedEventTypes: ["import_progress_started"],
      sendMail: async (claim) => {
        const card = await hchCardFromClaim(claim);
        if (!isImportProgressStatus(card.prgs_stts)) {
          throw preDeliveryError(
            "알림 이벤트의 수입신고 진행 상태를 확인할 수 없습니다.",
            "CARGO_EVENT_STATUS_INVALID"
          );
        }
        return sendAutomaticProgressMail(card);
      },
    });
    return automaticDeliveryResponse(res, delivery);
  } catch (error) {
    return automaticDeliveryError(res, error);
  }
}

async function sendWarehouseScheduleMail(eventType, snapshot) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    throw preDeliveryError("메일 환경변수가 설정되지 않았습니다.");
  }

  const settings = await fetchEffectiveRoleMailSettings(
    supabaseFetch,
    "warehouse_change",
    "notice",
    process.env
  );
  const recipients = await resolveDirectoryNoticeRecipients({
    supabaseFetch,
    settings,
    card: snapshot,
  });
  if (!recipients.to.length) {
    throw preDeliveryError("입고 일정 안내 수신처가 설정되지 않았습니다.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env("SMTP_PORT") || 465),
    secure: String(env("SMTP_SECURE") || "true").toLowerCase() !== "false",
    auth: { user, pass },
  });
  const mail = buildWarehouseScheduleMail(eventType, snapshot);
  return transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.to.join(","),
    cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html || mailTextToHtml(mail.text),
  });
}

async function handleAutomaticWarehouseScheduleNotice(req, res, body) {
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

  try {
    const delivery = await deliverAutomaticMailOnce({
      supabaseFetch,
      eventId,
      allowedEventTypes: ["warehouse_arrival_eve", "warehouse_arrival_today"],
      sendMail: async (claim) => {
        const card = await hchCardFromClaim(claim);
        return sendWarehouseScheduleMail(claim.event_type, card);
      },
    });
    return automaticDeliveryResponse(res, delivery);
  } catch (error) {
    return automaticDeliveryError(res, error);
  }
}

async function sendMissingWarehousePlanMail(snapshot) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    throw preDeliveryError("메일 환경변수가 설정되지 않았습니다.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(env("SMTP_PORT") || 465),
    secure: String(env("SMTP_SECURE") || "true").toLowerCase() !== "false",
    auth: { user, pass },
  });
  const mail = buildMissingWarehousePlanMail(snapshot);
  return transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: MISSING_WAREHOUSE_PLAN_RECIPIENTS.join(","),
    subject: mail.subject,
    text: mail.text,
    html: mail.html || mailTextToHtml(mail.text),
  });
}

async function handleAutomaticMissingWarehousePlanNotice(req, res, body) {
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

  try {
    const delivery = await deliverAutomaticMailOnce({
      supabaseFetch,
      eventId,
      allowedEventTypes: ["warehouse_plan_missing"],
      sendMail: async (claim) => {
        const card = await hchCardFromClaim(claim);
        return sendMissingWarehousePlanMail(card);
      },
    });
    return automaticDeliveryResponse(res, delivery);
  } catch (error) {
    return automaticDeliveryError(res, error);
  }
}

async function sendMail(card, request, session, account) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const settings = await fetchEffectiveRoleMailSettings(
    supabaseFetch,
    "import_request",
    "request",
    process.env
  );
  const recipients = resolveRoleMailRecipients({
    settings,
    direction: "request",
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
  const delivery = await deliverManualMailOnce({
    supabaseFetch,
    mailType: "import_request",
    accountId: request.account_id || session.account_id,
    blNumber: card.bl_number,
    businessPayload: {
      requester_name: request.requester_name,
      requester_email: request.requester_email,
      requested_import_date: request.requested_import_date,
      requested_release_date: request.requested_release_date,
      delivery_address: request.delivery_address,
      memo: request.memo,
    },
    cardSnapshot: card,
    send: () => transporter.sendMail({
      from: env("MAIL_FROM") || user,
      to: recipients.to.join(","),
      cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
      subject: mail.subject,
      text: mail.text,
      html: mailTextToHtml(mail.text),
    }),
  });
  return { ...delivery, skipped: false };
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
    if (body.action === "auto_warehouse_schedule_notice") {
      return await handleAutomaticWarehouseScheduleNotice(req, res, body);
    }
    if (body.action === "auto_missing_warehouse_plan_notice") {
      return await handleAutomaticMissingWarehousePlanNotice(req, res, body);
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
      mailResult = {
        sent: false,
        skipped: false,
        deliveryUncertain: !!error.deliveryUncertain,
        message: error.publicMessage || "메일 발송에 실패했습니다.",
      };
    }

    return res.status(200).json({
      success: true,
      request: savedRequest,
      email_sent: !!mailResult.sent,
      deduplicated: !!mailResult.deduplicated,
      delivery_uncertain: !!mailResult.deliveryUncertain,
      email_message: mailResult.message,
    });
  } catch (error) {
    if (String(error.message || "").includes("cargo_import_requests")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_import_requests 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(error.httpStatus || 500).json({ success: false, message: error.message });
  }
};
