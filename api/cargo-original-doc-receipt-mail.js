const nodemailer = require("nodemailer");
const { verifySession, supabaseFetch } = require("../lib/cargo-auth");
const { mergeRecipients, parseRecipientList } = require("../lib/cargo-mail-utils");

const RECEIPT_TO = [
  "dmswk@hyundaicorp.com",
  "ye25@hyundaicorp.com",
];

const RECEIPT_CC = [
  "jsh@aincustoms.com",
  "jhcho@aincustoms.com",
  "bill@aincustoms.com",
];

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

function buildMail(card, totalPages, memo) {
  const consignee = card.consignee || "-";
  const blNumber = card.bl_number || "-";
  const lines = [
    "안녕하세요.",
    "",
    "아래 건의 H/C(위생증, 검역증) 원본 서류를 수령하였습니다.",
    `수령한 H/C 원본 서류 전체 페이지: ${totalPages} page`,
    "",
    "[화물 정보]",
    `화주명: ${consignee}`,
    `B/L: ${blNumber}`,
    `반출처: ${card.destination || "-"}`,
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
    subject: `[H/C 원본서류 수령 확인] ${consignee} / ${blNumber}`,
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
      `반출처: ${card.destination || "-"}`,
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

async function sendMail(mail, additionalRecipients) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    throw new Error("메일 환경변수 SMTP_HOST, SMTP_USER, SMTP_PASS를 확인해 주세요.");
  }

  const port = Number(env("SMTP_PORT") || 465);
  const secure = String(env("SMTP_SECURE") || "true").toLowerCase() !== "false";
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  const recipients = mergeRecipients(RECEIPT_TO, additionalRecipients);
  await transporter.sendMail({
    from: env("MAIL_FROM") || user,
    to: recipients.join(","),
    cc: RECEIPT_CC.join(","),
    subject: mail.subject,
    text: mail.text,
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
    const accountId = cleanText(body.account_id, 80);
    const blNumber = cleanText(body.bl_number, 80);
    const totalPages = cleanText(body.total_pages, 20);
    const memo = cleanText(body.memo, 1500);
    const action = cleanText(body.action, 80) || "hc_receipt";
    const submittedDate = cleanText(body.obl_carrier_submitted_date, 20);
    const additionalRecipients = parseRecipientList(cleanText(body.additional_recipients, 1500));

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

    const mail = action === "obl_carrier_submission"
      ? buildOblCarrierMail(cards[0], submittedDate, memo)
      : buildMail(cards[0], totalPages, memo);
    await sendMail(mail, additionalRecipients);
    return res.status(200).json({ success: true, email_sent: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
