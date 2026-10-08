const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const read = require("../lib/requirements-read");
const { createRequirementsReadHandler } = require("../lib/requirements-read-handler");

const SECRET = "synthetic-unit-signing-key";
const NOW = 1780000000000;
const gsSource = fs.readFileSync(path.join(__dirname, "../requirements/apps-script/Code.gs"), "utf8");

// The real Apps Script code, with Google services replaced by an in-memory workbook.
function appsScript(workbook) {
  const context = {
    Date: { now: () => NOW + 1 },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => (name === "ACTIVE_SPREADSHEET_ID" ? "sheet" : SECRET) }) },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      base64EncodeWebSafe: value => Buffer.from(value).toString("base64url").padEnd(Math.ceil(Buffer.from(value).toString("base64url").length / 4) * 4, "="),
      base64DecodeWebSafe: value => Array.from(Buffer.from(value, "base64url")),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac("sha256", key).update(value).digest()),
    },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => (workbook[name] ? { getDataRange: () => ({ getValues: () => workbook[name] }) } : null) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  };
  vm.createContext(context);
  vm.runInContext(gsSource, context);
  return context;
}

const workbook = {
  AIN_Users: [
    ["username", "role", "company_name", "active", "auth_version", "password_hash"],
    ["boss", "master", "AIN", true, 1, "secret-hash"],
    ["st", "user", "영인에스티", "TRUE", 2, "secret-hash"],
    ["other", "user", "타사(주)", "yes", 1, "x"],
    ["gone", "user", "타사", false, 1, "x"],
  ],
  AIN_Review_Needed: [
    ["id", "spec_no", "description", "importer", "exporter", "created_at"],
    ["1", "STD72110-01", "SOLEIL", "영인에스티(주)", "VEOLIA", 1780000000000],
    ["2", "OTHER-1", "x", "주식회사 타사", "Y", ""],
    ["3", "STD 72110-02", "y", "영인과학(주)", "Z", ""],
  ],
  AIN_Radio_Law: [["id", "spec_no", "consignee", "model_name"], ["9", "R-1", "영인에이티(주)", "M 72110"], ["10", "R-2", "타사", "N"]],
  AIN_Chemical_Confirmation: [["id", "spec_no", "company"]],
  AIN_MSDS: [["id", "spec_no", "importer"]],
  AIN_Electrical_Law: [["id", "spec_no", "consignee"]],
  AIN_Medical_Device: [["id", "spec_no", "importer"]],
  AIN_Non_Target: [["id", "spec_no", "importer"]],
};

const readSheets = async names => ({
  timeZone: "Asia/Seoul",
  sheets: Object.fromEntries(names.filter(name => workbook[name]).map(name => [name, { serial: workbook[name], formatted: workbook[name] }])),
});

function tokenFor(context, username, authVersion) {
  return context.createSessionToken(username, authVersion, NOW);
}

function viaAppsScript(context, request) {
  return context.handleRequest({ postData: { contents: JSON.stringify(request) } });
}

const requests = token => [
  { action: "getData", tableName: "review_needed", token },
  { action: "getData", tableName: "radio_law", token },
  { action: "getData", tableName: "users", token },
  { action: "search", query: "72110", token },
  { action: "search", query: "  ", token },
  { action: "stats", token },
  { action: "getData", tableName: "nope", token },
];

for (const [username, version] of [["boss", 1], ["st", 2], ["other", 1], ["gone", 1], ["st", 1], ["missing", 1]]) {
  test(`same results as Apps Script for ${username} (auth_version ${version})`, async () => {
    const context = appsScript(workbook);
    const token = tokenFor(context, username, version);
    for (const request of requests(token)) {
      const expected = JSON.parse(JSON.stringify(viaAppsScript(context, request)));
      const actual = JSON.parse(JSON.stringify(await read.handleReadRequest(request, { secret: SECRET, readSheets, nowMs: NOW + 1 })));
      assert.deepEqual(actual, expected, `${request.action} ${request.tableName || request.query || ""}`);
    }
  });
}

