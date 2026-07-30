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
const deliveryDatesMigrationPath = path.join(
  root,
  "supabase/migrations/20260730_add_document_delivery_dates.sql"
);
const deliveryDatesMigration = fs.existsSync(deliveryDatesMigrationPath)
  ? fs.readFileSync(deliveryDatesMigrationPath, "utf8")
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

test("unrelated newer input rows never erase an existing delivered status", () => {
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
      docs_delivered_samhyeon: true,
      docs_delivered_warehouse: true,
      updated_at: "2026-07-24T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "BL-1",
      docs_delivered_samhyeon: false,
      docs_delivered_warehouse: false,
      updated_at: "2026-07-28T02:00:00Z",
    },
  ]);

  assert.equal(merged.docs_delivered_samhyeon, true);
  assert.equal(merged.docs_delivered_warehouse, true);
});

test("linked delivery status keeps the date from the row that set O", () => {
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
      docs_delivered_samhyeon: true,
      docs_delivered_samhyeon_date: "2026-07-22",
      docs_delivered_warehouse: true,
      docs_delivered_warehouse_date: "2026-07-23",
      updated_at: "2026-07-23T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "BL-1",
      docs_delivered_samhyeon: false,
      docs_delivered_samhyeon_date: null,
      docs_delivered_warehouse: false,
      docs_delivered_warehouse_date: null,
      updated_at: "2026-07-30T01:00:00Z",
    },
  ]);

  assert.equal(merged.docs_delivered_samhyeon, true);
  assert.equal(merged.docs_delivered_samhyeon_date, "2026-07-22");
  assert.equal(merged.docs_delivered_warehouse, true);
  assert.equal(merged.docs_delivered_warehouse_date, "2026-07-23");
});

test("delivery date migration adds separate dates without backfilling old O rows", () => {
  assert.match(deliveryDatesMigration, /docs_delivered_samhyeon_date\s+date/i);
  assert.match(deliveryDatesMigration, /docs_delivered_warehouse_date\s+date/i);
  assert.doesNotMatch(deliveryDatesMigration, /update\s+public\.cargo_card_user_inputs/i);
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
  assert.match(cargoQuotaApi, /linkedCardTargets/);
  assert.match(cargoQuotaApi, /session\.account_category/);
  assert.match(
    cargoDataApi,
    /cargoUserInputsQuery/
  );
  assert.match(cargoAdminApi, /if \(!String\(error\.message \|\| ""\)\.includes\("account_category"\)\) throw error/);
});

test("delivery toggle stores or clears the matching delivery date", () => {
  assert.match(cargoQuotaApi, /docs_delivered_samhyeon_date/);
  assert.match(cargoQuotaApi, /docs_delivered_warehouse_date/);
  assert.match(cargoQuotaApi, /const\s+deliveryDateFields\s*=\s*\{/);
  assert.match(
    cargoQuotaApi,
    /payload\[dateField\]\s*=\s*body\[field\]\s*\?\s*koreaDate\(\)\s*:\s*null/
  );
});

test("delivery O exposes its saved input date on hover", () => {
  assert.match(dashboard, /function progressDeliveryDateTitle/);
  assert.match(dashboard, /`입력일 \$\{displayDate\(date\)\}`/);
  assert.match(
    dashboard,
    /title="\$\{esc\(progressDeliveryDateTitle\(enabled,\s*date\)\)\}"/
  );
  assert.match(dashboard, /card\.docs_delivered_samhyeon_date/);
  assert.match(dashboard, /card\.docs_delivered_warehouse_date/);
});

test("progress table places compact delivery controls immediately after state", () => {
  const headerStart = dashboard.indexOf('<th class="progress-long">진행상태</th>');
  const headerEnd = dashboard.indexOf('<th class="progress-short center progress-admin-only progress-after-transfer">동물검역</th>');
  const header = dashboard.slice(headerStart, headerEnd);
  assert.match(
    header,
    /진행상태<\/th>\s*<th[^>]*progress-admin-only[^>]*>서류전달<\/th>\s*<th[^>]*progress-shipper-only[^>]*>서류수령요청/
  );
  assert.match(dashboard, /<td class="progress-delivery progress-admin-only progress-samhyeon-visible">/);
  assert.match(dashboard, /body\.viewer-progress \.progress-admin-only\s*\{\s*display:none;\s*\}/);
  assert.match(dashboard, /삼현전달/);
  assert.match(dashboard, /창고전달/);
  assert.match(dashboard, /function progressDeliveryStatus/);
  assert.match(dashboard, /function toggleProgressDeliveryStatus/);
  assert.match(dashboard, /action:\s*"admin_status"/);
  assert.match(dashboard, /confirm\(/);
});

test("admin progress table keeps enough width for every administrative column", () => {
  assert.match(
    dashboard,
    /\.progress-table\s*\{[^}]*min-width:\s*2280px/
  );
  assert.match(
    dashboard,
    /body\.shipper-progress \.progress-table\s*\{[^}]*min-width:\s*1980px/
  );
  assert.doesNotMatch(
    dashboard,
    /body:not\(\.shipper-progress\) \.progress-table\s*\{[^}]*min-width:\s*1860px/
  );
});

test("transport provenance distinguishes admin, shipper, and destination", () => {
  assert.match(dashboard, /function transportProvenanceLabel/);
  assert.match(dashboard, /관리자\(AIN\)/);
  assert.match(dashboard, /화주/);
  assert.match(dashboard, /납품처/);
  assert.match(dashboard, /transport_updated_by_role === "destination"/);
});
