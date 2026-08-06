const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260806_add_dawoorin_account.sql"
);

test("Dawoorin migration provisions one active destination account", () => {
  assert.ok(fs.existsSync(migrationPath), "Dawoorin account migration must exist");
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(migration, /lower\(login_id\)\s*=\s*lower\('DWR'\)/i);
  assert.match(migration, /extensions\.crypt\('dwr1234',\s*extensions\.gen_salt\('bf'\)\)/i);
  assert.match(migration, /display_name[\s\S]*'다우린'/i);
  assert.match(migration, /consignee_filter[\s\S]*'다우린'/i);
  assert.match(migration, /account_category[\s\S]*'destination'/i);
  assert.match(migration, /release_request_to[\s\S]*'ocm3800@hyundaicorp\.com'/i);
  assert.match(migration, /role[\s\S]*'shipper'/i);
  assert.match(migration, /is_active[\s\S]*true/i);
  assert.match(migration, /if\s+v_id\s+is\s+null\s+then[\s\S]*insert[\s\S]*else[\s\S]*update/i);
});
