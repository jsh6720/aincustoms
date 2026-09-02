const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildValuationGoogleSelfTest } = require("../scripts/build-valuation-google-selftest.cjs");
const { runSelfTestBundle } = require("./helpers/valuation-google-selftest-harness");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "apps-script", "valuation", "Code.gs");
const runnerPath = path.join(root, "test", "helpers", "valuation-google-selftest.gs");

function bundle() {
  return buildValuationGoogleSelfTest({
    source: fs.readFileSync(sourcePath, "utf8"),
    runner: fs.readFileSync(runnerPath, "utf8"),
  });
}

test("generated self-test runs only with fresh synthetic spreadsheets and exposes no secrets", () => {
  const result = runSelfTestBundle(bundle());
  assert.equal(result.returnValue.success, true);
  assert.equal(result.created.length, 2);
  assert.ok(result.created.every(file => file.id.startsWith("synthetic-")));
  assert.equal(result.openedOriginalIds.length, 0);
  assert.match(result.safeLog, /HTTP_NOT_TESTED/);
  assert.equal(result.safeLog.includes(result.masterPassword), false);
  assert.equal(result.safeLog.includes(result.customerPassword), false);
  assert.equal(JSON.stringify(result.returnValue).includes(result.masterPassword), false);
});

test("production project refusal happens before any Google mutation", () => {
  const result = runSelfTestBundle(bundle(), { scriptId: "1AUaVAdAHmDEZzE0PAne2AiGMZpa72e8kA6blCLZCm6ARdpFTwUctMZ4O" });
  assert.match(result.error.message, /^VALUATION_SELFTEST_REFUSED$/);
  assert.equal(result.created.length, 0);
  assert.equal(result.propertyWrites.length, 0);
  assert.equal(result.openedIds.length, 0);
});

test("outside the runner API has no usable sheet targets", () => {
  const result = runSelfTestBundle(bundle(), { invoke: false });
  const response = result.post({ action: "login", username: "x", password: "x" });
  assert.equal(response.code, "NOT_CONFIGURED");
  assert.equal(result.created.length, 0);
  assert.equal(result.openedIds.length, 0);
});

test("a broken runner check fails rather than reporting a pass", () => {
  const damaged = bundle().replace("unauth.code === 'UNAUTHORIZED'", "unauth.code === 'FORBIDDEN'");
  const result = runSelfTestBundle(damaged);
  assert.match(result.error.message, /^VALUATION_SELFTEST_FAILED:VST_01$/);
  assert.equal(result.safeLog.includes("VALUATION_GOOGLE_SELFTEST_PASS"), false);
});

test("a duty-data isolation regression fails the generated runner instead of reporting a pass", () => {
  const leakedRows = bundle().replace(
    "data: auth.isMaster ? rows : rows.filter(function (row) {\n      return companyKey_(row[0]) === companyKey_(auth.row[2]);\n    }),",
    "data: rows,"
  );
  const result = runSelfTestBundle(leakedRows);
  assert.match(result.error.message, /^VALUATION_SELFTEST_FAILED:VST_04$/);
  assert.equal(result.safeLog.includes("VALUATION_GOOGLE_SELFTEST_PASS"), false);
});

test("builder rejects unexpected production constant structure and preserves source bytes", () => {
  const source = fs.readFileSync(sourcePath);
  assert.throws(() => buildValuationGoogleSelfTest({ source: source.toString().replace("const LOGIN_SHEET_ID", "let LOGIN_SHEET_ID"), runner: "" }), /expected/);
  assert.deepEqual(fs.readFileSync(sourcePath), source);
});

test("assembled bundle opens with an unmistakable Korean new-project self-test warning", () => {
  assert.match(bundle().split("\n")[0], /자가검증 전용.*새 Apps Script 프로젝트/);
});
