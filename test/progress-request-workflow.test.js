const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "cargo-dashboard.html"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260723_add_progress_request_metadata.sql"),
  "utf8"
);
const cargoDataApi = fs.readFileSync(path.join(root, "api/cargo-data.js"), "utf8");
const originalRequestApi = fs.readFileSync(
  path.join(root, "api/cargo-original-doc-request.js"),
  "utf8"
);
const importRequestApi = fs.readFileSync(
  path.join(root, "api/cargo-import-request.js"),
  "utf8"
);
const importRequestHandlerPath = path.join(root, "api/cargo-import-request.js");
const quotaApi = fs.readFileSync(path.join(root, "api/cargo-quota.js"), "utf8");
const quotaHandlerPath = path.join(root, "api/cargo-quota.js");
const { koreaDate, normalizeIsoDate } = require("../lib/cargo-request-utils");

function loadImportRequestHandler({ verifySession, supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[importRequestHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === importRequestHandlerPath && request === "../lib/cargo-auth") {
      return {
        verifySession,
        requireWritableSession: (req, res) => verifySession(req, res),
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

function loadQuotaHandler({ verifySession, supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[quotaHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === quotaHandlerPath && request === "../lib/cargo-auth") {
      return {
        verifySession,
        requireWritableSession: (req, res) => verifySession(req, res),
        supabaseFetch,
      };
    }
    if (parent?.filename === quotaHandlerPath && request === "nodemailer") {
      return {
        createTransport: () => ({ sendMail }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(quotaHandlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[quotaHandlerPath];
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

function createQuotaFixture({
  currentInput = null,
  omitSavedUpdatedAt = false,
  session,
  previousInput,
  rollbackConflict = false,
  rollbackError = null,
  saveConflict = false,
  sendMail = async () => {},
  saveError = null,
}) {
  const storedPreviousInput = previousInput?.account_id
    ? {
        updated_at: previousInput.updated_at || "2026-07-22T00:00:00.000Z",
        ...previousInput,
      }
    : previousInput;
  const calls = {
    inputReads: 0,
    mail: [],
    rollbackPayload: null,
    rollbackUrl: null,
    savedPayload: null,
    saveUrl: null,
  };
  const handler = loadQuotaHandler({
    verifySession: () => session,
    sendMail: async (mail) => {
      calls.mail.push(mail);
      return sendMail(mail);
    },
    supabaseFetch: async (url, options) => {
      if (url.startsWith("/rest/v1/cargo_cards")) {
        return [{
          account_id: "account-1",
          bl_number: "BL-1",
          consignee: "Test shipper",
          storage_yard: "Card yard",
          warehouse_expected_date: "2026-07-20",
        }];
      }
      if (url.includes("cargo_card_user_inputs?select=*")) {
        calls.inputReads += 1;
        const input = calls.inputReads > 1 && currentInput
          ? currentInput
          : storedPreviousInput;
        return input?.account_id ? [input] : [];
      }
      if (calls.savedPayload) {
        calls.rollbackUrl = url;
        calls.rollbackPayload = JSON.parse(options.body);
        if (rollbackError) throw rollbackError;
        if (rollbackConflict) return [];
        return [{ ...storedPreviousInput, ...calls.rollbackPayload }];
      }
      calls.saveUrl = url;
      calls.savedPayload = JSON.parse(options.body);
      if (saveError) throw saveError;
      if (saveConflict) return [];
      const savedInput = {
        ...storedPreviousInput,
        ...calls.savedPayload,
      };
      if (!omitSavedUpdatedAt) {
        savedInput.updated_at = "2026-07-23T02:03:04.000Z";
      } else {
        delete savedInput.updated_at;
      }
      return [savedInput];
    },
  });
  return { calls, handler };
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

async function withFrozenDate(instant, action) {
  const RealDate = global.Date;
  global.Date = class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
  };
  try {
    return await action();
  } finally {
    global.Date = RealDate;
  }
}

test("migration adds import request date and transport provenance", () => {
  assert.match(migration, /requested_import_date\s+date/i);
  assert.match(migration, /transport_updated_by_role\s+text/i);
  assert.match(migration, /transport_updated_by_login\s+text/i);
  assert.match(migration, /transport_updated_at\s+timestamptz/i);
});

test("cargo data merges request date and transport provenance", () => {
  assert.match(cargoDataApi, /requested_import_date/);
  assert.match(cargoDataApi, /last_import_requested_import_date/);
  assert.match(cargoDataApi, /transport_updated_by_role/);
  assert.match(cargoDataApi, /transport_updated_by_login/);
  assert.match(cargoDataApi, /transport_updated_at/);
});

test("manual transport save honors explicit notification choice", () => {
  assert.match(quotaApi, /body\.send_notification === true/);
  assert.match(quotaApi, /transport_updated_by_role/);
  assert.match(quotaApi, /transport_updated_by_login/);
  assert.match(quotaApi, /transport_updated_at/);
});

test("existing transport save uses compare-and-set and conflicts without mail", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
      updated_at: "2026-07-22T01:02:03.000Z",
    },
    saveConflict: true,
  });
  const response = createResponse();

  await withEnvironment(
    {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        storage_yard: "Next yard",
        send_notification: true,
      },
    }, response)
  );

  assert.match(
    calls.saveUrl,
    /account_id=eq\.account-1&bl_number=eq\.BL-1&updated_at=eq\.2026-07-22T01%3A02%3A03\.000Z/
  );
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /새로고침.*다시 시도/);
  assert.equal(calls.mail.length, 0);
  assert.equal(calls.rollbackUrl, null);
});

test("shipper save-only persists provenance without SMTP", { concurrency: false }, async () => {
  const previousInput = {
    account_id: "account-1",
    bl_number: "BL-1",
    delivery_terms: "CIF",
    storage_yard: "Previous yard",
    warehouse_expected_date: "2026-07-24",
    transport_updated_by_role: "admin",
    transport_updated_by_login: "AIN",
    transport_updated_at: "2026-07-22T01:02:03.000Z",
  };
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput,
  });
  const response = createResponse();

  await withEnvironment(
    { SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" },
    () => withFrozenDate("2026-07-23T04:05:06.000Z", () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        delivery_terms: "FOB",
        storage_yard: "Next yard",
        send_notification: false,
      },
    }, response))
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.changed_fields, ["storage_yard"]);
  assert.equal(response.body.email_sent, false);
  assert.equal(response.body.email_message, "");
  assert.equal(calls.mail.length, 0);
  assert.equal(calls.savedPayload.transport_updated_by_role, "shipper");
  assert.equal(calls.savedPayload.transport_updated_by_login, "SHIPPER-1");
  assert.equal(calls.savedPayload.transport_updated_at, "2026-07-23T04:05:06.000Z");
});

