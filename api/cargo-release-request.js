const nodemailer = require("nodemailer");
const { verifySession, supabaseFetch } = require("./_cargo-auth");

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

function buildMail(card, request, session) {
  const typeText = request.request_type === "full" ? "전량 출고" : "일부 출고";
  const lines = [
    "홈페이지에서 출고요청이 접수되었습니다.",
    "",
    "[요청 정보]",
    `요청화주: ${session.display_name || session.login_id || "-"}`,
    `요청구분: ${typeText}`,
    `요청물량: ${formatWeight(request.requested_weight, request.weight_unit)}`,
    `요청담당자: ${request.requester_name || "-"}`,
    `요청인 메일(CC): ${request.requester_email || "-"}`,
    `출고지주소: ${request.delivery_address || "-"}`,
    `출고일자: ${request.requested_release_date || "-"}`,
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
    `잔량: ${formatWeight(card.remaining_weight, card.weight_unit)}`,
    `최초반입: ${card.first_arrival_date || "-"}`,
    `창고반입: ${card.warehouse_arrival_date || "-"}`,
    `장치장: ${card.shed_name || "-"}`,
    `진행상태: ${card.prgs_stts || "-"}`,
    `수입신고수리일: ${card.import_permit_date || "-"}`,
  ];
  return {
    subject: `[출고요청] ${card.consignee || session.display_name || ""} / ${card.bl_number || ""} / ${typeText}`,
    text: lines.join("\n"),
  };
}

async function sendMail(card, request, session, account) {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const to = getRequestRecipient(session, account);
  if (!host || !user || !pass || !to) {
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
    to,
    cc: request.requester_email || undefined,
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
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const blNumber = String(body.bl_number || "").trim();
    const requestType = body.request_type === "partial" ? "partial" : "full";
    const memo = String(body.memo || "").trim().slice(0, 1000);
    const requesterName = String(body.requester_name || "").trim().slice(0, 120);
    const requesterEmail = String(body.requester_email || "").trim().slice(0, 254);
    const deliveryAddress = String(body.delivery_address || "").trim().slice(0, 500);
    const requestedReleaseDate = String(body.requested_release_date || "").trim().slice(0, 10);
    const requestedWeight = numberOrNull(body.requested_weight);

    if (!blNumber) {
      return res.status(400).json({ success: false, message: "BL 번호가 없습니다." });
    }
    if (requestType === "partial" && (!requestedWeight || requestedWeight <= 0)) {
      return res.status(400).json({ success: false, message: "일부 출고 요청물량을 입력해 주세요." });
    }
    if (!requesterName) {
      return res.status(400).json({ success: false, message: "요청담당자를 입력해 주세요." });
    }
    if (!isValidEmail(requesterEmail)) {
      return res.status(400).json({ success: false, message: "요청인 메일을 정확히 입력해 주세요." });
    }
    if (!deliveryAddress) {
      return res.status(400).json({ success: false, message: "출고지주소를 입력해 주세요." });
    }
    if (!requestedReleaseDate) {
      return res.status(400).json({ success: false, message: "출고일자를 입력해 주세요." });
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
    if (card.stage !== "수입신고") {
      return res.status(400).json({ success: false, message: "수입신고 마일스톤의 카드만 출고요청할 수 있습니다." });
    }

    const unit = card.weight_unit || "KG";
    const availableWeight = numberOrNull(card.remaining_weight) || numberOrNull(card.base_weight) || numberOrNull(card.total_weight);
    const finalWeight = requestType === "full" ? availableWeight : requestedWeight;
    if (requestType === "partial" && availableWeight && finalWeight > availableWeight) {
      return res.status(400).json({ success: false, message: `요청물량이 잔량(${formatWeight(availableWeight, unit)})보다 큽니다.` });
    }

    const requestPayload = {
      account_id: session.account_id,
      bl_number: blNumber,
      request_type: requestType,
      requested_weight: finalWeight,
      weight_unit: unit,
      requester_name: requesterName,
      requester_email: requesterEmail,
      delivery_address: deliveryAddress,
      requested_release_date: requestedReleaseDate,
      memo,
      status: "requested",
      card_snapshot: card,
    };
    const rows = await supabaseFetch("/rest/v1/cargo_release_requests", {
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
    if (String(error.message || "").includes("cargo_release_requests")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_release_requests 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
