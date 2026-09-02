const REQUIRED_CARGO_SCHEMA_VERSION = "20260828090000";
const REQUIRED_CARGO_MIGRATION = "20260828090000_add_operational_hardening.sql";
const SUCCESS_CACHE_MS = 30 * 1000;

let verifiedAt = 0;

function isCompatibleCargoSchema(metadata) {
  if (!metadata) return false;
  const actualVersion = String(metadata.schema_version || "");
  if (!/^\d{14}$/.test(actualVersion)) return false;
  if (actualVersion < REQUIRED_CARGO_SCHEMA_VERSION) return false;
  return actualVersion !== REQUIRED_CARGO_SCHEMA_VERSION
    || String(metadata.migration_name || "") === REQUIRED_CARGO_MIGRATION;
}

class CargoSchemaMismatchError extends Error {
  constructor() {
    super(
      "서비스 데이터베이스 갱신이 필요합니다. "
      + REQUIRED_CARGO_MIGRATION
      + " 마이그레이션을 적용해 주세요."
    );
    this.name = "CargoSchemaMismatchError";
    this.code = "CARGO_SCHEMA_MISMATCH";
    this.httpStatus = 503;
    this.requiredMigration = REQUIRED_CARGO_MIGRATION;
    this.requiredVersion = REQUIRED_CARGO_SCHEMA_VERSION;
  }
}

async function assertCargoSchema(supabaseFetch, { force = false, now = Date.now() } = {}) {
  if (!force && verifiedAt && now - verifiedAt < SUCCESS_CACHE_MS) {
    return {
      component: "cargo_dashboard",
      schema_version: REQUIRED_CARGO_SCHEMA_VERSION,
      migration_name: REQUIRED_CARGO_MIGRATION,
      cached: true,
    };
  }

  let rows;
  try {
    rows = await supabaseFetch(
      "/rest/v1/cargo_system_metadata"
        + "?select=component,schema_version,migration_name"
        + "&component=eq.cargo_dashboard&limit=1",
      { method: "GET" }
    );
  } catch {
    throw new CargoSchemaMismatchError();
  }

  const metadata = Array.isArray(rows) ? rows[0] : rows;
  if (!isCompatibleCargoSchema(metadata)) {
    throw new CargoSchemaMismatchError();
  }
  verifiedAt = now;
  return metadata;
}

function cargoSchemaErrorPayload(error) {
  return {
    success: false,
    code: "CARGO_SCHEMA_MISMATCH",
    required_migration: REQUIRED_CARGO_MIGRATION,
    message: error?.code === "CARGO_SCHEMA_MISMATCH"
      ? error.message
      : new CargoSchemaMismatchError().message,
  };
}

function resetCargoSchemaCacheForTests() {
  verifiedAt = 0;
}

module.exports = {
  CargoSchemaMismatchError,
  REQUIRED_CARGO_MIGRATION,
  REQUIRED_CARGO_SCHEMA_VERSION,
  assertCargoSchema,
  cargoSchemaErrorPayload,
  resetCargoSchemaCacheForTests,
};