test("admin transport save never sends mail", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
    },
  });
  const response = createResponse();

  await withEnvironment(
    { SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        account_id: "account-1",
        bl_number: "BL-1",
        storage_yard: "Next yard",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.changed_fields, []);
  assert.equal(response.body.email_sent, false);
  assert.equal(calls.mail.length, 0);
  assert.equal(calls.savedPayload.transport_updated_by_role, "admin");
  assert.equal(calls.savedPayload.transport_updated_by_login, "ADMIN-1");
});

test("shipper notification requires an effective warehouse change", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      delivery_terms: "CIF",
      storage_yard: "Same yard",
      warehouse_expected_date: "2026-07-24",
    },
  });
  const response = createResponse();

  await withEnvironment(
    { SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        delivery_terms: "FOB",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.changed_fields, []);
  assert.equal(response.body.email_sent, false);
  assert.equal(calls.mail.length, 0);
});

test("non-boolean notification values never send mail", { concurrency: false }, async () => {
  for (const sendNotification of ["true", 1]) {
    const { calls, handler } = createQuotaFixture({
      session: {
        account_id: "account-1",
        role: "shipper",
        login_id: "SHIPPER-1",
      },
      previousInput: {
        account_id: "account-1",
        bl_number: "BL-1",
        storage_yard: "Previous yard",
      },
    });
    const response = createResponse();

    await withEnvironment(
      {
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "mailer@example.com",
        SMTP_PASS: "secret",
      },
      () => handler({
        method: "POST",
        body: {
          action: "manual_fields",
          bl_number: "BL-1",
          storage_yard: "Next yard",
          send_notification: sendNotification,
        },
      }, response)
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.email_sent, false);
    assert.equal(response.body.email_message, "");
    assert.equal(calls.mail.length, 0);
  }
});

test("mail failure rolls back transport fields and previous provenance", { concurrency: false }, async () => {
  const previousInput = {
    account_id: "account-1",
    bl_number: "BL-1",
    delivery_terms: "CIF",
    storage_yard: "Previous yard",
    warehouse_expected_date: "2026-07-24",
    transport_updated_by_role: "admin",
    transport_updated_by_login: "AIN",
    transport_updated_at: "2026-07-22T01:02:03.000Z",
  };
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput,
    sendMail: async () => {
      throw new Error("SMTP rejected the message");
    },
  });
  const response = createResponse();

  await withEnvironment(
    {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        delivery_terms: "FOB",
        storage_yard: "Next yard",
        warehouse_expected_date: "2026-07-25",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 502);
  assert.equal(calls.mail.length, 1);
  assert.deepEqual(calls.rollbackPayload, {
    delivery_terms: "CIF",
    storage_yard: "Previous yard",
    warehouse_expected_date: "2026-07-24",
    transport_updated_by_role: "admin",
    transport_updated_by_login: "AIN",
    transport_updated_at: "2026-07-22T01:02:03.000Z",
  });
});

