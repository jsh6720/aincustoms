const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260803_add_import_progress_notifications.sql"
);

test("notification migration stores one import event per HCH BL", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(
    migration,
    /create table if not exists public\.cargo_status_notifications/i
  );
  assert.match(migration, /event_key text not null unique/i);
  assert.match(
    migration,
    /check\s*\(status in\s*\('pending', 'sent', 'failed'\)\)/i
  );
  assert.match(
    migration,
    /references public\.shipper_accounts\(id\) on delete cascade/i
  );
  assert.match(migration, /grant all on table public\.cargo_status_notifications to service_role/i);
});

