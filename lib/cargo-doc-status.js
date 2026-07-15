function normalizeDocFilesStatus(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function hasTransferDocument(value) {
  const status = normalizeDocFilesStatus(value);
  return Array.isArray(status.TRANSFER) && status.TRANSFER.length > 0;
}

module.exports = { hasTransferDocument, normalizeDocFilesStatus };