test("mail failure with a conflicting rollback never returns success", { concurrency: false }, async () => {
  const currentInput = {
    account_id: "account-1",
    bl_number: "BL-1",
    storage_yard: "Newer yard",
    updated_at: "2026-07-23T02:04:05.000Z",
  };
  const { calls, handler } = createQuotaFixture({
    currentInput,
    rollbackConflict: true,
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
      transport_updated_by_role: "admin",
      transport_updated_by_login: "AIN",
      transport_updated_at: "2026-07-22T01:02:03.000Z",
      updated_at: "2026-07-22T01:02:04.000Z",
    },
    sendMail: async () => {
      throw new Error("SMTP rejected the message");
    },
  });
  const response = createResponse();

  await withEnvironment(
    {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        storage_yard: "Next yard",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /저장 취소를 확인할 수 없습니다.*새로고침/);
  assert.equal(response.body.email_sent, false);
  assert.equal(response.body.email_message, "SMTP rejected the message");
  assert.deepEqual(response.body.input, currentInput);
  assert.equal(calls.inputReads, 2);
  assert.match(calls.rollbackUrl, /updated_at=eq\.2026-07-23T02%3A03%3A04\.000Z/);
});

test("mail failure without saved updated_at never returns success", { concurrency: false }, async () => {
  const currentInput = {
    account_id: "account-1",
    bl_number: "BL-1",
    storage_yard: "Next yard",
    updated_at: "2026-07-23T02:03:04.000Z",
  };
  const { calls, handler } = createQuotaFixture({
    currentInput,
    omitSavedUpdatedAt: true,
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
    },
    sendMail: async () => {
      throw new Error("SMTP rejected the message");
    },
  });
  const response = createResponse();

  await withEnvironment(
    {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        storage_yard: "Next yard",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /저장 취소를 확인할 수 없습니다.*새로고침/);
  assert.equal(response.body.email_sent, false);
  assert.equal(response.body.email_message, "SMTP rejected the message");
  assert.deepEqual(response.body.input, currentInput);
  assert.equal(calls.rollbackUrl, null);
  assert.equal(calls.inputReads, 2);
});

test("mail failure with a rollback error never returns success", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    rollbackError: new Error("rollback request failed"),
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
    },
    sendMail: async () => {
      throw new Error("SMTP rejected the message");
    },
  });
  const response = createResponse();

  await withEnvironment(
    {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    },
    () => handler({
      method: "POST",
      body: {
        action: "manual_fields",
        bl_number: "BL-1",
        storage_yard: "Next yard",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /저장 취소를 확인할 수 없습니다.*새로고침/);
  assert.equal(response.body.email_message, "SMTP rejected the message");
  assert.equal(calls.inputReads, 2);
});

test("missing provenance columns name the progress metadata migration", { concurrency: false }, async () => {
  const { handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      storage_yard: "Previous yard",
    },
    saveError: new Error("column transport_updated_at does not exist"),
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      action: "manual_fields",
      bl_number: "BL-1",
      storage_yard: "Next yard",
      send_notification: false,
    },
  }, response);

  assert.equal(response.statusCode, 500);
  assert.match(response.body.message, /add_progress_request_metadata\.sql/);
});

test("Korea request date defaults deterministically", () => {
  assert.equal(koreaDate(new Date("2026-07-22T15:30:00Z")), "2026-07-23");
});

test("normalizes ISO request dates and rejects invalid values", () => {
  assert.equal(normalizeIsoDate(" 2026-07-23 ", "2026-07-22"), "2026-07-23");
  assert.equal(normalizeIsoDate("", "2026-07-22"), "2026-07-22");
  assert.equal(normalizeIsoDate("2026-02-29", "2026-07-22"), null);
  assert.equal(normalizeIsoDate("07/23/2026", "2026-07-22"), null);
});

test("request APIs contain the approved stage sets", () => {
  assert.match(originalRequestApi, /\["입항전",\s*"입항",\s*"반입"\]/);
  assert.match(importRequestApi, /\["입항",\s*"반입"\]/);
  assert.match(importRequestApi, /requested_import_date/);
});

