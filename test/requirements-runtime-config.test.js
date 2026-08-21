const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LEGACY_DEPLOYMENT_URL =
  "https://script.google.com/macros/s/AKfycby3hhpd2Nk2K4dFu48g_Y1zhrmmGaRZvMWNNfi-CaNi8mfrzBnWUIlK73GDJKR_NH18Fw/exec";
const APPS_SCRIPT_EXEC_URL =
  /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

test("requirements config exposes only the new Apps Script v2 endpoint", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "requirements", "js", "runtime-config.js"),
    "utf8"
  );
  const sandbox = { window: {} };

  vm.runInNewContext(source, sandbox, {
    filename: "requirements/js/runtime-config.js",
  });

  const config = sandbox.window.AIN_REQUIREMENTS_CONFIG;
  assert.ok(config, "runtime config must be exported on window");
  assert.deepEqual(Reflect.ownKeys(config), ["apiUrl"]);
  assert.equal(typeof config.apiUrl, "string");
  assert.match(config.apiUrl, APPS_SCRIPT_EXEC_URL);
  assert.notEqual(config.apiUrl, LEGACY_DEPLOYMENT_URL);
  assert.doesNotMatch(
    source,
    /TOKEN_SIGNING_SECRET|PASSWORD_PEPPER|BACKUP_AGENT_SECRET|BEGIN PRIVATE KEY|private_key|client_secret/i
  );
});
