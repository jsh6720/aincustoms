const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const {
  buildMissingWarehousePlanMail,
} = require("../lib/cargo-missing-warehouse-plan-notification");
const {
  createSyncSignature,
} = require("../lib/cargo-import-progress-notification");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260821_add_missing_warehouse_plan_notifications.sql"
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
  obl_carrier_submitted_date: "2026-08-20",
  missing_warehouse_plan_fields: ["반입예정구역", "반입예정일"],
};

test("migration allows the daily missing warehouse plan event", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(migration, /warehouse_plan_missing/);
  assert.match(migration, /manual_mail/);
});

test("missing warehouse plan mail identifies the OBL date and missing fields", () => {
  const mail = buildMissingWarehousePlanMail(snapshot);

  assert.equal(mail.subject, "[반입예정정보 입력 확인] 현대코퍼레이션H_BL001 / 캐틀팜");
  assert.match(mail.text, /OBL 접수일: 2026-08-20/);
  assert.match(mail.text, /반입예정구역/);
  assert.match(mail.text, /반입예정일/);
  assert.match(mail.text, /대시보드에서.*확인 후 입력/);
});

test("signed daily event sends to the three internal recipients and marks sent", { concurrency: false }, async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "service-role-secret";
  const sentMail = [];
  const settlements = [];
  const handler = loadImportRequestHandler({
    sendMail: async (mail) => sentMail.push(mail),
    supabaseFetch: async (url, options = {}) => {
      if (url.includes("/rpc/claim_cargo_automatic_mail")) {
        return [{
          id: "event-missing-plan",
          event_type: "warehouse_plan_missing",
          status: "sending",
          claim_token: "claim-missing-plan",
          claimed: true,
          card_snapshot: { ...snapshot, account_id: "hch-id" },
        }];
      }
      if (url.includes("/rpc/settle_cargo_mail")) {
        settlements.push(JSON.parse(options.body));
        return [{
          id: "event-missing-plan",
          settled: true,
          status: settlements.at(-1).p_status,
        }];
      }
      if (url.startsWith("/rest/v1/shipper_accounts?")) {
        return [{ id: "hch-id", login_id: "HCH", display_name: "현대코퍼레이션H" }];
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
      "x-cargo-sync-signature": createSyncSignature(secret, timestamp, "event-missing-plan"),
    },
    body: { action: "auto_missing_warehouse_plan_notice", event_id: "event-missing-plan" },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(sentMail.length, 1);
  assert.equal(
    sentMail[0].to,
    "jsh@aincustoms.com,jhcho@aincustoms.com,bill@aincustoms.com"
  );
  assert.equal(sentMail[0].cc, undefined);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].p_claim_token, "claim-missing-plan");
  assert.equal(settlements[0].p_status, "sent");
});
