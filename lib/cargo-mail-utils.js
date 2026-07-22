const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipientList(value) {
  const seen = new Set();
  const recipients = [];
  String(value || "")
    .split(/[,;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((email) => {
      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`올바르지 않은 이메일 주소입니다: ${email}`);
      }
      const key = email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      recipients.push(email);
    });
  return recipients;
}

function mergeRecipients(base, extra) {
  const seen = new Set();
  return [...(base || []), ...(extra || [])].filter((email) => {
    const key = String(email || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanWarehouseValues(values) {
  return {
    storage_yard: String(values?.storage_yard || "").trim(),
    warehouse_expected_date: String(values?.warehouse_expected_date || "").trim(),
  };
}

function warehouseChanges(previous, next) {
  const before = cleanWarehouseValues(previous);
  const after = cleanWarehouseValues(next);
  return ["storage_yard", "warehouse_expected_date"].filter(
    (field) => before[field] !== after[field]
  );
}

function displayValue(value) {
  return String(value || "").trim() || "미입력";
}

function buildWarehouseChangeMail(card, session, previous, next) {
  const before = cleanWarehouseValues(previous);
  const after = cleanWarehouseValues(next);
  const blNumber = card?.bl_number || "-";
  const consignee = card?.consignee || session?.display_name || "-";
  const requester = session?.display_name || session?.login_id || "화주";
  return {
    subject: `[반입예정정보 변경] ${consignee} / ${blNumber}`,
    text: [
      "화주가 반입예정정보를 변경했습니다.",
      "",
      `화주명: ${consignee}`,
      `B/L: ${blNumber}`,
      `변경자: ${requester} (${session?.login_id || "-"})`,
      `반입예정구역: ${displayValue(before.storage_yard)} -> ${displayValue(after.storage_yard)}`,
      `반입예정일: ${displayValue(before.warehouse_expected_date)} -> ${displayValue(after.warehouse_expected_date)}`,
    ].join("\n"),
  };
}

module.exports = {
  buildWarehouseChangeMail,
  mergeRecipients,
  parseRecipientList,
  warehouseChanges,
};
