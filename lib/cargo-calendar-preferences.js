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

  const entries = Object.entries(value);
  for (const [key, preference] of entries) {
    if (!OPTIONAL_PREFERENCE_KEYS.includes(key)) {
      throw new Error(`Unsupported calendar preference: ${key}`);
    }
    if (typeof preference !== "boolean") {
      throw new Error(`Calendar preference ${key} must be a boolean`);
    }
  }

  if (
    entries.length !== OPTIONAL_PREFERENCE_KEYS.length
    || OPTIONAL_PREFERENCE_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(
      "Calendar preferences must contain exactly import_request and warehouse_expected"
    );
  }

  return normalizeCalendarPreferences(value);
}

module.exports = {
  normalizeCalendarPreferences,
  validateCalendarPreferences,
};
