const OPTIONAL_PREFERENCE_KEYS = ["import_request", "warehouse_expected"];

function normalizeCalendarPreferences(value) {
  const preferences = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    OPTIONAL_PREFERENCE_KEYS.map((key) => [key, preferences[key] === false ? false : true])
  );
}

function validateCalendarPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Calendar preferences must be an object");
  }

  for (const [key, preference] of Object.entries(value)) {
    if (!OPTIONAL_PREFERENCE_KEYS.includes(key)) {
      throw new Error(`Unsupported calendar preference: ${key}`);
    }
    if (typeof preference !== "boolean") {
      throw new Error(`Calendar preference ${key} must be a boolean`);
    }
  }

  return normalizeCalendarPreferences(value);
}

module.exports = {
  normalizeCalendarPreferences,
  validateCalendarPreferences,
};
