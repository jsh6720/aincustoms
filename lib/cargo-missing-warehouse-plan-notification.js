const { mailTextToHtml } = require("./cargo-mail-utils");

function displayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function destinationName(value) {
  return String(value || "").split(/[_*]/)[0].trim() || "-";
}

function buildMissingWarehousePlanMail(snapshot = {}) {
  const consignee = displayText(snapshot.consignee, "현대코퍼레이션H");
  const blNumber = displayText(snapshot.bl_number);
  const destination = destinationName(snapshot.destination);
  const oblSubmittedDate = displayText(snapshot.obl_carrier_submitted_date);
  const missingFields = Array.isArray(snapshot.missing_warehouse_plan_fields)
    ? snapshot.missing_warehouse_plan_fields.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const lines = [
    "안녕하세요. 아인합동관세사입니다.",
    "",
    "OBL 접수가 확인되었으나 아래 반입예정정보가 입력되지 않았습니다.",
    "",
    `화주명: ${consignee}`,
    `B/L: ${blNumber}`,
    `납품처: ${destination}`,
    `OBL 접수일: ${oblSubmittedDate}`,
    "",
    "미입력 항목:",
    ...(missingFields.length ? missingFields : ["반입예정정보"]).map((field) => `- ${field}`),
    "",
    "대시보드에서 반입예정구역과 반입예정일을 확인 후 입력해 주시기 바랍니다.",
    "",
    "감사합니다.",
    "아인합동관세사무소",
  ];
  const text = lines.join("\n");

  return {
    subject: `[반입예정정보 입력 확인] ${consignee}_${blNumber} / ${destination}`,
    text,
    html: mailTextToHtml(text),
  };
}

module.exports = {
  buildMissingWarehousePlanMail,
};
