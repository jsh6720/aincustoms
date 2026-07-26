const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAIL_SETTING_KEYS,
  normalizeMailSettings,
  resolveMailRecipients,
} = require("../lib/cargo-mail-settings");
const { normalizeOblDateInput } = require("../lib/cargo-date-input");
const { sortProgressCards } = require("../lib/cargo-progress-utils");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260726_add_cargo_mail_settings.sql"),
  "utf8"
);
const dashboard = fs.readFileSync(path.join(root, "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(root, "cargo-docs-mobile.html"), "utf8");
const adminApi = fs.readFileSync(path.join(root, "api/cargo-admin.js"), "utf8");
const mailApiSources = {
  original_doc_request: fs.readFileSync(path.join(root, "api/cargo-original-doc-request.js"), "utf8"),
  import_request: fs.readFileSync(path.join(root, "api/cargo-import-request.js"), "utf8"),
  release_request: fs.readFileSync(path.join(root, "api/cargo-release-request.js"), "utf8"),
  warehouse_change: fs.readFileSync(path.join(root, "api/cargo-quota.js"), "utf8"),
  original_doc_receipt: fs.readFileSync(path.join(root, "api/cargo-original-doc-receipt-mail.js"), "utf8"),
  obl_carrier_receipt: fs.readFileSync(path.join(root, "api/cargo-original-doc-receipt-mail.js"), "utf8"),
};

test("mail setting migration creates one keyed settings table", () => {
  assert.match(migration, /create table if not exists public\.cargo_mail_settings/i);
  assert.match(migration, /setting_key\s+text\s+primary key/i);
  assert.match(migration, /to_recipients\s+text/i);
  assert.match(migration, /cc_recipients\s+text/i);
  assert.match(migration, /updated_by\s+text/i);
});

test("mail settings expose every current email function", () => {
  assert.deepEqual(MAIL_SETTING_KEYS, [
    "original_doc_request",
    "import_request",
    "release_request",
    "warehouse_change",
    "original_doc_receipt",
    "obl_carrier_receipt",
  ]);
});

test("mail settings normalize known keys and recipient fields", () => {
  assert.deepEqual(
    normalizeMailSettings([
      {
        setting_key: "release_request",
        to_recipients: "ops@example.com; OPS@example.com",
        cc_recipients: "audit@example.com",
      },
      {
        setting_key: "unknown",
        to_recipients: "ignored@example.com",
        cc_recipients: "",
      },
    ]),
    {
      release_request: {
        to: ["ops@example.com"],
        cc: ["audit@example.com"],
      },
    }
  );
});

test("account request recipient overrides common To while common CC remains", () => {
  assert.deepEqual(
    resolveMailRecipients({
      accountOverride: "shipper@example.com",
      setting: {
        to_recipients: "common@example.com",
        cc_recipients: "audit@example.com",
      },
      fallbackTo: ["fallback@example.com"],
      extraCc: ["requester@example.com", "AUDIT@example.com"],
    }),
    {
      to: ["shipper@example.com"],
      cc: ["audit@example.com", "requester@example.com"],
    }
  );
});

test("common recipients fall back to legacy recipients when empty", () => {
  assert.deepEqual(
    resolveMailRecipients({
      setting: null,
      fallbackTo: ["fallback@example.com"],
      fallbackCc: ["fallback-cc@example.com"],
    }),
    {
      to: ["fallback@example.com"],
      cc: ["fallback-cc@example.com"],
    }
  );
});

test("OBL date input accepts MMDD, YYMMDD, ISO, and common separators", () => {
  const today = "2026-07-26";
  assert.equal(normalizeOblDateInput("0621", today), "2026-06-21");
  assert.equal(normalizeOblDateInput("260621", today), "2026-06-21");
  assert.equal(normalizeOblDateInput("2026-06-21", today), "2026-06-21");
  assert.equal(normalizeOblDateInput("06/21", today), "2026-06-21");
  assert.equal(normalizeOblDateInput("26.06.21", today), "2026-06-21");
  assert.equal(normalizeOblDateInput("0230", today), "");
  assert.equal(normalizeOblDateInput("260231", today), "");
});

test("progress sorting remains destination, arrival date, milestone, then BL", () => {
  const cards = [
    { bl_number: "B-5", destination: "Beta_misc", eta_date: "2026-07-01", stage: "입항전" },
    { bl_number: "A-4", destination: "Alpha_misc", eta_date: "", stage: "입항전" },
    { bl_number: "A-3", destination: "Alpha_misc", eta_date: "2026-07-02", stage: "반출" },
    { bl_number: "A-2", destination: "Alpha_more", eta_date: "2026-07-02", stage: "입항" },
    { bl_number: "A-1", destination: "Alpha_more", eta_date: "2026-07-02", stage: "입항전" },
  ];

  assert.deepEqual(
    sortProgressCards(cards).map((card) => card.bl_number),
    ["A-1", "A-2", "A-3", "A-4", "B-5"]
  );
});

test("dashboard places BL original immediately after OBL receipt date", () => {
  const tableStart = dashboard.indexOf('<table class="progress-table">');
  const headerStart = dashboard.indexOf("<thead>", tableStart);
  const headerEnd = dashboard.indexOf("</thead>", headerStart);
  const header = dashboard.slice(headerStart, headerEnd);
  assert.match(header, /OBL 접수일<\/th>\s*<th[^>]*>BL원본<\/th>/);

  const rowStart = dashboard.indexOf('document.getElementById("progressRows").innerHTML');
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.match(
    row,
    /progressOblCarrierToggle\(card\)\}<\/td>\s*<td[^>]*>\$\{progressDocToggle\(card, "obl"\)\}/
  );
});

test("dashboard and mobile normalize compact OBL date inputs", () => {
  assert.match(dashboard, /normalizeOblDateInput/);
  assert.match(mobile, /normalizeOblDateInput/);
  assert.match(mobile, /inputmode="numeric"/);
});

test("admin API and screen manage function-specific mail settings", () => {
  assert.match(adminApi, /cargo_mail_settings/);
  assert.match(adminApi, /action\s*===\s*"mail_settings"/);
  assert.match(dashboard, /기능별 메일 수신처/);
  assert.match(dashboard, /saveAdminMailSettings/);
});

test("every configured mail function is wired to its delivery API", () => {
  for (const [settingKey, source] of Object.entries(mailApiSources)) {
    assert.match(source, new RegExp(`["']${settingKey}["']`));
    assert.match(source, /resolveMailRecipients/);
  }
});
