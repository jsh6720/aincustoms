const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function createResponse() {
  return {
    statusCode: null,
    body: null,
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

test("viewer is an all-cargo reader but never a writable session", () => {
  process.env.DASHBOARD_SESSION_SECRET = "viewer-test-secret";
  delete require.cache[require.resolve("../lib/cargo-auth")];
  const auth = require("../lib/cargo-auth");

  assert.equal(auth.canReadAllCargo("admin"), true);
  assert.equal(auth.canReadAllCargo("viewer"), true);
  assert.equal(auth.canReadAllCargo("shipper"), false);

  const token = auth.createSession({
    account_id: "viewer-account",
    login_id: "guest",
    display_name: "전체 게스트",
    role: "viewer",
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const req = {
    method: "POST",
    headers: { cookie: `cargo_session=${encodeURIComponent(token)}` },
  };
  const res = createResponse();

  assert.equal(auth.requireWritableSession(req, res), null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    message: "읽기 전용 계정은 정보를 변경할 수 없습니다.",
  });
});

test("cargo data uses the shared all-cargo role decision", () => {
  const source = read("api/cargo-data.js");
  assert.match(source, /canReadAllCargo/);
  assert.match(source, /const readsAllCargo = canReadAllCargo\(session\.role\)/);
  assert.match(source, /readsAllCargo\s*\?\s*"\/rest\/v1\/cargo_cards\?select=\*&order=synced_at\.desc"/);
});

test("every shipper mutation API rejects viewer sessions before writing", () => {
  const mutationApis = [
    "api/cargo-quota.js",
    "api/cargo-import-request.js",
    "api/cargo-original-doc-request.js",
    "api/cargo-original-docs.js",
    "api/cargo-release-request.js",
    "api/cargo-revision.js",
  ];

  for (const relativePath of mutationApis) {
    const source = read(relativePath);
    assert.match(source, /requireWritableSession/, relativePath);
    assert.match(
      source,
      /const session = requireWritableSession\(req,\s*res\);\s*if \(!session\) return;/,
      relativePath
    );
  }
});

test("administrator account API accepts viewer without a consignee filter", () => {
  const source = read("api/cargo-admin.js");
  assert.match(
    source,
    /body\.role === "admin"\s*\|\|\s*body\.role === "viewer"\s*\?\s*body\.role\s*:\s*"shipper"/
  );
  assert.match(source, /payload\.p_role === "shipper" && !payload\.p_consignee_filter/);
});

test("dashboard renders viewer as a read-only all-cargo board", () => {
  const source = read("cargo-dashboard.html");
  assert.match(source, /<option value="viewer">전체조회\(읽기 전용\)<\/option>/);
  assert.match(source, /document\.body\.classList\.toggle\("viewer-progress", currentUserRole === "viewer"\)/);
  assert.match(source, /let currentPrimaryView = "board"/);
  assert.match(source, /document\.getElementById\("progressStatusBtn"\)\.style\.display = "";/);
  assert.match(source, /if \(currentUserRole === "admin" \|\| currentUserRole === "viewer"\) return "";/);
  assert.match(source, /body\.viewer-progress \.progress-edit-btn/);
  assert.match(source, /body\.viewer-progress \.progress-shipper-only/);
  assert.doesNotMatch(source, /if \(currentUserRole === "viewer"\) currentPrimaryView = "progress"/);
  assert.doesNotMatch(source, /body\.viewer-progress #boardWrap/);
  assert.match(source, /const detailsContent = currentUserRole === "viewer"/);
  assert.match(
    source,
    /!isHiddenCard\(card\)\s*\|\|\s*currentUserRole === "viewer"/
  );
});

test("migration adds viewer role without storing the guest password", () => {
  const source = read("supabase/migrations/20260724_add_all_cargo_viewer.sql");
  assert.match(source, /check \(role in \('shipper', 'viewer', 'admin'\)\)/);
  assert.match(source, /when p_role in \('admin', 'viewer'\) then p_role/);
  assert.doesNotMatch(source, /5432/);
});
