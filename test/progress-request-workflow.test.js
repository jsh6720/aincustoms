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
const originalRequestHandlerPath = path.join(root, "api/cargo-original-doc-request.js");
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

function loadOriginalRequestHandler({ verifySession, supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[originalRequestHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === originalRequestHandlerPath && request === "../lib/cargo-auth") {
      return {
        verifySession,
        requireWritableSession: (req, res) => verifySession(req, res),
        supabaseFetch,
      };
    }
    if (parent?.filename === originalRequestHandlerPath && request === "nodemailer") {
      return {
        createTransport: () => ({ sendMail }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(originalRequestHandlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[originalRequestHandlerPath];
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
  cardRows = null,
  currentInput = null,
  omitSavedUpdatedAt = false,
  session,
  previousInput,
  rollbackConflict = false,
  rollbackError = null,
  saveConflict = false,
  sendMail = async () => {},
  mailSettings = {},
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
      if (url.includes("/rest/v1/cargo_mail_settings")) {
        const settingKey = decodeURIComponent((url.match(/setting_key=eq\.([^&]+)/) || [])[1] || "");
        const setting = mailSettings[settingKey];
        return setting ? [{ setting_key: settingKey, ...setting }] : [];
      }
      if (url.startsWith("/rest/v1/cargo_cards")) {
        const defaults = [{
          account_id: "account-1",
          bl_number: "BL-1",
          consignee: "Test shipper",
          folder_name: "Test shipper_BL-1_CIF_Destination",
          storage_yard: "Card yard",
          warehouse_expected_date: "2026-07-20",
        }];
        const rows = cardRows || defaults;
        return url.includes("&limit=1") ? rows.slice(0, 1) : rows;
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

test("admin can explicitly email one arrival schedule change to configured shipper and destination", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-04-21",
      free_time_days: 3,
    },
    cardRows: [{
      account_id: "account-1",
      bl_number: "BL-1",
      consignee: "현대코퍼레이션H",
      destination: "캐틀팜*우육*호주",
    }],
    mailSettings: {
      arrival_schedule_change: {
        to_recipients: "shipper@example.com",
        cc_recipients: "destination@example.com",
      },
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
        account_id: "account-1",
        bl_number: "BL-1",
        eta_date: "2026-04-22",
        send_notification: true,
      },
    }, response)
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(calls.mail.length, 1);
  assert.equal(calls.mail[0].to, "shipper@example.com");
  assert.equal(calls.mail[0].cc, "destination@example.com");
  assert.match(calls.mail[0].subject, /입항 스케줄 변경/);
  assert.match(calls.mail[0].text, /입항: 4\/22/);
  assert.match(calls.mail[0].text, /만기\(프리타임\): 4\/24/);
});

test("arrival schedule preview uses role recipients and has no save or mail side effects", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "MEDUWE188588",
      eta_date: "2026-08-10",
      free_time_days: 3,
    },
    cardRows: [{
      account_id: "account-1",
      bl_number: "MEDUWE188588",
      consignee: "현대코퍼레이션H",
      destination: "다우린_계육_브라질",
    }],
    mailSettings: {
      ain_default: {
        to_recipients: "ain@example.com",
        cc_recipients: "",
      },
      shipper_default: {
        to_recipients: "shipper@example.com",
        cc_recipients: "",
      },
      destination_default: {
        to_recipients: "destination@example.com",
        cc_recipients: "",
      },
    },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      action: "preview_transport_mail",
      mail_type: "arrival",
      account_id: "account-1",
      bl_number: "MEDUWE188588",
      eta_date: "2026-08-11",
      free_time_days: 3,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.preview.to, [
    "shipper@example.com",
    "destination@example.com",
  ]);
  assert.deepEqual(response.body.preview.cc, ["ain@example.com"]);
  assert.equal(
    response.body.preview.subject,
    "[입항 스케줄 변경] 현대_MEDUWE188588 / 다우린"
  );
  assert.match(response.body.preview.text, /화주: 현대코퍼레이션H/);
  assert.match(response.body.preview.text, /납품처: 다우린/);
  assert.match(response.body.preview.text, /입항: 8\/11/);
  assert.match(response.body.preview.text, /만기\(프리타임\): 8\/13/);
  assert.equal(calls.savedPayload, null);
  assert.equal(calls.mail.length, 0);
});

