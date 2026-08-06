const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const {
  buildWarehouseScheduleMail,
} = require("../lib/cargo-warehouse-schedule-notification");
const {
  createSyncSignature,
} = require("../lib/cargo-import-progress-notification");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260806_add_warehouse_schedule_notifications.sql"
);
const importRequestHandlerPath = path.join(root, "api/cargo-import-request.js");

function loadImportRequestHandler({ supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[importRequestHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === importRequestHandlerPath && request === "../lib/cargo-auth") {
      return {
        requireWritableSession: () => {
          throw new Error("automatic notification must not require a browser session");
        },
        supabaseFetch,
      };
    }
    if (parent?.filename === importRequestHandlerPath && request === "nodemailer") {
      return { createTransport: () => ({ sendMail }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(importRequestHandlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[importRequestHandlerPath];
  }
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withEnvironment(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const snapshot = {
  consignee: "현대코퍼레이션H",
  bl_number: "BL001",
  destination: "캐틀팜_우육_호주",
  product_name: "FROZEN BEEF",
  warehouse_expected_date: "2026-08-07",
  planned_storage_yard: "강동냉장 보세창고 (02111182)",
  obl_carrier_submitted: false,
  obl_warning: true,
};

test("warehouse schedule migration adds both planned event types", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /warehouse_arrival_eve/);
  assert.match(migration, /warehouse_arrival_today/);
  assert.match(migration, /import_progress_started/);
});

test("day-before mail includes the OBL warning and correction reply instruction", () => {
  const mail = buildWarehouseScheduleMail("warehouse_arrival_eve", snapshot);

  assert.match(mail.subject, /입고 예정 안내.*BL001/);
  assert.match(mail.text, /2026-08-07/);
  assert.match(mail.text, /강동냉장 보세창고/);
  assert.match(mail.text, /현재 OBL이 선사에 접수되지 않은 상태/);
  assert.match(mail.text, /jsh@aincustoms\.com으로 회신/);
});

test("same-day mail is separate and does not repeat the OBL warning", () => {
  const mail = buildWarehouseScheduleMail("warehouse_arrival_today", snapshot);

  assert.match(mail.subject, /오늘 입고 예정.*BL001/);
  assert.match(mail.text, /오늘은 아래 화물의 예정된 입고일입니다/);
  assert.doesNotMatch(mail.text, /현재 OBL이 선사에 접수되지 않은 상태/);
});

test("signed HCH warehouse schedule event uses notice role routing and marks sent", { concurrency: false }, async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "service-role-secret";
  const sentMail = [];
  const patches = [];
  const handler = loadImportRequestHandler({
    sendMail: async (mail) => sentMail.push(mail),
    supabaseFetch: async (url, options = {}) => {
      if (url.startsWith("/rest/v1/cargo_status_notifications?id=eq.event-warehouse")) {
        patches.push(JSON.parse(options.body));
        return [patches.at(-1)];
      }
      if (url.startsWith("/rest/v1/cargo_status_notifications?")) {
        return [{
          id: "event-warehouse",
          event_type: "warehouse_arrival_eve",
          account_id: "hch-id",
          bl_number: "BL001",
          status: "pending",
          attempt_count: 0,
          card_snapshot: snapshot,
        }];
      }
      if (url.startsWith("/rest/v1/shipper_accounts?")) {
        return [{ id: "hch-id", login_id: "HCH", display_name: "현대코퍼레이션H" }];
      }
      if (url.startsWith("/rest/v1/cargo_mail_settings?")) {
        const key = new URL(`https://example.invalid${url}`).searchParams
          .get("setting_key")
          ?.replace(/^eq\./, "");
        const settings = {
          ain_default: { to_recipients: ["ops@example.com"], cc_recipients: [] },
          shipper_default: { to_recipients: ["shipper@example.com"], cc_recipients: [] },
          destination_default: { to_recipients: ["destination@example.com"], cc_recipients: [] },
          warehouse_change: { to_recipients: [], cc_recipients: [] },
        };
        return settings[key] ? [{ setting_key: key, ...settings[key] }] : [];
      }
      throw new Error(`Unexpected Supabase URL: ${url}`);
    },
  });
  const response = createResponse();

  await withEnvironment({
    SUPABASE_SERVICE_ROLE_KEY: secret,
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "mailer@example.com",
    SMTP_PASS: "smtp-secret",
  }, () => handler({
    method: "POST",
    headers: {
      "x-cargo-sync-timestamp": timestamp,
      "x-cargo-sync-signature": createSyncSignature(secret, timestamp, "event-warehouse"),
    },
    body: { action: "auto_warehouse_schedule_notice", event_id: "event-warehouse" },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, "shipper@example.com,destination@example.com");
  assert.equal(sentMail[0].cc, "ops@example.com");
  assert.equal(patches[0].status, "sent");
});
