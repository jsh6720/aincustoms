const STAGE_ORDER = ["입항전", "입항", "반입", "수입신고", "반출"];

function isoDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : "";
}

function addCalendarDays(value, days) {
  const dateText = isoDate(value);
  if (!dateText || !Number.isInteger(days)) return "";
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function effectiveEtaDate(card) {
  return isoDate(card?.eta_date) || isoDate(card?.first_arrival_date);
}

function freeTimeExpiry(card) {
  const override = isoDate(card?.free_time_expiry_override);
  if (override) return override;
  const base = effectiveEtaDate(card);
  if (!base) return "";
  const parsed = Number.parseInt(card?.free_time_days, 10);
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  return addCalendarDays(base, days - 1);
}

function normalizeInspectionStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!status) return null;
  if (["O", "△", "X"].includes(status)) return status;
  throw new Error("Invalid inspection status");
}

function destinationName(card) {
  return String(card?.destination || "").split("_")[0].trim();
}

function compareDatesMissingLast(left, right) {
  const a = effectiveEtaDate(left) || "9999-12-31";
  const b = effectiveEtaDate(right) || "9999-12-31";
  return a.localeCompare(b);
}

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(String(stage || ""));
  return index >= 0 ? index : STAGE_ORDER.length;
}

function sortProgressCards(cards) {
  return [...(cards || [])].sort((left, right) =>
    destinationName(left).localeCompare(destinationName(right), "ko") ||
    compareDatesMissingLast(left, right) ||
    stageRank(left.stage) - stageRank(right.stage) ||
    String(left.bl_number || "").localeCompare(String(right.bl_number || ""))
  );
}

module.exports = {
  STAGE_ORDER,
  effectiveEtaDate,
  freeTimeExpiry,
  normalizeInspectionStatus,
  sortProgressCards,
};
