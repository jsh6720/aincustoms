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

function effectiveArrivalDate(card) {
  return isoDate(card?.entry_date)
    || isoDate(card?.eta_date)
    || isoDate(card?.first_arrival_date);
}

function customsArrivalConfirmed(card) {
  return Boolean(isoDate(card?.entry_date));
}

function effectiveEtaDate(card) {
  return effectiveArrivalDate(card);
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

function customsQuarantinePassed(value, type) {
  const normalized = String(value || "").replace(/\s+/g, "");
  const expected = type === "animal"
    ? "검사/검역동물검역(합격)"
    : type === "food"
      ? "검사/검역식품의약품(합격)"
      : "";
  return Boolean(expected) && normalized.includes(expected);
}

function customsQuarantineFlags(card) {
  const progressText = [card?.prgs_stts, card?.cscl_prgs_stts]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const animalHistoryPassed = String(card?.animal_quarantine || "").trim() === "합격";
  const foodHistoryPassed = String(card?.food_quarantine || "").trim() === "합격";

  return {
    progressText,
    animalPassed: customsQuarantinePassed(progressText, "animal") || animalHistoryPassed,
    foodPassed: customsQuarantinePassed(progressText, "food") || foodHistoryPassed,
  };
}

function actualInboundLocationName(value) {
  return String(value || "")
    .trim()
    .replace(/\s*\([0-9A-Za-z/-]+\)\s*$/, "")
    .trim();
}

function progressStateText(card) {
  const state = String(
    card?.prgs_stts
      || card?.cscl_prgs_stts
      || (card?.stage === "입항전" ? "조회 전" : "-")
  ).trim();
  if (!state.startsWith("반입완료")) return state;

  const actualLocation = actualInboundLocationName(card?.shed_name);
  return actualLocation ? `반입완료(${actualLocation})` : state;
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
  customsArrivalConfirmed,
  effectiveArrivalDate,
  effectiveEtaDate,
  freeTimeExpiry,
  customsQuarantineFlags,
  customsQuarantinePassed,
  progressStateText,
  normalizeInspectionStatus,
  sortProgressCards,
};
