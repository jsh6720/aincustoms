function validIsoDate(year, month, day) {
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (
    !Number.isInteger(yearNumber) ||
    !Number.isInteger(monthNumber) ||
    !Number.isInteger(dayNumber)
  ) {
    return "";
  }
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    date.getUTCFullYear() !== yearNumber ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber
  ) {
    return "";
  }
  return [
    String(yearNumber).padStart(4, "0"),
    String(monthNumber).padStart(2, "0"),
    String(dayNumber).padStart(2, "0"),
  ].join("-");
}

function referenceYear(referenceDate) {
  const match = String(referenceDate || "").match(/^(\d{4})/);
  if (match) return Number(match[1]);
  return new Date().getFullYear();
}

function normalizeOblDateInput(value, referenceDate) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const compact = raw.replace(/\s+/g, "");
  let match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return validIsoDate(match[1], match[2], match[3]);

  match = compact.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (match) return validIsoDate(2000 + Number(match[1]), match[2], match[3]);

  match = compact.match(/^(\d{2})(\d{2})$/);
  if (match) return validIsoDate(referenceYear(referenceDate), match[1], match[2]);

  match = compact.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (match) return validIsoDate(match[1], match[2], match[3]);

  match = compact.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (match) return validIsoDate(2000 + Number(match[1]), match[2], match[3]);

  match = compact.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (match) return validIsoDate(referenceYear(referenceDate), match[1], match[2]);

  return "";
}

module.exports = {
  normalizeOblDateInput,
};

