const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const loginHandlerPath = path.join(root, "api", "cargo-login.js");
const dataHandlerPath = path.join(root, "api", "cargo-data.js");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260724_add_calendar_preferences_and_ctf.sql"
);

function createResponse() {
  return {
    body: null,
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
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

function loadHandler(handlerPath, cargoAuth) {
  const originalLoad = Module._load;
  delete require.cache[handlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === handlerPath && request === "../lib/cargo-auth") {
      return cargoAuth;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(handlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
  }
}

test("normalizes absent and partial calendar preferences with both event types enabled", () => {
  const { normalizeCalendarPreferences } = require("../lib/cargo-calendar-preferences");

  assert.deepEqual(normalizeCalendarPreferences(), {
    import_request: true,
    warehouse_expected: true,
  });
  assert.deepEqual(normalizeCalendarPreferences({ import_request: false }), {
    import_request: false,
    warehouse_expected: true,
  });
  assert.deepEqual(normalizeCalendarPreferences({ warehouse_expected: "false" }), {
    import_request: true,
    warehouse_expected: true,
  });
});

test("rejects unsupported calendar preference keys and non-boolean values", () => {
  const { validateCalendarPreferences } = require("../lib/cargo-calendar-preferences");

  assert.throws(
    () => validateCalendarPreferences({ import_request: true }),
    /exactly.*import_request.*warehouse_expected/i
  );
  assert.throws(
    () => validateCalendarPreferences({ import_request: true, other: false }),
    /unsupported/i
  );
  assert.throws(
    () => validateCalendarPreferences({ warehouse_expected: "true" }),
    /boolean/i
  );
});

test("Vercel deployment stays within the twelve JavaScript function limit", () => {
  const apiFiles = fs.readdirSync(path.join(root, "api"))
    .filter((file) => file.endsWith(".js"));

  assert.equal(apiFiles.length, 12);
  assert.equal(apiFiles.includes("cargo-calendar-preferences.js"), false);
});

test("PATCH cargo-data lets a viewer save only their normalized calendar preferences", async () => {
  const calls = [];
  const handler = loadHandler(dataHandlerPath, {
    verifySession: () => ({ account_id: "viewer-account", role: "viewer" }),
    createSession: () => "refreshed-token",
    supabaseFetch: async (url, options) => {
      calls.push({ url, options });
      return [{
        calendar_preferences: {
          import_request: false,
          warehouse_expected: true,
        },
      }];
    },
  });
  const response = createResponse();

  await handler({
    method: "PATCH",
    body: { import_request: false, warehouse_expected: true },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    success: true,
    calendar_preferences: {
      import_request: false,
      warehouse_expected: true,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/rest/v1/shipper_accounts?id=eq.viewer-account");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers.Prefer, "return=representation");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    calendar_preferences: {
      import_request: false,
      warehouse_expected: true,
    },
  });
});

test("PATCH cargo-data refreshes the session used by a cargo-data reload", async () => {
  const originalSession = {
    account_id: "account-1",
    login_id: "shipper",
    display_name: "Shipper",
    role: "shipper",
    calendar_preferences: { import_request: true, warehouse_expected: true },
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  let refreshedSession;
  const preferenceHandler = loadHandler(dataHandlerPath, {
    verifySession: () => originalSession,
    createSession: (session) => {
      refreshedSession = session;
      return "refreshed-token";
    },
    supabaseFetch: async () => [{
      calendar_preferences: { import_request: false, warehouse_expected: true },
    }],
  });
  const preferenceResponse = createResponse();

  await preferenceHandler({
    method: "PATCH",
    body: { import_request: false, warehouse_expected: true },
  }, preferenceResponse);

  assert.match(
    preferenceResponse.headers["Set-Cookie"],
    /^cargo_session=refreshed-token; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=(?:5[0-9]|60)$/
  );
  assert.deepEqual(refreshedSession, {
    ...originalSession,
    calendar_preferences: { import_request: false, warehouse_expected: true },
  });

  const dataHandler = loadHandler(dataHandlerPath, {
    canReadAllCargo: () => false,
    verifySession: (req) => req.headers.cookie.startsWith("cargo_session=refreshed-token")
      ? refreshedSession
      : null,
    supabaseFetch: async () => [],
  });
  const dataResponse = createResponse();

  await dataHandler({
    method: "GET",
    headers: { cookie: preferenceResponse.headers["Set-Cookie"] },
  }, dataResponse);

  assert.deepEqual(dataResponse.body.user.calendar_preferences, {
    import_request: false,
    warehouse_expected: true,
  });
});

test("PATCH cargo-data rejects invalid preferences before writing", async () => {
  let writes = 0;
  const handler = loadHandler(dataHandlerPath, {
    verifySession: () => ({ account_id: "account-1", role: "shipper" }),
    supabaseFetch: async () => {
      writes += 1;
      return [];
    },
  });
  const response = createResponse();

  await handler({
    method: "PATCH",
    body: { import_request: "false", warehouse_expected: true },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
  assert.equal(writes, 0);
});

test("PATCH cargo-data rejects a missing session", async () => {
  const handler = loadHandler(dataHandlerPath, {
    verifySession: () => null,
    supabaseFetch: async () => {
      throw new Error("should not write");
    },
  });
  const response = createResponse();

  await handler({
    method: "PATCH",
    body: { import_request: true, warehouse_expected: true },
  }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.success, false);
});

test("PATCH cargo-data names the required migration for a missing column", async () => {
  const handler = loadHandler(dataHandlerPath, {
    verifySession: () => ({ account_id: "account-1", role: "admin" }),
    supabaseFetch: async () => {
      throw new Error("column calendar_preferences does not exist");
    },
  });
  const response = createResponse();

  await handler({
    method: "PATCH",
    body: { import_request: true, warehouse_expected: true },
  }, response);

  assert.equal(response.statusCode, 500);
  assert.match(response.body.message, /20260724_add_calendar_preferences_and_ctf\.sql/);
});

test("login signs normalized calendar preferences into the session", async () => {
  let signedSession;
  const handler = loadHandler(loginHandlerPath, {
    createSession: (session) => {
      signedSession = session;
      return "signed-token";
    },
    supabaseFetch: async () => [{
      id: "account-1",
      login_id: "shipper",
      display_name: "Shipper",
      role: "shipper",
      calendar_preferences: { import_request: false },
    }],
  });
  const response = createResponse();

  await handler({
    method: "POST",
    body: { login_id: "shipper", password: "password" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signedSession.calendar_preferences, {
    import_request: false,
    warehouse_expected: true,
  });
  assert.deepEqual(response.body.user.calendar_preferences, {
    import_request: false,
    warehouse_expected: true,
  });
});

test("cargo data returns newer database preferences instead of an old session cookie", async () => {
  const calls = [];
  const handler = loadHandler(dataHandlerPath, {
    canReadAllCargo: () => false,
    verifySession: () => ({
      account_id: "account-1",
      login_id: "shipper",
      display_name: "Shipper",
      role: "shipper",
      calendar_preferences: { import_request: true, warehouse_expected: true },
    }),
    supabaseFetch: async (url) => {
      calls.push(url);
      if (url.startsWith("/rest/v1/shipper_accounts?")) {
        return [{
          calendar_preferences: {
            import_request: false,
            warehouse_expected: false,
          },
        }];
      }
      return [];
    },
  });
  const response = createResponse();

  await handler({ method: "GET", headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.user.calendar_preferences, {
    import_request: false,
    warehouse_expected: false,
  });
  assert.ok(calls.some((url) => (
    url === "/rest/v1/shipper_accounts?select=calendar_preferences&id=eq.account-1&limit=1"
  )));
});

test("calendar preference migration adds preferences and provisions the CTF account", () => {
  const sql = require("node:fs").readFileSync(migrationPath, "utf8");

  assert.match(sql, /calendar_preferences jsonb not null/i);
  assert.match(
    sql,
    /default '\{"import_request": true, "warehouse_expected": true\}'::jsonb/i
  );
  assert.match(sql, /drop function if exists public\.verify_shipper_login\(text, text\)/i);
  assert.match(sql, /create function public\.verify_shipper_login\(p_login_id text, p_password text\)/i);
  assert.match(sql, /calendar_preferences jsonb/i);
  assert.match(sql, /lower\(a\.login_id\) = lower\(trim\(p_login_id\)\)/i);
  assert.match(sql, /'CTF'/);
  assert.match(sql, /'캐틀팜'/);
  assert.match(sql, /extensions\.crypt\('ctf1234', extensions\.gen_salt\('bf'\)\)/);
  assert.match(sql, /order by\s+case when login_id = 'CTF' then 0 else 1 end/i);
  assert.match(sql, /login_id = 'CTF_RETIRED_' \|\| replace\(id::text, '-', ''\)/i);
  assert.match(sql, /is_active = false/i);
  assert.match(sql, /and id <> v_canonical_id/i);
  assert.match(sql, /where id = v_canonical_id/i);
});
