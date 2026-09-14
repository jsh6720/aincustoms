const nodemailer = require("nodemailer");
const { verifySession, supabaseFetch } = require("../lib/cargo-auth");
const {
  destinationName,
  mailTextToHtml,
  parseRecipientList,
} = require("../lib/cargo-mail-utils");
const {
  defaultMailSettings,
  fetchMailSetting,
  resolveMailRecipients,
} = require("../lib/cargo-mail-settings");
const {
  koreaDate,
  markLinkedOriginalDocsReceived,
} = require("../lib/cargo-original-doc-receipt");
const { deliverManualMailOnce } = require("../lib/cargo-mail-dedupe");
const { processBatch } = require("../lib/cargo-doc-mail-batch");

function env(name) {
  return process.env[name] || "";
}

function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function formatWeight(value, unit) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return "-";
  return `${parsed.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit || "KG"}`;
}

const RECEIPT_DOCUMENTS = {
  obl: { subject: "OBL", body: "OBL" },
  hc: { subject: "H/C", body: "H/C(위생증, 검역증)" },
};

function normalizeReceivedDocuments(value) {
  if (value !== undefined && (!Array.isArray(value) || !value.includes("obl") || value.some(item => !["obl", "hc"].includes(item)))) {
    const error = new Error("OBL 접수는 필수입니다. 화면을 새로고침하고 OBL을 포함해 주세요.");
    error.httpStatus = 400;
    throw error;
  }
  const requested = Array.isArray(value) ? value.map((item) => cleanText(item, 20)) : [];
  const selected = Object.keys(RECEIPT_DOCUMENTS).filter((key) => requested.includes(key));
  return selected.length ? selected : ["obl"];
}

function buildMail(card, totalPages, memo, receivedDocuments) {
  const consignee = card.consignee || "-";
  const blNumber = card.bl_number || "-";
  const documents = normalizeReceivedDocuments(receivedDocuments);
  const subjectDocuments = documents.map((key) => RECEIPT_DOCUMENTS[key].subject).join("·");
  const bodyDocuments = documents.map((key) => RECEIPT_DOCUMENTS[key].body).join(", ");
  const lines = [
    "안녕하세요.",
    "",
    `아래 건의 ${bodyDocuments} 원본 서류를 수령하였습니다.`,
    `수령한 원본 서류 전체 페이지: ${totalPages} page`,
    "",
    "[화물 정보]",
    `화주명: ${consignee}`,
    `B/L: ${blNumber}`,
    `반출처: ${destinationName(card.destination)}`,
    `품명: ${card.product_name || "-"}`,
    `적출국: ${card.load_country_name || "-"}${card.load_country ? ` (${card.load_country})` : ""}`,
    `총중량: ${formatWeight(card.total_weight, card.weight_unit)}`,
    `마일스톤: ${card.stage || "-"}`,
    `진행상태: ${card.prgs_stts || "-"}`,
    "",
    "[확인사항]",
    memo || "-",
    "",
    "감사합니다.",
    "아인합동관세사무소",
  ];

  return {
    subject: `[${subjectDocuments} 원본서류 수령 확인] ${consignee} / ${blNumber}`,
    text: lines.join("\n"),
  };
}

function buildOblCarrierMail(card, submittedDate, memo) {
  const consignee = card.consignee || "-";
  const blNumber = card.bl_number || "-";
  return {
    subject: `[OBL 선사 접수 확인] ${consignee} / ${blNumber}`,
    text: [
      "안녕하세요.",
      "",
      "아래 건의 OBL 원본을 선사에 접수하였습니다.",
      `OBL 접수일: ${submittedDate}`,
      "",
      "[화물 정보]",
      `화주명: ${consignee}`,
      `B/L: ${blNumber}`,
      `반출처: ${destinationName(card.destination)}`,
      `품명: ${card.product_name || "-"}`,
      `마일스톤: ${card.stage || "-"}`,
      `진행상태: ${card.prgs_stts || "-"}`,
      "",
      "[확인사항]",
      memo || "-",
      "",
      "감사합니다.",
      "아인합동관세사무소",
    ].join("\n"),
  };
}

async function resolveReceiptRecipients(additionalRecipients, action) {
  const settingKey = action === "obl_carrier_submission" || action === "obl_carrier_batch"
    ? "obl_carrier_receipt" : "original_doc_receipt";
  const setting = await fetchMailSetting(supabaseFetch, settingKey);
  const fallback = defaultMailSettings(process.env)[settingKey];
  return resolveMailRecipients({ setting, fallbackTo: fallback.to, fallbackCc: fallback.cc, extraTo: additionalRecipients });
}

