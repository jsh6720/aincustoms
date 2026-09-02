const test = require("node:test");
const assert = require("node:assert/strict");
const { createGas } = require("./helpers/valuation-gas-harness");

test("deletions flush spreadsheet changes before releasing the mutation lock", () => {
  for (const action of ["deleteAccount", "deleteDutyRecord"]) {
    const gas = createGas(), token = gas.login().user.token;
    const list = gas.post({action: action === "deleteAccount" ? "getAccountData" : "getDutyData", token});
    gas.events.length = 0;
    const result = gas.post({action, token, revision: list.revision, rowIndex: 1, id: "youngin"});
    assert.equal(result.success, true);
    assert.ok(gas.events.indexOf("flush") > gas.events.indexOf("deleteRow"));
    assert.ok(gas.events.lastIndexOf("releaseLock") > gas.events.indexOf("flush"));
  }
});

test("add grows a full sheet grid instead of failing at its last row", () => {
  for (const action of ["addAccount", "addDutyRecord"]) {
    const gas = createGas({maxRows: 4}), token = gas.login().user.token;
    const list = gas.post({action: action === "addAccount" ? "getAccountData" : "getDutyData", token});
    const result = gas.post({action, token, revision: list.revision, id:"new",password:"new-password",
      company:"새화주",supplier:"ABC",payment:"TT",trade:"11",delivery:"FOB",declaration:"new"});
    assert.equal(result.success,true);
    assert.ok(gas.events.includes("insertRowsAfter"));
  }
});
function master(gas) {
  const result = gas.login();
  assert.equal(result.success, true);
  assert.equal(typeof result.user.token, "string");
  return result.user.token;
}
function listing(gas, token, action = "getAccountData") {
  const result = gas.post({ action, token });
  assert.equal(result.success, true);
  assert.equal(typeof result.revision, "string");
  return result;
}
for (const action of ["getDutyData", "getAccountData", "addAccount", "updateAccount", "deleteAccount",
  "addDutyRecord", "updateDutyRecord", "deleteDutyRecord"]) {
  test("unauthenticated " + action + " ignores forged master and never returns data or writes", () => {
    const gas = createGas();
    const result = gas.post({ action, isMaster: true, company: "", rowIndex: 1, id: "youngin" });
    assert.equal(result.success, false);
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(result.data, undefined);
    assert.equal(gas.writes.length, 0);
  });
}
test("login issues an expiring session without logging credentials or returning sheet rows", () => {
  const gas = createGas(), result = gas.login();
  assert.equal(result.success, true);
  assert.equal(typeof result.user.token, "string");
  assert.ok(result.user.expiresAt > Date.parse("2026-08-31T00:00:00Z"));
  assert.equal(result.user.password, undefined);
  assert.equal(JSON.stringify(result).includes("test-master-password"), false);
  assert.equal(JSON.stringify(gas.logs).includes("test-master-password"), false);
  assert.equal(gas.writes.length, 0);
});
test("account listing only exposes safe metadata and preserves offsets across blank rows", () => {
  const gas = createGas();
  gas.accounts.splice(2, 0, ["", "", ""]);
  const result = listing(gas, master(gas));
  assert.deepEqual(result.data, [
    { id: "aincustoms", company: "AIN", rowIndex: 0 },
    { id: "youngin", company: "영인에스티(주)", rowIndex: 2 },
    { id: "other", company: "다른회사", rowIndex: 3 },
  ]);
  assert.equal(JSON.stringify(result).includes("test-client-password"), false);
});
test("client visibility uses current server company exact normalized match, ignoring supplied authority", () => {
  const gas = createGas(), token = gas.login("youngin", "test-client-password").user.token;
  const result = gas.post({ action: "getDutyData", token, isMaster: true, company: "OTHER" });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.map(r => r[5]), ["00123", "00456"]);
  assert.equal(gas.post({ action: "getAccountData", token, isMaster: true }).code, "FORBIDDEN");
});
test("tampered, expired and password-changed sessions are rejected", () => {
  const gas = createGas(), token = master(gas);
  assert.equal(gas.post({ action: "getAccountData", token: token.slice(0, -3) + "aaa" }).code, "UNAUTHORIZED");
  gas.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal(gas.post({ action: "getAccountData", token }).code, "UNAUTHORIZED");
  const renewed = master(gas);
  gas.accounts[1][1] = "changed";
  assert.equal(gas.post({ action: "getAccountData", token: renewed }).code, "UNAUTHORIZED");
  assert.equal(gas.writes.length, 0);
});
for (const password of [undefined, ""]) {
  test("account update preserves existing password with replacement " + String(password), () => {
    const gas = createGas(), token = master(gas), revision = listing(gas, token).revision;
    const payload = { action: "updateAccount", token, revision, id: "youngin", rowIndex: 1, company: "영인에스티" };
    if (password !== undefined) payload.password = password;
    assert.equal(gas.post(payload).success, true);
    assert.deepEqual(gas.accounts[2], ["youngin", "test-client-password", "영인에스티"]);
    assert.ok(gas.writes.every(w => w.col !== 1));
  });
}
test("new passwords preserve spaces and formula-looking values are written as literal text", () => {
  const gas = createGas(), token = master(gas);
  const result = gas.post({ action: "updateAccount", token, revision: listing(gas, token).revision,
    id: "youngin", rowIndex: 1, company: "=literal company", password: " =literal password " });
  assert.equal(result.success, true);
  assert.deepEqual(gas.accounts[2], ["youngin", " =literal password ", "=literal company"]);
  assert.equal(gas.login("youngin", " =literal password ").success, true);
  assert.equal(gas.login("youngin", "=literal password").success, false);
});
for (const rowIndex of ["1tail", -1, 1.5, 500]) {
  test("invalid account index " + rowIndex + " never writes", () => {
    const gas = createGas(), token = master(gas);
    assert.equal(gas.post({ action: "updateAccount", token, revision: listing(gas, token).revision,
      id: "youngin", rowIndex, company: "CHANGED" }).success, false);
    assert.equal(gas.writes.length, 0);
  });
}
test("id mismatch and protected actual row cannot be bypassed with supplied id", () => {
  const gas = createGas(), token = master(gas), revision = listing(gas, token).revision;
  for (const action of ["updateAccount", "deleteAccount"]) {
    assert.equal(gas.post({ action, token, revision, id: "other", rowIndex: 1, company: "X" }).success, false);
    assert.equal(gas.post({ action, token, revision, id: "aincustoms", rowIndex: 0, company: "X" }).code, "FORBIDDEN");
    assert.equal(gas.post({ action, token, revision, id: "fake", rowIndex: 0, company: "X" }).success, false);
  }
  assert.equal(gas.writes.length, 0);
});
test("shifted/deleted rows invalidate revision instead of modifying a different account", () => {
  const gas = createGas(), token = master(gas), revision = listing(gas, token).revision;
  gas.accounts.splice(2, 1);
  assert.equal(gas.post({ action: "deleteAccount", token, revision, id: "youngin", rowIndex: 1 }).code, "CONFLICT");
  assert.equal(gas.writes.length, 0);
});
test("duty writes reject stale revisions and normalized company/declaration duplicates", () => {
  const gas = createGas(), token = master(gas), revision = listing(gas, token, "getDutyData").revision;
  const payload = { action: "addDutyRecord", token, revision,
    company: "주식회사 영인에스티", supplier: "X", payment: "TT", trade: "11", delivery: "FOB", declaration: "00123" };
  assert.equal(gas.post(payload).code, "DUPLICATE");
  gas.duties[1][1] = "CHANGED";
  assert.equal(gas.post({ action: "deleteDutyRecord", token, revision, rowIndex: 0 }).code, "CONFLICT");
  assert.equal(gas.writes.length, 0);
});
test("duty CRUD targets exact rows and preserves unrelated columns", () => {
  const gas = createGas(), token = master(gas);
  gas.duties[1][6] = "untouched";
  let revision = listing(gas, token, "getDutyData").revision;
  assert.equal(gas.post({ action: "updateDutyRecord", token, revision, rowIndex: 0,
    company: "영인에스티", supplier: "X", payment: "TT", trade: "11", delivery: "FOB", declaration: "00124" }).success, true);
  assert.deepEqual(gas.duties[1], ["영인에스티", "X", "TT", "11", "FOB", "00124", "untouched"]);
  revision = listing(gas, token, "getDutyData").revision;
  assert.equal(gas.post({ action: "deleteDutyRecord", token, revision, rowIndex: 0 }).success, true);
  assert.equal(gas.duties[1][5], "00456");
});
test("non-admin signed session cannot mutate using a forged master flag", () => {
  const gas = createGas(), token = gas.login("youngin", "test-client-password").user.token;
  for (const action of ["addDutyRecord", "updateDutyRecord", "deleteDutyRecord", "addAccount", "updateAccount", "deleteAccount"]) {
    assert.equal(gas.post({ action, token, isMaster: true, revision: "forged" }).code, "FORBIDDEN");
  }
  assert.equal(gas.writes.length, 0);
});
test("missing configuration fails closed and editor setup is idempotent with no sheet writes", () => {
  const gas = createGas({ properties: {} });
  assert.equal(gas.login().code, "NOT_CONFIGURED");
  gas.context.initializeValuationSecurity();
  const key = gas.properties.get("VALUATION_SESSION_SECRET");
  assert.ok(key.length >= 64);
  gas.context.initializeValuationSecurity();
  assert.equal(gas.properties.get("VALUATION_SESSION_SECRET"), key);
  assert.ok(master(gas).length > 30);
  assert.equal(gas.writes.length, 0);
});
test("editor service preflight performs two read-only typed API checks", () => {
  const gas = createGas();
  assert.equal(typeof gas.context.verifyValuationSheetsService, "function");
  const result = gas.context.verifyValuationSheetsService();
  assert.equal(result.success, true);
  assert.equal(result.checked, 2);
  assert.equal(gas.events.filter(event => event === "typedRead").length, 2);
  assert.equal(gas.writes.length, 0);
});
test("JSON and FormData authenticate identically and errors/GET never echo secrets", () => {
  const gas = createGas(), token = master(gas);
  assert.equal(gas.post({ action: "getAccountData", token }, true).success, true);
  const invalid = JSON.parse(gas.context.doPost({ postData: { contents: "secret-invalid-json" } }).getContent());
  assert.equal(invalid.success, false);
  assert.equal(JSON.stringify(invalid).includes("secret-invalid-json"), false);
  assert.equal(JSON.stringify(gas.post({ action: "test", password: "do-not-echo" })).includes("do-not-echo"), false);
  assert.equal(JSON.stringify(gas.context.doGet({ parameter: { token } })).includes(token), false);
});
test("editor backup copies both spreadsheets and cannot be invoked through web API", () => {
  const gas = createGas();
  gas.context.backupValuationSheets();
  assert.equal(gas.copies.length, 2);
  assert.deepEqual(gas.copies[0].rows, gas.accounts);
  assert.deepEqual(gas.copies[1].rows, gas.duties);
  assert.equal(gas.writes.length, 0);
  assert.equal(gas.post({ action: "backupValuationSheets", token: master(gas) }).success, false);
  assert.equal(gas.copies.length, 2);
});
