function text(value) {
  return String(value || "").trim();
}

function normalizeBl(value) {
  return text(value).toUpperCase();
}

function cargoSourceKey(card) {
  const blNumber = normalizeBl(card?.bl_number);
  const folderName = text(card?.folder_name);
  if (!blNumber) return "";
  if (folderName) return `${blNumber}|folder:${folderName}`;
  return `${blNumber}|account:${text(card?.account_id)}`;
}

function linkedAccountIds(card, cardRefs) {
  const sourceKey = cargoSourceKey(card);
  if (!sourceKey) return [];
  return Array.from(new Set(
    (cardRefs || [])
      .filter((item) => cargoSourceKey(item) === sourceKey)
      .map((item) => text(item.account_id))
      .filter(Boolean)
  ));
}

function linkedRows(card, cardRefs, rows) {
  const accountIds = new Set(linkedAccountIds(card, cardRefs));
  const blNumber = normalizeBl(card?.bl_number);
  return (rows || []).filter((item) => (
    normalizeBl(item.bl_number) === blNumber &&
    accountIds.has(text(item.account_id))
  ));
}

function newestFirst(rows, field) {
  return [...(rows || [])].sort((left, right) => (
    text(right?.[field]).localeCompare(text(left?.[field]))
  ));
}

function newestValue(rows, field) {
  const row = newestFirst(rows, "updated_at").find((item) => text(item?.[field]));
  return row ? row[field] : "";
}

function mergeOriginalDocRows(rows) {
  const items = newestFirst(rows, "updated_at");
  if (!items.length) return null;
  const newest = items[0];
  const transferRow = items.find((item) => (
    item.transfer_received_override === true ||
    item.transfer_received_override === false
  ));
  return {
    ...newest,
    obl_received: items.some((item) => item.obl_received === true),
    hc_received: items.some((item) => item.hc_received === true),
    transfer_received_override: transferRow
      ? transferRow.transfer_received_override
      : null,
    actual_received_date: newestValue(items, "actual_received_date"),
    pending_actual_received_date: newestValue(items, "pending_actual_received_date"),
    pending_actual_received_date_by: newestValue(items, "pending_actual_received_date_by"),
    pending_actual_received_date_at: newestValue(items, "pending_actual_received_date_at"),
    approved_actual_received_date_by: newestValue(items, "approved_actual_received_date_by"),
    approved_actual_received_date_at: newestValue(items, "approved_actual_received_date_at"),
  };
}

function mergeLinkedOriginalDocs(card, cardRefs, docs) {
  return mergeOriginalDocRows(linkedRows(card, cardRefs, docs));
}

function latestLinkedRequest(card, cardRefs, requests) {
  return newestFirst(linkedRows(card, cardRefs, requests), "created_at")[0] || null;
}

module.exports = {
  cargoSourceKey,
  linkedAccountIds,
  linkedRows,
  mergeOriginalDocRows,
  mergeLinkedOriginalDocs,
  latestLinkedRequest,
};
