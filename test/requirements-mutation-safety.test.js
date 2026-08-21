const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const readScript = (name) => fs.readFileSync(path.join(root, "requirements", "js", name), "utf8");

function deleteHarness(fetchImpl) {
  const source = readScript("duplicate-checker.js");
  const calls = [];
  const logs = [];
  const context = {
    fetch: async (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    },
    console: {
      log: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    setTimeout: (callback) => {
      callback();
      return 0;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.deleteForTest = deleteOnce;`, context);
  return { context, calls, logs };
}

for (const [name, fetchImpl] of [
  ["5xx", async () => ({ ok: false, status: 503 })],
  ["network rejection", async () => { throw new Error("PRIVATE-UPSTREAM-BODY"); }],
]) {
  test(`duplicate deletion makes one wire mutation after ${name}`, async () => {
    const { context, calls, logs } = deleteHarness(fetchImpl);
    try {
      await context.deleteForTest("tables/msds/PRIVATE-ROW-ID", 3);
    } catch {
      // The legacy helper rejects transport failures; call count is the contract here.
    }

    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-ROW-ID|PRIVATE-UPSTREAM-BODY/);
  });
}

function uploadHarness(fetchImpl) {
  const source = readScript("file-handler.js");
  const calls = [];
  const logs = [];
  let fileInput;
  const context = {
    console: {
      log: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    document: {
      createElement: () => {
        fileInput = { click() {}, style: {} };
        return fileInput;
      },
      body: { appendChild() {}, removeChild() {} },
      getElementById: () => null,
    },
    fetch: async (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    },
    alert() {},
    confirm: () => true,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    Date,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.handleFileUpload = async () => ({ records: [{ secret_field: "PRIVATE-ROW-BODY" }] });
  context.mapHeadersToFields = (record) => record;
  context.loadExistingDataForDuplicateCheck = async () => [];
  context.checkDuplicateWithCache = () => false;
  context.showLoading = () => {};
  context.hideLoading = () => {};
  context.loadMsdsData = () => {};
  context.loadDashboard = () => {};
  context.showFileUploadDialog("msds");
  return { context, calls, logs, fileInput: () => fileInput };
}

for (const [name, fetchImpl] of [
  ["5xx", async () => ({ ok: false, status: 503, text: async () => "PRIVATE-UPSTREAM-BODY" })],
  ["network rejection", async () => { throw new Error("PRIVATE-UPSTREAM-BODY"); }],
]) {
  test(`file upload makes one wire mutation after ${name}`, async () => {
    const { calls, logs, fileInput } = uploadHarness(fetchImpl);
    await fileInput().onchange({ target: { files: [{ name: "one.csv" }] } });

    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-ROW-BODY|PRIVATE-UPSTREAM-BODY/);
  });
}

test("mutation sources contain no replay loops or row and upstream-body logging", () => {
  const sources = ["app.js", "file-handler.js", "duplicate-checker.js", "selection-delete.js"]
    .map(readScript)
    .join("\n");

  assert.doesNotMatch(sources, /for\s*\([^)]*attempt[^)]*\)/);
  assert.doesNotMatch(sources, /errorText|실패한 데이터|입력레코드|출력데이터|매핑된 레코드|API 응답|오류 스택/);
  assert.doesNotMatch(sources, /console\.(?:log|debug|warn|error)\([^\n]*(?:password|token|credential|secret)/i);
});
