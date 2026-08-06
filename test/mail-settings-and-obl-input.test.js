const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAIL_SETTING_KEYS,
  effectiveMailSettings,
  normalizeMailSettings,
  resolveAccountDirectoryNoticeRecipients,
  resolveRoleMailRecipients,
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
  arrival_schedule_change: fs.readFileSync(path.join(root, "api/cargo-quota.js"), "utf8"),
  original_doc_receipt: fs.readFileSync(path.join(root, "api/cargo-original-doc-receipt-mail.js"), "utf8"),
  obl_carrier_receipt: fs.readFileSync(path.join(root, "api/cargo-original-doc-receipt-mail.js"), "utf8"),
};

test("mail setting migration creates one keyed settings table", () => {
  assert.match(migration, /create table if not exists public\.cargo_mail_settings/i);
  assert.match(migration, /setting_key\s+text\s+primary key/i);
  assert.match(migration, /to_recipients\s+text/i);
  assert.match(migration, /cc_recipients\s+text/i);
  assert.match(migration, /updated_by\s+text/i);
  assert.match(
    migration,
    /drop constraint if exists cargo_mail_settings_key_check/i,
    "legacy key constraints must be replaced without dropping saved mail settings"
  );
  assert.match(migration, /'arrival_schedule_change'/i);
  assert.match(migration, /'ain_default'/i);
  assert.match(migration, /'shipper_default'/i);
  assert.match(migration, /'destination_default'/i);
});