test("forged, expired and wrong-secret tokens are rejected before any sheet is read", async () => {
  const context = appsScript(workbook);
  const token = tokenFor(context, "boss", 1);
  let reads = 0;
  const counting = async names => { reads += 1; return readSheets(names); };
  for (const [bad, options] of [
    [token.slice(0, -3) + "AAA", {}],
    [token, { nowMs: NOW + 8 * 60 * 60 * 1000 }],
    [token, { secret: "different" }],
    ["", {}],
  ]) {
    const result = await read.handleReadRequest({ action: "stats", token: bad }, { secret: SECRET, readSheets: counting, nowMs: NOW + 1, ...options });
    assert.equal(result.error_code, "UNAUTHORIZED");
  }
  assert.equal(reads, 0);
});

test("serial dates become the ISO strings Apps Script would serialize", () => {
  // 2026-10-08 09:30:00 in Seoul == 2026-10-08T00:30:00.000Z
  const serial = 25569 + Date.UTC(2026, 9, 8, 9, 30) / 86400000;
  const values = read.sheetValues([["d", "n", "s"], [serial, 42, "text"]], [["d", "n", "s"], ["2026. 10. 8 오전 9:30:00", 42, "text"]], "Asia/Seoul");
  assert.deepEqual(values[1], ["2026-10-08T00:30:00.000Z", 42, "text"]);
});

test("rows are padded to the sheet width like getDataRange", () => {
  const values = read.sheetValues([["a", "b", "c"], ["1"], []], [], "Asia/Seoul");
  assert.deepEqual(values, [["a", "b", "c"], ["1", "", ""], ["", "", ""]]);
});

function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("handler reports NOT_CONFIGURED (5xx) so the client falls back to Apps Script", async () => {
  const handler = createRequirementsReadHandler({ env: {} });
  const res = fakeRes();
  await handler({ method: "POST", body: { action: "stats", token: "x" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error_code, "NOT_CONFIGURED");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("handler turns Google failures into UPSTREAM_ERROR without leaking details", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { client_email: "reader@example.iam.gserviceaccount.com", token_uri: "https://oauth2.example/token", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const handler = createRequirementsReadHandler({
    env: { REQUIREMENTS_SHEETS_KEY: JSON.stringify(key), REQUIREMENTS_SPREADSHEET_ID: "sheet", REQUIREMENTS_TOKEN_SECRET: SECRET },
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }),
  });
  const context = appsScript(workbook);
  const res = fakeRes();
  const original = console.error;
  console.error = () => {};
  try {
    await handler({ method: "POST", body: { action: "stats", token: context.createSessionToken("boss", 1, Date.now()) } }, res);
  } finally {
    console.error = original;
  }
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { success: false, error_code: "UPSTREAM_ERROR" });
});

test("parity cases really exercise authorized reads, not only rejections", async () => {
  const context = appsScript(workbook);
  const result = await read.handleReadRequest({ action: "search", query: "72110", token: tokenFor(context, "st", 2) }, { secret: SECRET, readSheets, nowMs: NOW + 1 });
  assert.equal(result.success, true);
  assert.deepEqual(result.results.review_needed.map(r => r.spec_no), ["STD72110-01", "STD 72110-02"]);
  assert.deepEqual(result.results.radio_law.map(r => r.spec_no), ["R-1"]);
  const boss = await read.handleReadRequest({ action: "getData", tableName: "users", token: tokenFor(context, "boss", 1) }, { secret: SECRET, readSheets, nowMs: NOW + 1 });
  assert.equal(boss.data.length, 4);
  assert.equal("password_hash" in boss.data[0], false);
});

test("formula errors read as the bare error text like getValues", () => {
  const values = read.sheetValues([["note"], ["#N/A ()"], ["#REF! (Reference does not exist.)"], ["#hashtag (kept)"]], [["note"], ["#N/A ()"], ["#REF! (Reference does not exist.)"], ["#hashtag (kept)"]], "Asia/Seoul");
  assert.deepEqual(values.slice(1).map(row => row[0]), ["#N/A", "#REF!", "#hashtag (kept)"]);
});
