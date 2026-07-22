function isoDate(value) {
  const text = String(value || "").trim();
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return dateOnly[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  }
  const prefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return prefix ? prefix[1] : "";
}

function effectiveOriginalReceiptDate(card) {
  if (!card?.obl_received && !card?.hc_received) return "";
  return isoDate(card.actual_received_date) || isoDate(card.original_docs_updated_at);
}

function receiptDateForSave({
  obl_received,
  hc_received,
  previous_obl_received,
  previous_hc_received,
  previous_date,
  submitted_date,
  today,
}) {
  if (!obl_received && !hc_received) return null;
  const submitted = isoDate(submitted_date);
  if (submitted) return submitted;
  const previous = isoDate(previous_date);
  if (previous) return previous;
  const newlyReceived = (obl_received && !previous_obl_received)
    || (hc_received && !previous_hc_received);
  return newlyReceived ? isoDate(today) : null;
}

function isMissingTransferOverrideColumn(error) {
  const message = String(error?.message || error || "");
  return message.includes("transfer_received_override")
    && (/column|schema cache|PGRST204/i.test(message));
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
  isMissingTransferOverrideColumn,
  normalizeTransferOverride,
  receiptDateForSave,
};
