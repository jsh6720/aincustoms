const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const dashboard = read("cargo-dashboard.html");
const loginApi = read("api/cargo-login.js");
const adminApi = read("api/cargo-admin.js");
const migration = read("supabase/migrations/20260730_add_samhyeon_account.sql");

test("Samhyeon account category is preserved by login and admin APIs", () => {
  assert.match(loginApi, /account\.account_category === "samhyeon"/);
  assert.match(adminApi, /body\.account_category === "samhyeon"/);
  assert.match(dashboard, /<option value="samhyeon">삼현<\/option>/);
  assert.match(
    dashboard,
    /document\.body\.classList\.toggle\("samhyeon-progress",\s*currentUserAccountCategory === "samhyeon"\)/
  );
});

test("Samhyeon progress view shows delivery through transfer but hides request and later columns", () => {
  assert.match(
    dashboard,
    /body\.shipper-progress\.samhyeon-progress \.progress-samhyeon-visible\s*\{\s*display:table-cell;\s*\}/
  );
  assert.match(
    dashboard,
    /body\.samhyeon-progress \.progress-shipper-only,\s*body\.samhyeon-progress \.progress-after-transfer\s*\{\s*display:none;\s*\}/
  );
  assert.match(
    dashboard,
    /<th class="progress-delivery progress-admin-only progress-samhyeon-visible">서류전달<\/th>/
  );
  assert.match(
    dashboard,
    /<td class="progress-delivery progress-admin-only progress-samhyeon-visible">/
  );

  const progressPanelStart = dashboard.indexOf('id="progressPanel"');
  const headerStart = dashboard.indexOf("<thead>", progressPanelStart);
  const headerEnd = dashboard.indexOf("</thead>", headerStart);
  const header = dashboard.slice(headerStart, headerEnd);
  const transferIndex = header.indexOf(">양도증</th>");
  assert.ok(transferIndex >= 0, "transfer certificate header should exist");
  assert.match(header.slice(transferIndex), /progress-after-transfer/);
});

test("Samhyeon account migration adds the category and provisions the requested filtered account", () => {
  assert.match(
    migration,
    /check \(account_category in \('shipper', 'destination', 'samhyeon'\)\)/
  );
  assert.match(migration, /lower\(login_id\)\s*=\s*lower\('shyun'\)/i);
  assert.match(migration, /display_name\s*=\s*'삼현'/);
  assert.match(migration, /consignee_filter\s*=\s*'현대코'/);
  assert.match(migration, /account_category\s*=\s*'samhyeon'/);
  assert.match(migration, /password_hash\s*=\s*'\$2a\$12\$/);
  assert.doesNotMatch(
    migration,
    /password_hash\s*=\s*extensions\.crypt\('[^']+'/,
    "the initial password must not be committed as plaintext"
  );
});

test("admin account page identifies Samhyeon and supports password reset without exposing hashes", () => {
  assert.match(dashboard, /<th>비밀번호<\/th>/);
  assert.match(dashboard, /수정에서 재설정/);
  assert.match(dashboard, /account\.account_category === "samhyeon" \? "삼현"/);
  assert.doesNotMatch(adminApi, /password_hash/);
});

test("warehouse schedule uses the requested inbound schedule wording", () => {
  assert.match(dashboard, /<th class="progress-date">입고\(예정\)일<\/th>/);
  assert.match(dashboard, /warehouse_expected_date:\s*"입고\(예정\)일 입력"/);
  assert.match(dashboard, /<label for="progressWarehouseDate">입고\(예정\)일<\/label>/);
});
