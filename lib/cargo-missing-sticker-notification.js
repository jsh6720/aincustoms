const { mailTextToHtml } = require("./cargo-mail-utils");

function displayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function destinationName(value) {
  return String(value || "").split(/[_*]/)[0].trim() || "-";
}

function buildMissingStickerMail(snapshot = {}) {
  const consignee = displayText(snapshot.consignee, "현대코퍼레이션H");
  const blNumber = displayText(snapshot.bl_number);
  const destination = destinationName(snapshot.destination);
  const warehouseDate = displayText(snapshot.warehouse_expected_date);
  const storageYard = displayText(snapshot.storage_yard, "미정");
  const missingFields = Array.isArray(snapshot.missing_sticker_fields)
    ? snapshot.missing_sticker_fields.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const lines = [
    "안녕하세요. 아인합동관세사입니다.",
    "",
    "입고(예정)일이 2일 이내로 남았으나 아래 스티커 업무가 완료되지 않았습니다.",
    "",
    `화주명: ${consignee}`,
    `B/L: ${blNumber}`,
    `납품처: ${destination}`,
    `입고(예정)일: ${warehouseDate}`,
    `입고(예정)구역: ${storageYard}`,
    "",
    "확인 필요 항목:",
    ...(missingFields.length ? missingFields : ["스티커 작성·요청"]).map(
      (field) => `- ${field}`
    ),
    "",
    "스티커 작성 및 요청 여부를 확인해 주시기 바랍니다.",
    "",
    "감사합니다.",
    "아인합동관세사무소",
  ];
  const text = lines.join("\n");
  return {
    subject: `[스티커 작성·요청 확인] ${consignee}_${blNumber} / ${destination}`,
    text,
    html: mailTextToHtml(text),
  };
}

module.exports = {
  buildMissingStickerMail,
};
