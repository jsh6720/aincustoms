function isoDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function effectiveOriginalReceiptDate(card) {
  if (!card?.obl_received && !card?.hc_received) return "";
  return isoDate(card.actual_received_date) || isoDate(card.original_docs_updated_at);
}

function receiptDateForSave({ obl_received, hc_received, submitted_date, today }) {
  if (!obl_received && !hc_received) return null;
  const submitted = isoDate(submitted_date);
  if (submitted) return submitted;
  return isoDate(today);
}

function normalizeTransferOverride(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "automatic") return null;
  if (value === true || value === "true" || value === "O" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === "X" || value === 0 || value === "0") return false;
  throw new Error("양도증 상태가 올바르지 않습니다.");
}

module.exports = {
  effectiveOriginalReceiptDate,
  normalizeTransferOverride,
  receiptDateForSave,
};