test("mail settings expose every current email function", () => {
  assert.deepEqual(MAIL_SETTING_KEYS, [
    "ain_default",
    "shipper_default",
    "destination_default",
    "original_doc_request",
    "import_request",
    "release_request",
    "warehouse_change",
    "arrival_schedule_change",
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

test("effective mail settings show saved recipients and current delivery fallbacks", () => {
  assert.deepEqual(
    effectiveMailSettings(
      [
        {
          setting_key: "release_request",
          to_recipients: "saved@example.com",
          cc_recipients: "",
        },
        {
          setting_key: "original_doc_receipt",
          to_recipients: "",
          cc_recipients: "saved-audit@example.com",
        },
      ],
      {
        RELEASE_REQUEST_TO: "ops1@example.com,ops2@example.com",
        NOTIFY_TO: "notify@example.com",
        SMTP_USER: "sender@example.com",
      }
    ),
    {
      ain_default: {
        to: ["jsh@aincustoms.com", "jhcho@aincustoms.com", "bill@aincustoms.com", "ain@aincustoms.com"],
        cc: [],
      },
      shipper_default: {
        to: ["dmswk@hyundaicorp.com", "ye25@hyundaicorp.com"],
        cc: [],
      },
      destination_default: {
        to: [],
        cc: [],
      },
      original_doc_request: {
        to: ["ops1@example.com", "ops2@example.com", "notify@example.com", "sender@example.com"],
        cc: [],
      },
      import_request: {
        to: ["ops1@example.com", "ops2@example.com", "notify@example.com", "sender@example.com"],
        cc: [],
      },
      release_request: {
        to: ["saved@example.com"],
        cc: [],
      },
      warehouse_change: {
        to: ["jsh@aincustoms.com", "jhcho@aincustoms.com", "bill@aincustoms.com", "ain@aincustoms.com"],
        cc: [],
      },
      arrival_schedule_change: {
        to: [],
        cc: [],
      },
      original_doc_receipt: {
        to: ["dmswk@hyundaicorp.com", "ye25@hyundaicorp.com"],
        cc: ["saved-audit@example.com"],
      },
      obl_carrier_receipt: {
        to: ["dmswk@hyundaicorp.com", "ye25@hyundaicorp.com"],
        cc: ["jsh@aincustoms.com", "jhcho@aincustoms.com", "bill@aincustoms.com"],
      },
    }
  );
});

test("role mail routing sends requests to AIN and notices to shipper plus destination", () => {
  const settings = {
    ain_default: { to: ["ops@example.com"], cc: ["audit@example.com"] },
    shipper_default: { to: ["shipper@example.com"], cc: [] },
    destination_default: { to: ["destination@example.com"], cc: [] },
  };

  assert.deepEqual(
    resolveRoleMailRecipients({
      settings,
      direction: "request",
      extraCc: "requester@example.com",
    }),
    {
      to: ["ops@example.com", "audit@example.com"],
      cc: ["shipper@example.com", "destination@example.com", "requester@example.com"],
    }
  );
  assert.deepEqual(
    resolveRoleMailRecipients({ settings, direction: "notice" }),
    {
      to: ["shipper@example.com", "destination@example.com"],
      cc: ["ops@example.com", "audit@example.com"],
    }
  );
});

test("notice recipients match shipper and destination account display names", () => {
  const accounts = [
    {
      display_name: "현대코퍼레이션H",
      consignee_filter: "현대코",
      release_request_to: "shipper@example.com",
      account_category: "shipper",
      is_active: true,
    },
    {
      display_name: "캐틀팜",
      consignee_filter: "캐틀팜",
      release_request_to: "destination@example.com",
      account_category: "destination",
      is_active: true,
    },
  ];

  assert.deepEqual(
    resolveAccountDirectoryNoticeRecipients({
      accounts,
      card: {
        consignee: "현대코퍼레이션H",
        destination: "캐틀팜_우육_호주",
      },
      ainRecipients: ["ops@example.com"],
    }),
    {
      to: ["shipper@example.com", "destination@example.com"],
      cc: ["ops@example.com"],
    }
  );
});

test("notice recipients include a legacy destination account even when its category is shipper", () => {
  const accounts = [
    {
      login_id: "HCH",
      display_name: "현대코퍼레이션H",
      consignee_filter: "현대코",
      release_request_to: "dmswk@hyundaicorp.com,ye25@hyundaicorp.com",
      account_category: "shipper",
      role: "shipper",
      is_active: true,
    },
    {
      login_id: "CTF",
      display_name: "캐틀팜",
      consignee_filter: "캐틀팜",
      release_request_to: "cattlefarm9292@gmail.com",
      account_category: "shipper",
      role: "shipper",
      is_active: true,
    },
    {
      login_id: "aincustoms",
      display_name: "캐틀팜 관리자",
      consignee_filter: "캐틀팜",
      release_request_to: "admin@example.com",
      account_category: "shipper",
      role: "admin",
      is_active: true,
    },
  ];

  assert.deepEqual(
    resolveAccountDirectoryNoticeRecipients({
      accounts,
      card: {
        consignee: "현대코퍼레이션H",
        destination: "캐틀팜_우육_호주",
      },
      ainRecipients: [
        "jsh@aincustoms.com",
        "jhcho@aincustoms.com",
        "bill@aincustoms.com",
        "ain@aincustoms.com",
      ],
    }),
    {
      to: [
        "dmswk@hyundaicorp.com",
        "ye25@hyundaicorp.com",
        "cattlefarm9292@gmail.com",
      ],
      cc: [
        "jsh@aincustoms.com",
        "jhcho@aincustoms.com",
        "bill@aincustoms.com",
        "ain@aincustoms.com",
      ],
    }
  );
});

test("missing destination account is omitted and a future matching account is automatic", () => {
  const shipper = {
    display_name: "현대코퍼레이션H",
    consignee_filter: "현대코",
    release_request_to: "shipper@example.com",
    account_category: "shipper",
    is_active: true,
  };
  const card = {
    consignee: "현대코퍼레이션H",
    destination: "다우린_계육_브라질",
  };

  assert.deepEqual(
    resolveAccountDirectoryNoticeRecipients({
      accounts: [shipper],
      card,
      ainRecipients: ["ops@example.com"],
    }),
    { to: ["shipper@example.com"], cc: ["ops@example.com"] }
  );

  assert.deepEqual(
    resolveAccountDirectoryNoticeRecipients({
      accounts: [
        shipper,
        {
          display_name: "다우린",
          consignee_filter: "다우린",
          release_request_to: "dawoorin@example.com",
          account_category: "destination",
          is_active: true,
        },
      ],
      card,
      ainRecipients: ["ops@example.com"],
    }),
    {
      to: ["shipper@example.com", "dawoorin@example.com"],
      cc: ["ops@example.com"],
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

test("dashboard groups OBL receipt, BL original, H/C original, and transfer columns", () => {
  const tableStart = dashboard.indexOf('<table class="progress-table">');
  const headerStart = dashboard.indexOf("<thead>", tableStart);
  const headerEnd = dashboard.indexOf("</thead>", headerStart);
  const header = dashboard.slice(headerStart, headerEnd);
  assert.match(
    header,
    /OBL 접수일<\/th>\s*<th[^>]*>BL원본<\/th>\s*<th[^>]*>H\/C원본<\/th>\s*<th[^>]*>양도증<\/th>/
  );

  const rowStart = dashboard.indexOf('document.getElementById("progressRows").innerHTML');
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.match(
    row,
    /progressOblCarrierToggle\(card\)\}<\/td>\s*<td[^>]*>\$\{progressDocToggle\(card, "obl"\)\}<\/td>\s*<td[^>]*>\$\{progressDocToggle\(card, "hc"\)\}<\/td>\s*<td[^>]*>\$\{progressTransferDocToggle\(card\)\}/
  );
});

test("dashboard and mobile normalize compact OBL date inputs", () => {
  assert.match(dashboard, /normalizeOblDateInput/);
  assert.match(mobile, /normalizeOblDateInput/);
  assert.match(mobile, /inputmode="numeric"/);
});

test("admin API and screen manage function-specific mail settings", () => {
  assert.match(adminApi, /cargo_mail_settings/);
  assert.match(adminApi, /effectiveMailSettings/);
  assert.match(adminApi, /action\s*===\s*"mail_settings"/);
  assert.match(dashboard, /기능별 메일 수신처/);
  assert.match(dashboard, /기본 메일 - 관리자\(AIN\)/);
  assert.match(dashboard, /기본 메일 - 화주/);
  assert.match(dashboard, /기본 메일 - 납품처/);
  assert.match(dashboard, /현재 실제 발송에 적용되는 주소/);
  assert.match(dashboard, /saveAdminMailSettings/);
  assert.match(dashboard, /입항일 변경 안내/);
  assert.match(dashboard, /previewProgressTransportMail/);
  assert.match(dashboard, /메일 발송 전 확인/);
  assert.match(dashboard, /기본 이메일/);
  assert.match(dashboard, /화주·납품처 표시명과 화물 정보가 일치하면 안내 메일 주소로 자동 사용됩니다/);
  assert.match(adminApi, /add_cargo_mail_settings\.sql/);
});

test("every configured mail function is wired to its delivery API", () => {
  for (const [settingKey, source] of Object.entries(mailApiSources)) {
    assert.match(source, new RegExp(`["']${settingKey}["']`));
    if (["original_doc_receipt", "obl_carrier_receipt"].includes(settingKey)) {
      assert.match(source, /resolveMailRecipients/);
      assert.match(source, /defaultMailSettings/);
    } else if (["warehouse_change", "arrival_schedule_change"].includes(settingKey)) {
      assert.match(source, /resolveDirectoryNoticeRecipients/);
      assert.match(source, /fetchEffectiveRoleMailSettings/);
    } else {
      assert.match(source, /resolveRoleMailRecipients/);
      assert.match(source, /fetchEffectiveRoleMailSettings/);
    }
  }
});
