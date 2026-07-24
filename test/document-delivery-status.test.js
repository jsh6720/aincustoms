const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260724_add_document_delivery_status.sql"
);
const migration = fs.existsSync(migrationPath)
  ? fs.readFileSync(migrationPath, "utf8")
  : "";
const dashboard = fs.readFileSync(path.join(root, "cargo-dashboard.html"), "utf8");
const cargoDataApi = fs.readFileSync(path.join(root, "api/cargo-data.js"), "utf8");
const cargoLoginApi = fs.readFileSync(path.join(root, "api/cargo-login.js"), "utf8");
const cargoAdminApi = fs.readFileSync(path.join(root, "api/cargo-admin.js"), "utf8");
const cargoQuotaApi = fs.readFileSync(path.join(root, "api/cargo-quota.js"), "utf8");
const linkedRecords = require("../lib/cargo-linked-records");

test("migration adds delivery status and account category", () => {
  assert.match(migration, /docs_delivered_samhyeon\s+boolean/i);
  assert.match(migration, /docs_delivered_warehouse\s+boolean/i);
  assert.match(migration, /account_category\s+text/i);
  assert.match(migration, /where\s+lower\(login_id\)\s*=\s*lower\('CTF'\)/i);
  assert.match(migration, /account_category\s*=\s*'destination'/i);
  assert.match(migration, /drop function if exists public\.verify_shipper_login\(text, text\)/i);
  assert.match(migration, /calendar_preferences\s+jsonb/i);
  assert.match(migration, /p_account_category\s+text/i);
});

test("linked accounts share the newest document delivery status", () => {
  const cards = [
    {
      account_id: "hch",
      bl_number: "BL-1",
      folder_name: "HCH_BL-1_CIF_CTF",
    },
    {
      account_id: "ctf",
      bl_number: "BL-1",
      folder_name: "HCH_BL-1_CIF_CTF",
    },
  ];
  const merged = linkedRecords.mergeLinkedDeliveryStatus(cards[0], cards, [
    {
      account_id: "hch",
      bl_number: "BL-1",
      docs_delivered_samhyeon: false,
      docs_delivered_warehouse: false,
      updated_at: "2026-07-24T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "BL-1",
      docs_delivered_samhyeon: true,
      docs_delivered_warehouse: false,
      updated_at: "2026-07-24T02:00:00Z",
    },
  ]);

  assert.equal(merged.docs_delivered_samhyeon, true);
  assert.equal(merged.docs_delivered_warehouse, false);
});

test("cargo APIs expose delivery state and account category", () => {
  assert.match(cargoDataApi, /docs_delivered_samhyeon/);
  assert.match(cargoDataApi, /docs_delivered_warehouse/);
  assert.match(cargoDataApi, /account_category/);
  assert.match(cargoLoginApi, /account_category/);
  assert.match(cargoAdminApi, /account_category/);
  assert.match(cargoAdminApi, /p_account_category/);
  assert.match(cargoQuotaApi, /docs_delivered_samhyeon/);
  assert.match(cargoQuotaApi, /docs_delivered_warehouse/);
  assert.match(cargoQuotaApi, /linkedDocumentDeliveryTargets/);
  assert.match(cargoQuotaApi, /session\.account_category/);
  assert.match(
    cargoDataApi,
    /obl_carrier_submitted_at,transport_updated_by_role,transport_updated_by_login,transport_updated_at,updated_at/
  );
  assert.match(cargoAdminApi, /if \(!String\(error\.message \|\| ""\)\.includes\("account_category"\)\) throw error/);
});

test("progress table places compact delivery controls immediately after state", () => {
  const headerStart = dashboard.indexOf('<th class="progress-long">진행상태</th>');
  const headerEnd = dashboard.indexOf('<th class="progress-short center progress-admin-only">동물검역</th>');
  const header = dashboard.slice(headerStart, headerEnd);
  assert.match(
    header,
    /진행상태<\/th>\s*<th[^>]*>서류전달<\/th>\s*<th[^>]*progress-shipper-only[^>]*>서류수령요청/
  );
  assert.match(dashboard, /삼현전달/);
  assert.match(dashboard, /창고전달/);
  assert.match(dashboard, /function progressDeliveryStatus/);
  assert.match(dashboard, /function toggleProgressDeliveryStatus/);
  assert.match(dashboard, /action:\s*"admin_status"/);
  assert.match(dashboard, /confirm\(/);
});

test("transport provenance distinguishes admin, shipper, and destination", () => {
  assert.match(dashboard, /function transportProvenanceLabel/);
  assert.match(dashboard, /관리자\(AIN\)/);
  assert.match(dashboard, /화주/);
  assert.match(dashboard, /납품처/);
  assert.match(dashboard, /transport_updated_by_role === "destination"/);
});