test("admin can review and override arrival schedule recipients for one send", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-04-21",
      free_time_days: 3,
    },
    cardRows: [{
      account_id: "account-1",
      bl_number: "BL-1",
      consignee: "현대코퍼레이션H",
      destination: "캐틀팜*우육*호주",
    }],
    mailSettings: {
      arrival_schedule_change: {
        to_recipients: "configured@example.com",
        cc_recipients: "configured-cc@example.com",
      },
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
        account_id: "account-1",
        bl_number: "BL-1",
        eta_date: "2026-04-22",
        send_notification: true,
        notification_to: "reviewed@example.com",
        notification_cc: "reviewed-cc@example.com",
      },
    }, response)
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, true);
  assert.equal(calls.mail[0].to, "reviewed@example.com");
  assert.equal(calls.mail[0].cc, "reviewed-cc@example.com");
  assert.match(calls.mail[0].text, /입항: 4\/22/);
  assert.match(calls.mail[0].text, /만기\(프리타임\): 4\/24/);
});

test("arrival schedule mail is skipped when the effective ETA did not change", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-04-22",
    },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      action: "manual_fields",
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-04-22",
      storage_yard: "변경창고",
      send_notification: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.email_sent, false);
  assert.equal(calls.mail.length, 0);
});

test("administrator can confirm ETA and propagates the atomic value and flag to linked accounts", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    cardRows: [
      {
        account_id: "account-1",
        bl_number: "BL-1",
        folder_name: "Shared_BL-1_CIF_Destination",
      },
      {
        account_id: "destination-1",
        bl_number: "BL-1",
        folder_name: "Shared_BL-1_CIF_Destination",
      },
      {
        account_id: "unrelated-1",
        bl_number: "BL-1",
        folder_name: "Different_BL-1_CIF_Destination",
      },
    ],
    session: {
      account_id: "admin-account",
      role: "admin",
      login_id: "ADMIN-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-07-30",
    },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      action: "manual_fields",
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-07-31",
      confirm_field: "eta_date",
      confirmation_action: "confirm",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.savedPayload.map((row) => row.account_id), [
    "account-1",
    "destination-1",
  ]);
  assert.equal(calls.savedPayload[0].eta_date, "2026-07-31");
  assert.equal(calls.savedPayload[0].eta_date_confirmed, true);
  assert.equal(calls.savedPayload[1].eta_date, "2026-07-31");
  assert.equal(calls.savedPayload[1].eta_date_confirmed, true);
});

test("non-admin accounts cannot change a transport confirmation flag", { concurrency: false }, async () => {
  const { calls, handler } = createQuotaFixture({
    session: {
      account_id: "account-1",
      role: "shipper",
      login_id: "SHIPPER-1",
    },
    previousInput: {
      account_id: "account-1",
      bl_number: "BL-1",
      eta_date: "2026-07-30",
    },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      action: "manual_fields",
      bl_number: "BL-1",
      eta_date: "2026-07-31",
      confirm_field: "eta_date",
      confirmation_action: "confirm",
    },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.success, false);
  assert.equal(calls.savedPayload, null);
});

