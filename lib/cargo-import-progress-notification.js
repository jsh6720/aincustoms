const crypto = require("crypto");

const IMPORT_PROGRESS_STATUSES = new Set([
  "수입신고",
  "수입(사용소비) 심사진행",
]);
const MAX_SIGNATURE_AGE_SECONDS = 300;

function isImportProgressStatus(value) {
  return IMPORT_PROGRESS_STATUSES.has(String(value || "").trim());
}

function createSyncSignature(secret, timestamp, eventId) {
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(`${timestamp}.${eventId}`)
    .digest("hex");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySyncSignature({
  secret,
  timestamp,
  eventId,
  signature,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const timestampNumber = Number(timestamp);
  if (!secret || !eventId || !signature || !Number.isInteger(timestampNumber)) {
    return false;
  }
  if (Math.abs(nowSeconds - timestampNumber) > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }
  return secureEqual(
    createSyncSignature(secret, String(timestamp), eventId),
    signature
  );
}

module.exports = {
  IMPORT_PROGRESS_STATUSES,
  createSyncSignature,
  isImportProgressStatus,
  verifySyncSignature,
};
