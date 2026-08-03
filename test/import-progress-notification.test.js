const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const {
  createSyncSignature,
  isImportProgressStatus,
  verifySyncSignature,
} = require("../lib/cargo-import-progress-notification");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260803_add_import_progress_notifications.sql"
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
      return {
        createTransport: () => ({ sendMail }),
      };
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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function withEnvironment(values, action) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
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
  assert.match(migration, /rollout baseline: historical mail suppressed/i);
  assert.match(migration, /on conflict \(event_key\) do nothing/i);
});

test("automatic import progress accepts only the two exact progress labels", () => {
  assert.equal(isImportProgressStatus("수입신고"), true);
  assert.equal(isImportProgressStatus("수입(사용소비) 심사진행"), true);
  assert.equal(isImportProgressStatus("수입신고전"), false);
  assert.equal(isImportProgressStatus("수입신고수리"), false);
});

test("sync signature binds the event id and timestamp", () => {
  const secret = "service-role-secret";
  const timestamp = "1785720000";
  const eventId = "event-1";
  const signature = createSyncSignature(secret, timestamp, eventId);

  assert.equal(
    verifySyncSignature({ secret, timestamp, eventId, signature, nowSeconds: 1785720000 }),
    true
  );
  assert.equal(
    verifySyncSignature({ secret, timestamp, eventId: "event-2", signature, nowSeconds: 1785720000 }),
    false
  );
  assert.equal(
    verifySyncSignature({ secret, timestamp, eventId, signature, nowSeconds: 1785720601 }),
    false
  );
});

test("signed HCH progress event sends once and marks the ledger sent", { concurrency: false }, async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "service-role-secret";
  const signature = createSyncSignature(secret, timestamp, "event-1");
  const sentMail = [];
  const patches = [];
  const handler = loadImportRequestHandler({
    sendMail: async (mail) => sentMail.push(mail),
    supabaseFetch: async (url, options = {}) => {
      if (url.startsWith("/rest/v1/cargo_status_notifications?id=eq.event-1")) {
        patches.push(JSON.parse(options.body));
        return [patches.at(-1)];
      }
      if (url.startsWith("/rest/v1/cargo_status_notifications?")) {
        return [{
          id: "event-1",
          event_type: "import_progress_started",
          account_id: "hch-id",
          bl_number: "BL001",
          detected_status: "수입신고",
          status: "pending",
          attempt_count: 0,
        }];
      }
      if (url.startsWith("/rest/v1/shipper_accounts?")) {
        return [{ id: "hch-id", login_id: "HCH", display_name: "현대코퍼레이션H" }];
      }
      if (url.startsWith("/rest/v1/cargo_cards?")) {
        return [{
          account_id: "hch-id",
          bl_number: "BL001",
          consignee: "현대코퍼레이션H",
          destination: "캐틀팜",
          prgs_stts: "수입(사용소비) 심사진행",
        }];
      }
      if (url.startsWith("/rest/v1/cargo_mail_settings?")) {
        assert.match(url, /setting_key=eq\.original_doc_receipt/);
        return [{
          setting_key: "original_doc_receipt",
          to_recipients: ["shipper@example.com"],
          cc_recipients: ["ops@example.com"],
        }];
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
      "x-cargo-sync-signature": signature,
    },
    body: { action: "auto_import_progress_notice", event_id: "event-1" },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, "shipper@example.com");
  assert.equal(sentMail[0].cc, "ops@example.com");
  assert.match(sentMail[0].subject, /수입신고 진행 안내.*BL001/);
  assert.match(sentMail[0].text, /수입\(사용소비\) 심사진행/);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].status, "sent");
  assert.equal(patches[0].attempt_count, 1);
  assert.ok(patches[0].sent_at);
});

test("already sent HCH progress event is idempotent", { concurrency: false }, async () => {
  let sentMail = false;
  const secret = "service-role-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const handler = loadImportRequestHandler({
    sendMail: async () => { sentMail = true; },
    supabaseFetch: async (url) => {
      if (url.startsWith("/rest/v1/cargo_status_notifications?")) {
        return [{
          id: "event-1",
          event_type: "import_progress_started",
          account_id: "hch-id",
          bl_number: "BL001",
          status: "sent",
        }];
      }
      throw new Error(`Unexpected Supabase URL: ${url}`);
    },
  });
  const response = createResponse();

  await withEnvironment({ SUPABASE_SERVICE_ROLE_KEY: secret }, () => handler({
    method: "POST",
    headers: {
      "x-cargo-sync-timestamp": timestamp,
      "x-cargo-sync-signature": createSyncSignature(secret, timestamp, "event-1"),
    },
    body: { action: "auto_import_progress_notice", event_id: "event-1" },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.deduplicated, true);
  assert.equal(sentMail, false);
});

test("automatic progress event rejects an invalid sync signature", { concurrency: false }, async () => {
  let supabaseCalled = false;
  const handler = loadImportRequestHandler({
    sendMail: async () => {},
    supabaseFetch: async () => {
      supabaseCalled = true;
      return [];
    },
  });
  const response = createResponse();

  await withEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "service-role-secret" }, () => handler({
    method: "POST",
    headers: {
      "x-cargo-sync-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-cargo-sync-signature": "invalid",
    },
    body: { action: "auto_import_progress_notice", event_id: "event-1" },
  }, response));

  assert.equal(response.statusCode, 401);
  assert.equal(supabaseCalled, false);
});