test("ordinary transport changes clear the matching confirmation flag", { concurrency: false }, async () => {
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
      storage_yard_confirmed: true,
    },
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

  assert.equal(response.statusCode, 200);
  assert.equal(calls.savedPayload.storage_yard, "Next yard");
  assert.equal(calls.savedPayload.storage_yard_confirmed, false);
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
    storage_yard_confirmed: false,
    warehouse_expected_date_confirmed: false,
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

test("request APIs contain the approved eligibility rules", () => {
  assert.match(originalRequestApi, /obl_received !== true/);
  assert.match(originalRequestApi, /hc_received !== true/);
  assert.match(importRequestApi, /\["입항",\s*"반입"\]/);
  assert.match(importRequestApi, /requested_import_date/);
});

test("original document request accepts later milestones while either original is missing", { concurrency: false }, async () => {
  let persistedRequest;
  const handler = loadOriginalRequestHandler({
    verifySession: () => ({ account_id: "account-1", display_name: "Test shipper" }),
    supabaseFetch: async (url, options) => {
      if (url.startsWith("/rest/v1/shipper_accounts")) return [{ release_request_to: "" }];
      if (url.startsWith("/rest/v1/cargo_cards")) {
        return [{
          account_id: "account-1",
          bl_number: "BL-LATE",
          stage: "수입신고",
          obl_received: false,
          hc_received: true,
        }];
      }
      if (url === "/rest/v1/cargo_original_doc_requests" && options?.method === "POST") {
        persistedRequest = JSON.parse(options.body);
        return [{ id: "request-1", ...persistedRequest }];
      }
      return [];
    },
    sendMail: async () => {},
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      bl_number: "BL-LATE",
      requester_name: "Requester",
      requester_email: "",
      requested_receipt_date: "2026-07-30",
      memo: "Updated request",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(persistedRequest.requested_receipt_date, "2026-07-30");
});

test("original document request rejects cards after both originals are received", { concurrency: false }, async () => {
  let wroteRequest = false;
  const handler = loadOriginalRequestHandler({
    verifySession: () => ({ account_id: "account-1", display_name: "Test shipper" }),
    supabaseFetch: async (url, options) => {
      if (url.startsWith("/rest/v1/shipper_accounts")) return [{ release_request_to: "" }];
      if (url.startsWith("/rest/v1/cargo_cards")) {
        return [{
          account_id: "account-1",
          bl_number: "BL-COMPLETE",
          stage: "반입",
          obl_received: true,
          hc_received: true,
        }];
      }
      if (options?.method === "POST") wroteRequest = true;
      return [];
    },
    sendMail: async () => {},
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: {
      bl_number: "BL-COMPLETE",
      requester_name: "Requester",
      requested_receipt_date: "2026-07-30",
    },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(wroteRequest, false);
  assert.match(response.body.message, /OBL.*H\/C/);
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
  assert.doesNotMatch(body, /\(양도증\)/);
});

test("progress transport save sends an exact notification boolean and handles stale data", () => {
  const start = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const end = dashboard.indexOf("function openProgressStatus", start);
  const body = dashboard.slice(start, end);
  assert.match(body, /send_notification:\s*sendNotification === true/);
  assert.match(body, /response\.status === 409/);
  assert.match(body, /await loadData\(\)/);
  assert.match(body, /saveProgressWarehouseEditor\(sendNotification,\s*confirmationAction = ""\)/);
});

test("import request handler defaults, persists, returns, and emails the Korea request date", { concurrency: false }, async () => {
  let persistedRequest;
  let sentMail;
  const handler = loadImportRequestHandler({
    verifySession: () => ({ account_id: "account-1", display_name: "테스트 화주" }),
    supabaseFetch: async (url, options) => {
      if (url.includes("/rest/v1/cargo_mail_settings")) {
        const key = decodeURIComponent((url.match(/setting_key=eq\.([^&]+)/) || [])[1] || "");
        const settings = {
          ain_default: { to_recipients: "ops@example.com", cc_recipients: "" },
          shipper_default: { to_recipients: "shipper@example.com", cc_recipients: "" },
          destination_default: { to_recipients: "destination@example.com", cc_recipients: "" },
        };
        return settings[key] ? [{ setting_key: key, ...settings[key] }] : [];
      }
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
  assert.equal(
    sentMail.cc,
    "shipper@example.com,destination@example.com,requester@example.com"
  );
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