async function sendMail(mail, additionalRecipients, action, preparedRecipients) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    const error = new Error("메일 환경변수 SMTP_HOST, SMTP_USER, SMTP_PASS를 확인해 주세요.");
    error.smtpDeliveryAttempted = false;
    throw error;
  }

  const port = Number(env("SMTP_PORT") || 465);
  const secure = String(env("SMTP_SECURE") || "true").toLowerCase() !== "false";
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  const recipients = preparedRecipients || await resolveReceiptRecipients(additionalRecipients, action);
  return transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.to.join(","),
    cc: recipients.cc.length ? recipients.cc.join(",") : undefined,
    subject: mail.subject,
    text: mail.text,
    html: mailTextToHtml(mail.text),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }
    if ((session.role || "shipper") !== "admin") {
      return res.status(403).json({ success: false, message: "관리자만 메일을 발송할 수 있습니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (["original_doc_batch", "obl_carrier_batch"].includes(body.action)) {
      const extra = parseRecipientList(cleanText(body.additional_recipients, 1500));
      const recipients = await resolveReceiptRecipients(extra, body.action);
      const result = await processBatch(body, { supabaseFetch, recipients, loginId: session.login_id || "admin",
        sendMail: mail => sendMail(mail, extra, body.action, recipients) });
      return res.status(result.success ? 200 : 503).json(result);
    }
    const accountId = cleanText(body.account_id, 80);
    const blNumber = cleanText(body.bl_number, 80);
    const totalPages = cleanText(body.total_pages, 20);
    const memo = cleanText(body.memo, 1500);
    const action = cleanText(body.action, 80) || "hc_receipt";
    const submittedDate = cleanText(body.obl_carrier_submitted_date, 20);
    const additionalRecipients = parseRecipientList(cleanText(body.additional_recipients, 1500));
    const receivedDocuments = normalizeReceivedDocuments(body.received_documents);

    if (!accountId || !blNumber) {
      return res.status(400).json({ success: false, message: "카드 정보가 올바르지 않습니다." });
    }
    if (action === "hc_receipt" && (!totalPages || Number(totalPages) <= 0)) {
      return res.status(400).json({ success: false, message: "수령한 전체 페이지를 입력해 주세요." });
    }
    if (action === "obl_carrier_submission" && !/^\d{4}-\d{2}-\d{2}$/.test(submittedDate)) {
      return res.status(400).json({ success: false, message: "OBL 접수일을 입력해 주세요." });
    }
    if (!["hc_receipt", "obl_carrier_submission"].includes(action)) {
      return res.status(400).json({ success: false, message: "지원하지 않는 메일 유형입니다." });
    }

    const account = encodeURIComponent(accountId);
    const bl = encodeURIComponent(blNumber);
    const cards = await supabaseFetch(
      `/rest/v1/cargo_cards?select=*&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
    );
    if (!cards || !cards.length) {
      return res.status(404).json({ success: false, message: "카드 정보를 찾지 못했습니다." });
    }

    const card = cards[0];
    const receivedDate = koreaDate();
    const mail = action === "obl_carrier_submission"
      ? buildOblCarrierMail(card, submittedDate, memo)
      : buildMail(card, totalPages, memo, receivedDocuments);
    const delivery = await deliverManualMailOnce({
      supabaseFetch,
      mailType: action === "obl_carrier_submission"
        ? "obl_carrier_submission"
        : "original_doc_receipt",
      accountId,
      blNumber,
      businessPayload: action === "obl_carrier_submission"
        ? { submitted_date: submittedDate, memo, additional_recipients: additionalRecipients }
        : {
          received_date: receivedDate,
          documents: [...receivedDocuments].sort(),
          total_pages: totalPages,
          memo,
          additional_recipients: additionalRecipients,
        },
      cardSnapshot: card,
      send: () => sendMail(mail, additionalRecipients, action),
    });
    if (!delivery.sent && delivery.status !== "sent") {
      return res.status(409).json({ success: false, email_sent: false, deduplicated: !!delivery.deduplicated,
        delivery_uncertain: !!delivery.deliveryUncertain, message: delivery.message || "이전 발송 결과를 확인해 주세요." });
    }
    if (action === "hc_receipt") {
      try {
        await markLinkedOriginalDocsReceived({
          supabaseFetch,
          card,
          receivedDate,
          updatedBy: session.login_id || "admin",
          receivedDocuments,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          email_sent: delivery.sent,
          deduplicated: delivery.deduplicated,
          receipt_saved: false,
          message: "수령메일은 발송됐지만 선택한 서류의 수취상태 저장에 실패했습니다. 메일을 다시 보내지 말고 관리자에게 상태 저장을 요청해 주세요.",
          detail: error.message,
        });
      }
      return res.status(200).json({
        success: true,
        email_sent: delivery.sent,
        deduplicated: delivery.deduplicated,
        delivery_uncertain: !!delivery.deliveryUncertain,
        receipt_saved: true,
        received_date: receivedDate,
      });
    }
    return res.status(200).json({
      success: true,
      email_sent: delivery.sent,
      deduplicated: delivery.deduplicated,
      delivery_uncertain: !!delivery.deliveryUncertain,
      message: delivery.message,
    });
  } catch (error) {
    return res.status(error.httpStatus || 500).json({
      success: false,
      delivery_uncertain: !!error.deliveryUncertain,
      blocked: error.blocked,
      message: error.publicMessage || error.message,
    });
  }
};
