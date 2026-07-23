const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260723_add_progress_request_metadata.sql"),
  "utf8"
);
const cargoDataApi = fs.readFileSync(path.join(root, "api/cargo-data.js"), "utf8");
const originalRequestApi = fs.readFileSync(
  path.join(root, "api/cargo-original-doc-request.js"),
  "utf8"
);
const importRequestApi = fs.readFileSync(
  path.join(root, "api/cargo-import-request.js"),
  "utf8"
);
const { koreaDate, normalizeIsoDate } = require("../lib/cargo-request-utils");

test("migration adds import request date and transport provenance", () => {
  assert.match(migration, /requested_import_date\s+date/i);
  assert.match(migration, /transport_updated_by_role\s+text/i);
  assert.match(migration, /transport_updated_by_login\s+text/i);
  assert.match(migration, /transport_updated_at\s+timestamptz/i);
});

test("cargo data merges request date and transport provenance", () => {
  assert.match(cargoDataApi, /requested_import_date/);
  assert.match(cargoDataApi, /last_import_requested_import_date/);
  assert.match(cargoDataApi, /transport_updated_by_role/);
  assert.match(cargoDataApi, /transport_updated_by_login/);
  assert.match(cargoDataApi, /transport_updated_at/);
});

test("Korea request date defaults deterministically", () => {
  assert.equal(koreaDate(new Date("2026-07-23T01:00:00Z")), "2026-07-23");
});

test("normalizes ISO request dates and rejects invalid values", () => {
  assert.equal(normalizeIsoDate(" 2026-07-23 ", "2026-07-22"), "2026-07-23");
  assert.equal(normalizeIsoDate("", "2026-07-22"), "2026-07-22");
  assert.equal(normalizeIsoDate("2026-02-29", "2026-07-22"), null);
  assert.equal(normalizeIsoDate("07/23/2026", "2026-07-22"), null);
});

test("request APIs contain the approved stage sets", () => {
  assert.match(originalRequestApi, /\["입항전",\s*"입항",\s*"반입"\]/);
  assert.match(importRequestApi, /\["입항",\s*"반입"\]/);
  assert.match(importRequestApi, /requested_import_date/);
});
