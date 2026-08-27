const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_CARGO_MIGRATION,
  REQUIRED_CARGO_SCHEMA_VERSION,
  assertCargoSchema,
  cargoSchemaErrorPayload,
} = require("../lib/cargo-schema");

const root = path.resolve(__dirname, "..");

test("matching cargo schema version allows a write preflight", async () => {
  const calls = [];
  const metadata = await assertCargoSchema(async (url, options) => {
    calls.push({ url, options });
    return [{
      component: "cargo_dashboard",
      schema_version: REQUIRED_CARGO_SCHEMA_VERSION,
      migration_name: REQUIRED_CARGO_MIGRATION,
    }];
  }, { force: true });

  assert.equal(metadata.schema_version, "20260828090000");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /cargo_system_metadata/);
  assert.equal(calls[0].options.method, "GET");
});

test("schema mismatch is a sanitized actionable 503", async () => {
  await assert.rejects(
    assertCargoSchema(async () => [{
      component: "cargo_dashboard",
      schema_version: "old-version",
      migration_name: "old.sql",
    }], { force: true }),
    (error) => {
      assert.equal(error.code, "CARGO_SCHEMA_MISMATCH");
      assert.equal(error.httpStatus, 503);
      const payload = cargoSchemaErrorPayload(error);
      assert.equal(payload.required_migration, REQUIRED_CARGO_MIGRATION);
      assert.match(payload.message, /20260828090000_add_operational_hardening\.sql/);
      assert.doesNotMatch(JSON.stringify(payload), /service_role|sb_secret_|Bearer/i);
      return true;
    }
  );
});

test("metadata lookup failure is converted without exposing the upstream body", async () => {
  const secretMarker = ["sb", "secret_do_not_expose"].join("_");
  const upstream = new Error("Supabase 401: " + secretMarker);
  await assert.rejects(
    assertCargoSchema(async () => { throw upstream; }, { force: true }),
    (error) => {
      assert.equal(error.httpStatus, 503);
      assert.equal(error.code, "CARGO_SCHEMA_MISMATCH");
      assert.doesNotMatch(error.message, /sb_secret|401/i);
      assert.match(error.message, /20260828090000_add_operational_hardening\.sql/);
      return true;
    }
  );
});

test("all cargo mutations inherit schema preflight while cargo GET remains readable", () => {
  const authSource = fs.readFileSync(path.join(root, "lib/cargo-auth.js"), "utf8");
  const dataSource = fs.readFileSync(path.join(root, "api/cargo-data.js"), "utf8");
  const mutationApis = [
    "cargo-admin.js",
    "cargo-card-visibility.js",
    "cargo-data.js",
    "cargo-import-request.js",
    "cargo-original-doc-receipt-mail.js",
    "cargo-original-doc-request.js",
    "cargo-original-docs.js",
    "cargo-quota.js",
    "cargo-release-request.js",
    "cargo-revision.js",
    "cargo-login.js",
  ];

  assert.match(authSource, /assertCargoSchema\(rawSupabaseFetch\)/);
  assert.match(authSource, /method !== "GET".*method !== "HEAD"/s);
  assert.match(dataSource, /if \(req\.method === "PATCH"\)/);
  assert.match(dataSource, /if \(req\.method !== "GET"\)/);
  for (const file of mutationApis) {
    const source = fs.readFileSync(path.join(root, "api", file), "utf8");
    assert.match(source, /httpStatus \|\| 500|automaticDeliveryError/);
  }
});