test("dashboard import request mode defaults and submits the requested import date", () => {
  assert.match(dashboard, /id="importRequestDateWrap"/);
  assert.match(dashboard, /id="importRequestDate" type="date"/);
  const openStart = dashboard.indexOf("async function openImportModal");
  const openEnd = dashboard.indexOf("function closeReleaseModal", openStart);
  const openBody = dashboard.slice(openStart, openEnd);
  assert.match(openBody, /last_import_requested_import_date \|\| koreaToday\(\)/);
  assert.match(openBody, /importRequestDateWrap"\)\.style\.display = ""/);

  const submitStart = dashboard.indexOf("async function submitReleaseRequest");
  const submitEnd = dashboard.indexOf("function openReceiptMailModal", submitStart);
  const submitBody = dashboard.slice(submitStart, submitEnd);
  assert.match(submitBody, /requested_import_date: document\.getElementById\("importRequestDate"\)\.value/);
  assert.match(submitBody, /if \(requestSubmitting\) return/);
  assert.match(submitBody, /requestSubmitBtn/);
  assert.match(submitBody, /await loadData\(\)/);
});

test("progress calendar includes the latest import request date", () => {
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  const body = dashboard.slice(start, end);
  assert.match(body, /last_import_requested_import_date/);
  assert.match(body, /수입신고요청/);
  assert.match(body, /type:\s*"import-request"/);
  assert.match(body, /originalReceiptTypes\.push\("OBL"\)/);
  assert.match(body, /originalReceiptTypes\.push\("H\/C"\)/);
  assert.match(body, /originalReceiptTypes\.join\(", "\)/);
  assert.match(body, /\(양도증\)/);
});

test("progress transport save sends an exact notification boolean and handles stale data", () => {
  const start = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const end = dashboard.indexOf("function openProgressStatus", start);
  const body = dashboard.slice(start, end);
  assert.match(body, /send_notification:\s*sendNotification === true/);
  assert.match(body, /response\.status === 409/);
  assert.match(body, /await loadData\(\)/);
  assert.match(body, /saveProgressWarehouseEditor\(sendNotification\)/);
});

test("import request handler defaults, persists, returns, and emails the Korea request date", { concurrency: false }, async () => {
  let persistedRequest;
  let sentMail;
  const handler = loadImportRequestHandler({
    verifySession: () => ({ account_id: "account-1", display_name: "테스트 화주" }),
    supabaseFetch: async (url, options) => {
      if (url.startsWith("/rest/v1/shipper_accounts")) {
        return [{ release_request_to: "ops@example.com" }];
      }
      if (url.startsWith("/rest/v1/cargo_cards")) {
        return [{ stage: "입항", bl_number: "BL-1", consignee: "테스트 화주" }];
      }
      if (url === "/rest/v1/cargo_import_requests") {
        assert.equal(options.method, "POST");
        persistedRequest = JSON.parse(options.body);
        return [{ id: "request-1", ...persistedRequest }];
      }
      throw new Error(`Unexpected Supabase URL: ${url}`);
    },
    sendMail: async (mail) => {
      sentMail = mail;
    },
  });
  const response = createResponse();

  await withEnvironment(
    { SMTP_HOST: "smtp.example.com", SMTP_USER: "mailer@example.com", SMTP_PASS: "secret" },
    () => withFrozenDate("2026-07-22T15:30:00Z", () => handler({
      method: "POST",
      body: {
        bl_number: "BL-1",
        requester_name: "담당자",
        requester_email: "requester@example.com",
      },
    }, response))
  );

  assert.equal(response.statusCode, 200);
  assert.equal(persistedRequest.requested_import_date, "2026-07-23");
  assert.equal(response.body.request.requested_import_date, "2026-07-23");
  assert.equal(response.body.email_sent, true);
  assert.equal(sentMail.to, "ops@example.com");
  assert.equal(sentMail.cc, "requester@example.com");
  assert.match(sentMail.text, /수입신고 요청일자: 2026-07-23/);
});

test("import request handler rejects invalid request dates before external calls", { concurrency: false }, async () => {
  let supabaseCalls = 0;
  const handler = loadImportRequestHandler({
    verifySession: () => ({ account_id: "account-1" }),
    supabaseFetch: async () => {
      supabaseCalls += 1;
      return [];
    },
    sendMail: async () => {
      throw new Error("mail should not be sent");
    },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      bl_number: "BL-1",
      requester_name: "담당자",
      requested_import_date: "2026-02-29",
    },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /수입신고 요청일자 형식/);
  assert.equal(supabaseCalls, 0);
});
