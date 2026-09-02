const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { buildMissingStickerMail } = require("../lib/cargo-missing-sticker-notification");
const { createSyncSignature } = require("../lib/cargo-import-progress-notification");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root, "supabase/migrations/20260902090000_add_missing_sticker_notifications.sql"
);
const importRequestHandlerPath = path.join(root, "api/cargo-import-request.js");

function loadImportRequestHandler({ supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[importRequestHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === importRequestHandlerPath && request === "../lib/cargo-auth") {
      return {
        requireWritableSession: () => { throw new Error("automatic notice cannot require session"); },
        supabaseFetch,
      };
    }
    if (parent?.filename === importRequestHandlerPath && request === "nodemailer") {
      return { createTransport: () => ({ sendMail }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(importRequestHandlerPath); }
  finally {
    Module._load = originalLoad;
    delete require.cache[importRequestHandlerPath];
  }
}

function createResponse() {
  return {
    statusCode: null, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withEnvironment(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await action(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const snapshot = {
  account_id: "hch-id",
  consignee: "현대코퍼레이션H",
  bl_number: "BL001",
  destination: "캐틀팜_우육_호주",
  warehouse_expected_date: "2026-09-04",
  storage_yard: "강동냉장 보세창고",
  missing_sticker_fields: ["스티커 작성", "스티커 요청"],
};

test("migration allows the daily missing sticker event and advances schema metadata", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /sticker_action_missing/);
  assert.match(migration, /20260902090000/);
});

test("sticker reminder mail lists the warehouse date and missing work", () => {
  const mail = buildMissingStickerMail(snapshot);
  assert.equal(mail.subject, "[스티커 작성·요청 확인] 현대코퍼레이션H_BL001 / 캐틀팜");
  assert.match(mail.text, /입고\(예정\)일: 2026-09-04/);
  assert.match(mail.text, /스티커 작성/);
  assert.match(mail.text, /스티커 요청/);
});

test("signed sticker event sends once to the four internal recipients", { concurrency: false }, async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "service-role-secret";
  const sentMail = [];
  const settlements = [];
  const handler = loadImportRequestHandler({
    sendMail: async (mail) => sentMail.push(mail),
    supabaseFetch: async (url, options = {}) => {
      if (url.includes("/rpc/claim_cargo_automatic_mail")) {
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload.p_allowed_event_types, ["sticker_action_missing"]);
        return [{
          id: "event-sticker", event_type: "sticker_action_missing",
          status: "sending", claim_token: "claim-sticker", claimed: true,
          card_snapshot: snapshot,
        }];
      }
      if (url.includes("/rpc/settle_cargo_mail")) {
        settlements.push(JSON.parse(options.body));
        return [{ id: "event-sticker", settled: true, status: settlements.at(-1).p_status }];
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
    SMTP_HOST: "smtp.example.com", SMTP_USER: "mailer@example.com", SMTP_PASS: "smtp-secret",
  }, () => handler({
    method: "POST",
    headers: {
      "x-cargo-sync-timestamp": timestamp,
      "x-cargo-sync-signature": createSyncSignature(secret, timestamp, "event-sticker"),
    },
    body: { action: "auto_missing_sticker_notice", event_id: "event-sticker" },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to,
    "jsh@aincustoms.com,jhcho@aincustoms.com,bill@aincustoms.com,ain@aincustoms.com");
  assert.equal(sentMail[0].cc, undefined);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].p_status, "sent");
});
