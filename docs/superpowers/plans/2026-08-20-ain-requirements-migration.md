# AIN Requirements Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AIN requirements application to `https://www.aincustoms.com/requirements/`, keep Google Sheets as the only operational database, enforce server-authoritative authentication, and install verified Drive and UNC backups with a non-destructive restore path.

**Architecture:** The public `jsh6720/aincustoms` repository receives the static v5.4.4 application under `requirements/` and keeps Vercel as the host. A separately versioned local-only Apps Script project authenticates signed sessions and performs all Google Sheets CRUD and Drive backups; a local Python/PowerShell job exports weekly XLSX copies to the approved UNC path.

**Tech Stack:** HTML, CSS, Vanilla JavaScript, Node.js `node:test`, Google Apps Script, Google Sheets/Drive APIs, Python 3.12 standard library plus bundled `cryptography`, PowerShell 5.1, Windows Task Scheduler, GitHub, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-20-ain-requirements-migration-design.md`

## Global Constraints

- Use local v5.4.4 as the migration source; do not scrape Genspark v5.4.0 back over it.
- Serve the app at `/requirements/`; do not change DNS or Microsoft mail records.
- Keep `Ain_compliance_db` as the only operational database.
- Do not introduce React, npm bundling, Supabase synchronization, or a second operational datastore.
- Do not publish Apps Script source, credentials, Script Properties, DB exports, or backup logs in the public GitHub repository.
- The public package contains only `requirements/index.html`, `requirements/css/`, `requirements/js/`, and `requirements/data/msds.csv`.
- All authenticated API actions derive role and company from `AIN_Users`; client-provided role/company values are ignored.
- Apps Script returns JSON `error_code` values; the browser adapter maps `UNAUTHORIZED` to synthetic 401 and `FORBIDDEN` to synthetic 403.
- Never overwrite or automatically delete the active Google Sheet during restore.
- Retention deletion is limited to the approved backup folder and exact AIN backup filename prefixes.
- Use the explicit UNC path for scheduled backups, never the `Y:` drive letter.
- Make one focused commit per task. Stage only the paths named in that task.
- GitHub branch push, PR creation, merge, Vercel production deployment, Apps Script deployment, Google Sheet writes, and Task Scheduler registration each require an explicit execution-time authorization check.

## File Structure

### Public repository: `aincustoms-github`

- Modify: `index.html` — replace the Genspark navigation target with `/requirements/`.
- Create: `requirements/index.html` — migrated single-page application and DB refresh control.
- Create: `requirements/css/style.css` — base application styling.
- Create: `requirements/css/unified-search.css` — unified-search styling.
- Create: `requirements/css/review-needed.css` — review-needed styling.
- Create: `requirements/js/runtime-config.js` — one public Apps Script `/exec` endpoint value; no secrets.
- Create: `requirements/js/google-sheets-api.js` — token-aware API adapter, response mapping, and cache control.
- Create: `requirements/js/auth.js` — login/logout and sessionStorage lifecycle.
- Create: `requirements/js/date-formatter.js` — copied date utilities.
- Create: `requirements/js/parser.js` — copied pasted-table parser.
- Create: `requirements/js/file-handler.js` — copied upload/download handlers.
- Create: `requirements/js/unified-search.js` — v5.4.4 unified search.
- Create: `requirements/js/review-needed.js` — v5.4.4 review-needed behavior.
- Create: `requirements/js/selection-delete.js` — copied selection deletion.
- Create: `requirements/js/duplicate-checker.js` — copied duplicate checks.
- Create: `requirements/js/edit-request.js` — copied edit-request behavior.
- Create: `requirements/js/app.js` — main UI logic with Genspark remnants removed and force refresh added.
- Create: `requirements/data/msds.csv` — static reference data.
- Create: `test/requirements-static-package.test.js` — route, asset, script-order, and forbidden-file assertions.
- Create: `test/requirements-api-client.test.js` — browser API request, token, cache, and error mapping tests.
- Create: `test/requirements-auth-ui.test.js` — session lifecycle and secret-logging tests.
- Create: `test/requirements-runtime-config.test.js` — deployed endpoint contract test.
- Create: `docs/AIN_REQUIREMENTS_PUBLIC_OPERATIONS.md` — public, secret-free deployment and rollback notes.

### Local-only repository: sibling `../ain-requirements-private`

- Create: `.gitignore` — exclude credentials, encrypted secrets, logs, backups, and restored files.
- Create: `apps-script/Code.gs` — secure CRUD, token, password migration, Drive backup, heartbeat, and restore configuration.
- Create: `apps-script/appsscript.json` — Asia/Seoul timezone and minimum scopes.
- Create: `apps-script/test/backend-auth.test.js` — token/password/rate-limit tests with Apps Script mocks.
- Create: `apps-script/test/backend-authorization.test.js` — server-authoritative CRUD tests.
- Create: `apps-script/test/backend-backup.test.js` — validation and retention tests.
- Create: `backup/export_weekly_backup.py` — read-only Drive export, SHA-256 manifest, and retention.
- Create: `backup/protect_credentials.ps1` — DPAPI encryption bootstrap for the existing service-account JSON and backup-agent secret.
- Create: `backup/run_weekly_backup.ps1` — DPAPI decryption, Python invocation, heartbeat, and logs.
- Create: `backup/register_weekly_task.ps1` — exact Sunday 03:00 KST scheduled-task registration.
- Create: `backup/tests/test_export_weekly_backup.py` — standard-library unit tests.
- Create: `docs/PRIVATE_OPERATIONS.md` — private deployment, backup, restore, and 24-hour cutover runbook.

---

### Task 1: Import and Route the Static v5.4.4 Application

**Files:**
- Create: `requirements/index.html`
- Create: `requirements/css/style.css`
- Create: `requirements/css/unified-search.css`
- Create: `requirements/css/review-needed.css`
- Create: `requirements/js/*.js`
- Create: `requirements/data/msds.csv`
- Modify: `index.html:571-572`
- Create: `test/requirements-static-package.test.js`

**Interfaces:**
- Consumes: approved source directory `../요건관리 홈페이지/code_sandbox_light_eb81f206_1787121514/`.
- Produces: a complete `/requirements/` static package and root navigation target used by later tasks.

- [ ] **Step 1: Write the failing static-package test**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const appRoot = path.join(root, "requirements");

test("requirements application is routed and contains only production assets", () => {
  const required = [
    "index.html",
    "css/style.css",
    "css/unified-search.css",
    "css/review-needed.css",
    "js/google-sheets-api.js",
    "js/auth.js",
    "js/app.js",
    "data/msds.csv",
  ];
  for (const relative of required) {
    assert.equal(fs.existsSync(path.join(appRoot, relative)), true, relative);
  }

  const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(homepage, /href="\/requirements\/"[^>]*>[\s\S]*?AIN 요건관리/);

  const forbidden = fs.readdirSync(appRoot).filter((name) =>
    /\.gs$|가이드|인계|download|llRqlSrj/i.test(name)
  );
  assert.deepEqual(forbidden, []);
});

test("requirements scripts preserve the required dependency order", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const order = [
    "runtime-config.js",
    "google-sheets-api.js",
    "date-formatter.js",
    "auth.js",
    "parser.js",
    "file-handler.js",
    "unified-search.js",
    "review-needed.js",
    "selection-delete.js",
    "duplicate-checker.js",
    "edit-request.js",
    "app.js",
  ];
  let cursor = -1;
  for (const filename of order) {
    const next = html.indexOf(filename);
    assert.ok(next > cursor, `${filename} should follow the previous script`);
    cursor = next;
  }
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test test/requirements-static-package.test.js
```

Expected: FAIL because `requirements/` does not exist and the homepage still targets Genspark.

- [ ] **Step 3: Copy only the approved production files**

```powershell
$source = Resolve-Path '..\요건관리 홈페이지\code_sandbox_light_eb81f206_1787121514'
$destination = Join-Path (Get-Location) 'requirements'
New-Item -ItemType Directory -Force -Path $destination,"$destination\css","$destination\js","$destination\data"
Copy-Item -LiteralPath "$source\index.html" -Destination "$destination\index.html"
Copy-Item -LiteralPath "$source\css\style.css","$source\css\unified-search.css","$source\css\review-needed.css" -Destination "$destination\css"
Copy-Item -LiteralPath "$source\js\google-sheets-api.js","$source\js\date-formatter.js","$source\js\auth.js","$source\js\parser.js","$source\js\file-handler.js","$source\js\unified-search.js","$source\js\review-needed.js","$source\js\selection-delete.js","$source\js\duplicate-checker.js","$source\js\edit-request.js","$source\js\app.js" -Destination "$destination\js"
Copy-Item -LiteralPath "$source\data\msds.csv" -Destination "$destination\data\msds.csv"
```

Create `requirements/js/runtime-config.js` before `google-sheets-api.js` in `requirements/index.html`. Initially copy the currently verified Apps Script URL into the public config so Task 2 unit tests can run; Task 7 replaces it with the exact v2 deployment URL before preview.

- [ ] **Step 4: Update the homepage link**

```html
<a href="/requirements/" target="_blank" rel="noopener noreferrer"
   class="text-blue-600 hover:text-blue-800 font-bold text-base transition-colors">AIN 요건관리</a>
```

- [ ] **Step 5: Run the focused and full Node suites**

Run:

```powershell
node --test test/requirements-static-package.test.js
node --test test/*.test.js
```

Expected: the focused test passes and the existing full suite has no regression.

- [ ] **Step 6: Commit the static package**

```powershell
git add -- index.html requirements test/requirements-static-package.test.js
git commit -m "feat: add AIN requirements static application"
```

### Task 2: Make the Browser Client Token-Aware and Remove Genspark

**Files:**
- Create: `test/requirements-api-client.test.js`
- Create: `test/requirements-auth-ui.test.js`
- Modify: `requirements/js/runtime-config.js`
- Modify: `requirements/js/google-sheets-api.js:23-305`
- Modify: `requirements/js/auth.js:18-68`
- Modify: `requirements/js/app.js:8-32, 2940-2960`
- Modify: `requirements/index.html:734-746`

**Interfaces:**
- Consumes: `window.AIN_REQUIREMENTS_CONFIG.apiUrl` and `sessionStorage.ainRequirementsSession`.
- Produces: `GoogleSheetsAPI.call(action, params, options)`, `GoogleSheetsAPI.clearAllCache()`, `mapApiErrorCodeToStatus(errorCode)`, and `clearAndReloadFromDatabase()`.

- [ ] **Step 1: Write failing API-client tests**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "requirements", "js", "google-sheets-api.js"),
  "utf8"
);

function harness(apiResult) {
  const calls = [];
  const storage = new Map([["ainRequirementsSession", JSON.stringify({ token: "signed-token" })]]);
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {},
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return { json: async () => apiResult };
    },
    Response,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.AIN_REQUIREMENTS_CONFIG = { apiUrl: "https://script.google.com/macros/s/test/exec" };
  vm.createContext(context);
  vm.runInContext(`${source}; this.API = GoogleSheetsAPI; this.mapStatus = mapApiErrorCodeToStatus;`, context);
  return { context, calls };
}

test("authenticated requests send token but not client authority", async () => {
  const { context, calls } = harness({ success: true, data: [] });
  await context.API.getData("msds");
  assert.equal(calls[0].body.token, "signed-token");
  assert.equal("role" in calls[0].body, false);
  assert.equal("companyName" in calls[0].body, false);
  assert.equal("username" in calls[0].body, false);
});

test("Apps Script error codes map to browser status", () => {
  const { context } = harness({ success: false });
  assert.equal(context.mapStatus("UNAUTHORIZED"), 401);
  assert.equal(context.mapStatus("FORBIDDEN"), 403);
  assert.equal(context.mapStatus("VALIDATION_ERROR"), 400);
});
```

- [ ] **Step 2: Write failing auth/session tests**

```javascript
const auth = fs.readFileSync(
  path.join(__dirname, "..", "requirements", "js", "auth.js"),
  "utf8"
);

test("auth stores only the sanitized session and does not log credentials", () => {
  assert.match(auth, /ainRequirementsSession/);
  assert.doesNotMatch(auth, /console\.(log|debug)\([^\n]*(password|token)/i);
  assert.doesNotMatch(auth, /gensparkspace|page_private|zxjqwehj/i);
});

test("all production scripts are free of Genspark runtime references", () => {
  const jsRoot = path.join(__dirname, "..", "requirements", "js");
  for (const name of fs.readdirSync(jsRoot)) {
    const text = fs.readFileSync(path.join(jsRoot, name), "utf8");
    assert.doesNotMatch(text, /gensparkspace|page_private|zxjqwehj/i, name);
  }
});
```

- [ ] **Step 3: Run tests and verify the security contract fails**

Run:

```powershell
node --test test/requirements-api-client.test.js test/requirements-auth-ui.test.js
```

Expected: FAIL because the current client sends username/role/company and contains Genspark references.

- [ ] **Step 4: Implement the token-aware request body and error adapter**

```javascript
function currentSession() {
  return JSON.parse(sessionStorage.getItem("ainRequirementsSession") || "null");
}

function mapApiErrorCodeToStatus(errorCode) {
  return ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 }[errorCode] || 400);
}

async function callApi(action, params = {}, { anonymous = false } = {}) {
  const session = currentSession();
  const body = { action, ...params };
  if (!anonymous) body.token = session?.token || "";
  const response = await originalFetch(AIN_REQUIREMENTS_CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.success && result.error_code === "UNAUTHORIZED") {
    sessionStorage.removeItem("ainRequirementsSession");
  }
  return result;
}
```

Change login to `callApi("login", { username, password }, { anonymous: true })`. Change authenticated CRUD bodies to contain only token, table name, record ID, and data.

- [ ] **Step 5: Add explicit DB refresh**

```javascript
async function clearAndReloadFromDatabase() {
  GoogleSheetsAPI.clearAllCache();
  await loadDashboard();
  await loadCurrentSection();
}
```

Add a visible `DB 기준 새로고침` button to the authenticated dashboard. Disable it while reloading and show a Korean success or failure message.

- [ ] **Step 6: Remove Genspark-specific branches and bump cache version**

Delete `isDeployedEnvironment()` and both `page_private` alerts. Keep `canEditData()` role-based only. Change every local script/style query string in `requirements/index.html` from `v=5.4.4` to `v=6.0.0`.

- [ ] **Step 7: Run the focused and full suites**

```powershell
node --test test/requirements-api-client.test.js test/requirements-auth-ui.test.js test/requirements-static-package.test.js
node --test test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit the browser security migration**

```powershell
git add -- requirements/index.html requirements/js/runtime-config.js requirements/js/google-sheets-api.js requirements/js/auth.js requirements/js/app.js test/requirements-api-client.test.js test/requirements-auth-ui.test.js
git commit -m "feat: secure AIN requirements browser client"
```

### Task 3: Build the Local-Only Token and Password Backend

**Files:**
- Create: `../ain-requirements-private/.gitignore`
- Create: `../ain-requirements-private/apps-script/Code.gs`
- Create: `../ain-requirements-private/apps-script/appsscript.json`
- Create: `../ain-requirements-private/apps-script/test/backend-auth.test.js`

**Interfaces:**
- Consumes Script Properties: `ACTIVE_SPREADSHEET_ID`, `TOKEN_SIGNING_SECRET`, `PASSWORD_PEPPER`, and `LEGACY_PASSWORD_CUTOFF`.
- Produces: `handleLogin(username, password)`, `createSessionToken(username, authVersion, nowMs)`, `verifySessionToken(token, nowMs)`, `loadAuthoritativeUser(username)`, and `authenticateRequest(requestData, nowMs)`.

- [ ] **Step 1: Initialize a local-only Git repository**

```powershell
New-Item -ItemType Directory -Force ..\ain-requirements-private\apps-script\test
git -C ..\ain-requirements-private init
git -C ..\ain-requirements-private config user.name "jsh6720"
git -C ..\ain-requirements-private config user.email "jsh@aincustoms.com"
```

Create `.gitignore` with these exact entries:

```gitignore
secrets/
logs/
backups/
restores/
*.dpapi
*.json.enc
service-account*.json
```

Do not add a remote to this repository.

- [ ] **Step 2: Write the failing token and password tests**

```javascript
test("signed token verifies and a changed byte is rejected", () => {
  const token = context.createSessionToken("tester", 3, 1_700_000_000_000);
  assert.equal(context.verifySessionToken(token, 1_700_000_001_000).username, "tester");
  assert.equal(context.verifySessionToken(`${token}x`, 1_700_000_001_000).ok, false);
});

test("expired token and changed auth version are rejected", () => {
  const token = context.createSessionToken("tester", 3, 1_700_000_000_000);
  assert.equal(context.verifySessionToken(token, 1_700_028_800_001).error_code, "UNAUTHORIZED");
  context.users.tester.auth_version = 4;
  assert.equal(context.authenticateRequest({ token }, 1_700_000_001_000).error_code, "UNAUTHORIZED");
});

test("legacy password creates a hash without exposing secrets", () => {
  const result = context.handleLogin("tester", "correct-password");
  assert.equal(result.success, true);
  assert.equal(context.users.tester.password_hash.length > 20, true);
  assert.equal(JSON.stringify(result).includes("correct-password"), false);
});

test("five failures lock the username for fifteen minutes", () => {
  for (let i = 0; i < 5; i += 1) context.handleLogin("tester", "wrong");
  assert.equal(context.handleLogin("tester", "correct-password").error_code, "RATE_LIMITED");
});
```

The test harness must mock `Utilities`, `PropertiesService`, `CacheService`, `SpreadsheetApp`, and `Logger`; it must fail before `Code.gs` exists.

- [ ] **Step 3: Run the focused test and verify it fails**

```powershell
node --test ..\ain-requirements-private\apps-script\test\backend-auth.test.js
```

Expected: FAIL because token, password, and rate-limit functions are undefined.

- [ ] **Step 4: Implement token signing and verification**

```javascript
function createSessionToken(username, authVersion, nowMs) {
  const issuedAt = Number(nowMs || Date.now());
  const payload = {
    v: 1,
    sub: username,
    av: Number(authVersion || 1),
    iat: issuedAt,
    exp: issuedAt + (8 * 60 * 60 * 1000),
  };
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const secret = requireScriptProperty("TOKEN_SIGNING_SECRET");
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(encoded, secret)
  );
  return `${encoded}.${signature}`;
}
```

`verifySessionToken()` must use a constant-time byte comparison, reject malformed/expired tokens, load the current `AIN_Users` row, and compare `auth_version`.

- [ ] **Step 5: Implement password transition and rate limiting**

Hash `salt + password` with HMAC-SHA256 using `PASSWORD_PEPPER`. On a successful legacy login, populate `password_hash`, `password_salt`, and `auth_version`; keep the plaintext only until `LEGACY_PASSWORD_CUTOFF`. Use Script Cache keys `login-fail:<normalized username>` and `login-lock:<normalized username>` for the 5-failure/15-minute rule.

- [ ] **Step 6: Run tests and commit the private backend foundation**

```powershell
node --test ..\ain-requirements-private\apps-script\test\backend-auth.test.js
git -C ..\ain-requirements-private add -- .gitignore apps-script/Code.gs apps-script/appsscript.json apps-script/test/backend-auth.test.js
git -C ..\ain-requirements-private commit -m "feat: add secure Apps Script sessions"
```

Expected: PASS and one local-only commit. Confirm `git remote -v` prints nothing.

### Task 4: Enforce Server-Authoritative CRUD Authorization

**Files:**
- Create: `../ain-requirements-private/apps-script/test/backend-authorization.test.js`
- Modify: `../ain-requirements-private/apps-script/Code.gs`

**Interfaces:**
- Consumes: `authenticateRequest(requestData, nowMs)` and the existing nine-sheet name map.
- Produces: `handleGetData(user, tableName)`, `handleAddData(user, tableName, data)`, `handleUpdateData(user, tableName, id, data)`, `handleDeleteData(user, tableName, id)`, and `authorizeRecord(user, record)`.

- [ ] **Step 1: Write failing authorization tests**

```javascript
test("client role and company cannot elevate a normal user", () => {
  const response = post({
    action: "getData",
    token: normalUserToken,
    tableName: "msds",
    role: "master",
    companyName: "다른회사",
  });
  assert.deepEqual(response.data.map((row) => row.importer), ["AIN_TEST"]);
});

test("unauthenticated CRUD and public migration are rejected", () => {
  assert.equal(post({ action: "getData", tableName: "msds" }).error_code, "UNAUTHORIZED");
  assert.equal(post({ action: "addData", tableName: "msds", data: {} }).error_code, "UNAUTHORIZED");
  assert.equal(post({ action: "migrateData", token: masterToken }).error_code, "UNKNOWN_ACTION");
});

test("cross-company update and delete are forbidden", () => {
  assert.equal(post({ action: "updateData", token: normalUserToken, tableName: "msds", id: "other", data: {} }).error_code, "FORBIDDEN");
  assert.equal(post({ action: "deleteData", token: normalUserToken, tableName: "msds", id: "other" }).error_code, "FORBIDDEN");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```powershell
node --test ..\ain-requirements-private\apps-script\test\backend-authorization.test.js
```

Expected: FAIL because the current request dispatcher trusts client authority and still exposes migration.

- [ ] **Step 3: Implement the secure request dispatcher**

```javascript
function handleRequest(e) {
  const requestData = parseRequest(e);
  if (requestData.action === "login") {
    return createResponse(handleLogin(requestData.username, requestData.password));
  }
  const auth = authenticateRequest(requestData, Date.now());
  if (!auth.ok) return createResponse(auth);
  const user = auth.user;
  switch (requestData.action) {
    case "getData": return createResponse(handleGetData(user, requestData.tableName));
    case "addData": return createResponse(handleAddData(user, requestData.tableName, requestData.data));
    case "updateData": return createResponse(handleUpdateData(user, requestData.tableName, requestData.id, requestData.data));
    case "deleteData": return createResponse(handleDeleteData(user, requestData.tableName, requestData.id));
    default: return createResponse({ success: false, error_code: "UNKNOWN_ACTION", error: "Unknown action" });
  }
}
```

`handleAddData()` must set authoritative creator/company fields. `handleUpdateData()` and `handleDeleteData()` must load the stored record before checking company scope. Do not accept username, role, or company from request bodies.

- [ ] **Step 4: Run both backend test files**

```powershell
node --test ..\ain-requirements-private\apps-script\test\backend-auth.test.js ..\ain-requirements-private\apps-script\test\backend-authorization.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit server-authoritative CRUD**

```powershell
git -C ..\ain-requirements-private add -- apps-script/Code.gs apps-script/test/backend-authorization.test.js
git -C ..\ain-requirements-private commit -m "feat: enforce requirements data authorization"
```

### Task 5: Add Drive Backup, Retention, Heartbeat, and Restore Controls

**Files:**
- Create: `../ain-requirements-private/apps-script/test/backend-backup.test.js`
- Modify: `../ain-requirements-private/apps-script/Code.gs`

**Interfaces:**
- Consumes Script Properties: `ACTIVE_SPREADSHEET_ID`, `BACKUP_FOLDER_ID`, `BACKUP_LOG_SPREADSHEET_ID`, `BACKUP_AGENT_SECRET`, and `FAILURE_NOTIFICATION_TO`.
- Produces: `runDailyBackup(now)`, `verifyBackupCopy(source, copy)`, `pruneBackupFiles(files, now)`, `recordWeeklyBackup(requestData)`, and `setActiveSpreadsheetIdForRestore(id)`.

- [ ] **Step 1: Write failing backup tests**

```javascript
test("backup validation requires all nine sheets and matching dimensions", () => {
  const source = workbook(requiredSheets({ AIN_MSDS: [968, 26] }));
  const copy = workbook(requiredSheets({ AIN_MSDS: [967, 26] }));
  const result = context.verifyBackupCopy(source, copy);
  assert.equal(result.success, false);
  assert.match(result.error, /AIN_MSDS/);
});

test("retention deletes only approved prefixes inside the backup folder", () => {
  const files = [
    fakeFile("Ain_compliance_db_DAILY_20260601_0200", oldDate),
    fakeFile("unrelated.xlsx", oldDate),
    fakeFile("Ain_compliance_db_DAILY_20260820_0200", recentDate),
  ];
  context.pruneBackupFiles(files, now);
  assert.equal(files[0].trashed, true);
  assert.equal(files[1].trashed, false);
  assert.equal(files[2].trashed, false);
});

test("restore changes only the active spreadsheet property", () => {
  context.setActiveSpreadsheetIdForRestore("validated-copy-id");
  assert.equal(context.scriptProperties.ACTIVE_SPREADSHEET_ID, "validated-copy-id");
  assert.equal(context.deletedSpreadsheetIds.length, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test ..\ain-requirements-private\apps-script\test\backend-backup.test.js
```

Expected: FAIL because backup and restore helpers do not exist.

- [ ] **Step 3: Implement verified Drive copies**

`runDailyBackup()` must:

1. Open `ACTIVE_SPREADSHEET_ID`.
2. Copy the file into `BACKUP_FOLDER_ID` using `Ain_compliance_db_DAILY_YYYYMMDD_HHmm`.
3. On the first day of a month, create `Ain_compliance_db_MONTHLY_YYYYMM`.
4. Reopen each copy and verify nine sheet names, header arrays, last rows, and last columns.
5. Append a sanitized result row to `BACKUP_LOG_SPREADSHEET_ID`.
6. Prune only matching daily files older than 30 days and monthly files older than 12 months.
7. Send `[AIN DB 백업 실패]` to `FAILURE_NOTIFICATION_TO` on failure.

- [ ] **Step 4: Implement weekly heartbeat and restore configuration**

`recordWeeklyBackup()` must use `Utilities.computeHmacSha256Signature` to verify the local agent signature, append success/failure metadata to the backup log, and email only on failure. `setActiveSpreadsheetIdForRestore()` is a manually run administrative function, validates the candidate workbook first, and only then updates Script Properties.

- [ ] **Step 5: Run all private backend tests**

```powershell
node --test ..\ain-requirements-private\apps-script\test\*.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the backup backend**

```powershell
git -C ..\ain-requirements-private add -- apps-script/Code.gs apps-script/test/backend-backup.test.js
git -C ..\ain-requirements-private commit -m "feat: add verified Google Drive backups"
```

### Task 6: Build the Weekly UNC XLSX Exporter

**Files:**
- Create: `../ain-requirements-private/backup/export_weekly_backup.py`
- Create: `../ain-requirements-private/backup/protect_credentials.ps1`
- Create: `../ain-requirements-private/backup/run_weekly_backup.ps1`
- Create: `../ain-requirements-private/backup/register_weekly_task.ps1`
- Create: `../ain-requirements-private/backup/tests/test_export_weekly_backup.py`

**Interfaces:**
- Consumes: service-account JSON through stdin, Drive read-only scope, `ACTIVE_SPREADSHEET_ID`, `BACKUP_AGENT_SECRET`, and the exact UNC output directory.
- Produces: `export_weekly_backup(config, credential_json, now) -> BackupResult`, XLSX file, `.sha256`, `.manifest.json`, and a signed weekly heartbeat.

- [ ] **Step 1: Write failing Python unit tests**

```python
import datetime as dt
import tempfile
import unittest
from pathlib import Path

from export_weekly_backup import backup_filename, prune_weekly_backups, sha256_bytes


class WeeklyBackupTests(unittest.TestCase):
    def test_filename_uses_kst_timestamp(self):
        when = dt.datetime(2026, 8, 23, 3, 0, tzinfo=dt.timezone(dt.timedelta(hours=9)))
        self.assertEqual(backup_filename(when), "Ain_compliance_db_WEEKLY_20260823_0300.xlsx")

    def test_retention_keeps_52_and_ignores_unrelated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(54):
                (root / f"Ain_compliance_db_WEEKLY_2025{index:04d}.xlsx").write_bytes(str(index).encode())
            unrelated = root / "customer_document.xlsx"
            unrelated.write_bytes(b"keep")
            prune_weekly_backups(root, keep=52)
            self.assertEqual(len(list(root.glob("Ain_compliance_db_WEEKLY_*.xlsx"))), 52)
            self.assertTrue(unrelated.exists())

    def test_sha256_is_deterministic(self):
        self.assertEqual(sha256_bytes(b"AIN"), sha256_bytes(b"AIN"))
```

- [ ] **Step 2: Run tests and verify they fail**

```powershell
& 'C:\Users\jsh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover '..\ain-requirements-private\backup\tests' -v
```

Expected: FAIL because `export_weekly_backup` does not exist.

- [ ] **Step 3: Implement the read-only export**

Use `cryptography.hazmat.primitives.serialization.load_pem_private_key` to sign a service-account JWT, exchange it at `https://oauth2.googleapis.com/token` with only `https://www.googleapis.com/auth/drive.readonly`, then download:

```text
GET https://www.googleapis.com/drive/v3/files/{spreadsheet_id}/export
    ?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Write to a temporary file in the destination directory, calculate SHA-256, write a manifest containing source ID, UTC/KST timestamps, byte count, and checksum, then atomically rename the XLSX. Prune only `Ain_compliance_db_WEEKLY_*.xlsx` files beyond the newest 52 and remove their matching manifest/checksum sidecars.

- [ ] **Step 4: Implement DPAPI credential protection**

`protect_credentials.ps1` must read the existing credential JSON interactively, validate that `client_email` equals `db-viewer@n8n-pj-467301.iam.gserviceaccount.com`, combine it with the backup-agent secret, and encrypt the JSON with user-bound Windows DPAPI. Store only the encrypted blob under `C:\ProgramData\AIN\requirements-backup\service-account.json.dpapi` with ACL access limited to the scheduled-task user and Administrators.

- [ ] **Step 5: Implement the scheduled runner and registration script**

`run_weekly_backup.ps1` must decrypt in memory, pass JSON to Python stdin, write UTF-8 logs under `C:\ProgramData\AIN\requirements-backup\logs`, and send a signed success/failure heartbeat to the v2 Apps Script endpoint. `register_weekly_task.ps1` must register exactly one task named `AIN Requirements Weekly DB Backup`, Sunday 03:00 KST, running as the credential owner, with a 60-minute execution limit and non-overlap policy.

Before calling `Register-ScheduledTask`, print the resolved executable, script, credential blob, and UNC output paths and obtain execution-time approval.

- [ ] **Step 6: Run unit tests and a dry run**

```powershell
& 'C:\Users\jsh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover '..\ain-requirements-private\backup\tests' -v
& '..\ain-requirements-private\backup\run_weekly_backup.ps1' -DryRun
```

Expected: unit tests PASS; dry run validates paths and credentials without downloading, deleting, sending heartbeat, or registering a task.

- [ ] **Step 7: Commit the weekly backup implementation**

```powershell
git -C ..\ain-requirements-private add -- backup/export_weekly_backup.py backup/protect_credentials.ps1 backup/run_weekly_backup.ps1 backup/register_weekly_task.ps1 backup/tests/test_export_weekly_backup.py
git -C ..\ain-requirements-private commit -m "feat: add weekly UNC database backup"
```

### Task 7: Deploy Apps Script v2 and Bind the Public Client

**Files:**
- Create: `test/requirements-runtime-config.test.js`
- Modify: `requirements/js/runtime-config.js`
- Modify outside public repo: Apps Script project and Script Properties

**Interfaces:**
- Consumes: tested `../ain-requirements-private/apps-script/Code.gs` and exact generated `/exec` deployment URL.
- Produces: deployed Apps Script v2, installed daily backup trigger, and public runtime config that points to v2.

- [ ] **Step 1: Write the failing runtime-config test**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("requirements config uses a new Apps Script v2 deployment", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "requirements", "js", "runtime-config.js"),
    "utf8"
  );
  assert.match(source, /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
  assert.doesNotMatch(source, /AKfycby3hhpd2Nk2K4dFu48g_Y1zhrmmGaRZvMWNNfi-CaNi8mfrzBnWUIlK73GDJKR_NH18Fw/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/requirements-runtime-config.test.js
```

Expected: FAIL because config still contains the legacy deployment URL.

- [ ] **Step 3: Create prerequisite backup resources**

Using the authenticated Google account, create one private Drive folder for backups and one private backup-log spreadsheet. Verify both are owned by `aincustomskr@gmail.com`; do not change sharing on the operational DB.

- [ ] **Step 4: Configure Script Properties with observed/generated values**

Set exactly these keys in the new Apps Script project:

```text
ACTIVE_SPREADSHEET_ID
TOKEN_SIGNING_SECRET
PASSWORD_PEPPER
BACKUP_FOLDER_ID
BACKUP_LOG_SPREADSHEET_ID
BACKUP_AGENT_SECRET
FAILURE_NOTIFICATION_TO=jsh@aincustoms.com
LEGACY_PASSWORD_CUTOFF
```

Generate the three secrets with a cryptographically secure random generator. Set `LEGACY_PASSWORD_CUTOFF` to 24 hours after the planned production cutover. Record values only in the private deployment record, never in Git or chat output.

- [ ] **Step 5: Deploy a new Apps Script web-app version**

Deploy as the DB-owning account and allow unauthenticated web invocation because bearer-token validation is implemented inside the script. Copy the exact `/exec` URL returned by the completed deployment and verify an invalid login returns `success:false` without exposing data.

- [ ] **Step 6: Install the daily backup trigger**

Create one time-driven trigger for `runDailyBackup` at 02:00 Asia/Seoul. Run it once manually, verify the created copy, required nine-sheet manifest, backup-log row, and retention dry-run output before enabling deletion.

- [ ] **Step 7: Replace runtime config with the observed v2 URL**

```powershell
$deploymentUrl = Read-Host 'Paste the exact Apps Script v2 /exec URL returned by deployment'
if ($deploymentUrl -notmatch '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$') {
  throw 'The Apps Script deployment URL is invalid.'
}
$config = @"
window.AIN_REQUIREMENTS_CONFIG = Object.freeze({ apiUrl: "$deploymentUrl" });
"@
Set-Content -LiteralPath requirements\js\runtime-config.js -Value $config -Encoding utf8
```

Open the generated file and confirm that it contains only the observed deployment URL and no secret value.

- [ ] **Step 8: Run runtime and full tests**

```powershell
node --test test/requirements-runtime-config.test.js test/requirements-api-client.test.js test/requirements-auth-ui.test.js
node --test test/*.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit only the public endpoint binding and test**

```powershell
git add -- requirements/js/runtime-config.js test/requirements-runtime-config.test.js
git commit -m "chore: bind requirements app to secure backend"
```

### Task 8: Run Preview, Security, CRUD, Backup, and Restore Verification

**Files:**
- Create: `docs/AIN_REQUIREMENTS_PUBLIC_OPERATIONS.md`
- Create: `../ain-requirements-private/docs/PRIVATE_OPERATIONS.md`
- Modify only if verification finds a reproducible defect: the exact failing component and its focused test.

**Interfaces:**
- Consumes: completed public and private commits, Apps Script v2 deployment, and backup resources.
- Produces: a reviewed GitHub branch/PR, Vercel Preview evidence, cleaned test data, and verified restore path.

- [ ] **Step 1: Run all local verification before publication**

```powershell
node --test test/*.test.js
node --test ..\ain-requirements-private\apps-script\test\*.test.js
& 'C:\Users\jsh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover '..\ain-requirements-private\backup\tests' -v
git diff --check origin/main...HEAD
git status --short
```

Expected: all tests pass, diff check is clean, and only intended files are present.

- [ ] **Step 2: Review the exact GitHub publication scope**

Confirm the public branch contains no `.gs`, service-account file, `.dpapi`, log, XLSX, spreadsheet ID, signing secret, password hash, or password. Inspect `git diff --name-status origin/main...HEAD` and `git grep` for known secret keys.

- [ ] **Step 3: Obtain push and draft-PR authorization, then publish once**

After explicit approval, push the feature branch and create one draft PR against `main`. Do not retry blindly if either operation returns an uncertain result; verify the remote branch and existing PR first.

- [ ] **Step 4: Wait for Vercel Preview and verify static delivery**

Verify `/requirements/`, every local CSS/JS/data asset, and the root homepage link. Confirm both approved jsDelivr dependencies load and there are no browser console errors before login.

- [ ] **Step 5: Create isolated live test data**

Run a fresh DB backup first. In `AIN_Users`, add one temporary `user` account for company `AIN_TEST`; do not grant `master`. Through the Preview UI, add records prefixed `AIN_MIGRATION_TEST_20260820` only to the test company.

- [ ] **Step 6: Run security and source-of-truth checks**

Verify:

- invalid login fails;
- missing, expired, and modified tokens return `UNAUTHORIZED` and synthetic 401;
- forged role/company request values do not broaden data;
- cross-company update/delete returns `FORBIDDEN` and synthetic 403;
- UI add/update/delete changes the same Google Sheet;
- direct Google Sheet edit appears after `DB 기준 새로고침`;
- no Genspark request appears in the network log.

- [ ] **Step 7: Run functional browser checks**

Verify `STD85000-01` unified search, review-needed search, CSV/XLSX import, export, edit requests, duplicate prevention, mobile layout, and desktop layout. Use only test-company records for writes.

- [ ] **Step 8: Run backup and restore rehearsal**

Trigger a Drive backup and weekly XLSX export. Compare the nine sheet names, headers, row/column counts, byte count, and SHA-256 manifest. Create a separate recovery Sheet from the Drive copy, point the v2 Preview backend to it, run login/read/test-company CRUD, then restore `ACTIVE_SPREADSHEET_ID` to the production DB. Do not delete either sheet.

- [ ] **Step 9: Remove live test data and verify cleanup**

Delete only records with the exact `AIN_MIGRATION_TEST_20260820` prefix and remove the temporary `AIN_TEST` account. Re-run a read-only search for the prefix and confirm zero matches.

- [ ] **Step 10: Write runbooks and commit**

The public runbook documents URL checks, Vercel rollback, and secret-free troubleshooting. The private runbook records Apps Script deployment/version IDs, Script Property key names without values, backup folder/log IDs in the encrypted private record, weekly task identity, restore procedure, and the 24-hour cutoff checklist.

```powershell
git add -- docs/AIN_REQUIREMENTS_PUBLIC_OPERATIONS.md
git commit -m "docs: add requirements operations runbook"
git -C ..\ain-requirements-private add -- docs/PRIVATE_OPERATIONS.md
git -C ..\ain-requirements-private commit -m "docs: add private requirements runbook"
```

### Task 9: Install Weekly Scheduling and Perform Production Cutover

**Files:**
- No planned source edits; execute the verified artifacts and record results in the two runbooks.

**Interfaces:**
- Consumes: approved draft PR, passing Preview, verified Apps Script v2, protected credentials, and tested backup scripts.
- Produces: scheduled weekly backup, production `/requirements/`, monitored 24-hour transition, legacy shutdown, and final verification evidence.

- [ ] **Step 1: Protect the existing service-account credential**

Locate the credential for the approved `db-viewer` service account without printing its private key. Run `protect_credentials.ps1`, verify the DPAPI blob and ACL, then remove any task-created plaintext temporary copy. Do not change the service account's Drive permission until its other n8n usage is checked.

- [ ] **Step 2: Run one real weekly backup before scheduling**

```powershell
& '..\ain-requirements-private\backup\run_weekly_backup.ps1'
```

Verify the exact UNC target resolves inside the approved workspace, the XLSX opens, SHA-256 matches, manifest references the active DB, and the heartbeat log reports success.

- [ ] **Step 3: Obtain Task Scheduler authorization and register once**

After explicit approval, run `register_weekly_task.ps1`. Read the task back and verify name, principal, Sunday 03:00 trigger, non-overlap, 60-minute limit, script path, and last result. Do not create a duplicate task.

- [ ] **Step 4: Create the final pre-cutover backup**

Run and verify one Drive backup and one UNC XLSX backup. Record their exact file IDs/paths and checksums in the private runbook.

- [ ] **Step 5: Obtain merge/production authorization and deploy**

Confirm the draft PR diff and checks are unchanged. After explicit approval, mark the PR ready, merge once, and wait for the Vercel production deployment. Do not edit DNS.

- [ ] **Step 6: Verify production end to end**

Check:

```text
https://aincustoms.com/ -> 307 to https://www.aincustoms.com/
https://www.aincustoms.com/ -> 200
https://www.aincustoms.com/requirements/ -> 200
```

Verify root navigation, login, read-only role isolation, one test-company CRUD cycle, DB refresh, search, backup status, existing homepage, customs declaration lookup, cargo dashboard, and all existing Node tests.

- [ ] **Step 7: Monitor the 24-hour compatibility window**

Keep the old Genspark link absent from the homepage but retain the old Apps Script deployment and plaintext compatibility only for the approved 24-hour rollback window. Record errors, token failures, backup status, and user login migrations. Do not claim final completion before this window ends.

- [ ] **Step 8: Finalize security after 24 hours**

Disable the legacy Apps Script deployment, verify the Genspark application can no longer access protected CRUD, clear plaintext passwords only for rows with a valid hash/salt, and run a sheet scan confirming no migrated account retains both plaintext and hash. Keep the original DB and backups.

- [ ] **Step 9: Run final regression and backup verification**

```powershell
node --test test/*.test.js
node --test ..\ain-requirements-private\apps-script\test\*.test.js
& 'C:\Users\jsh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover '..\ain-requirements-private\backup\tests' -v
```

Verify the daily trigger, weekly scheduled task, failure notification route, latest Drive copy, latest UNC export, and restoration runbook. Record the final deployed Git SHA and Apps Script deployment version.

- [ ] **Step 10: Close the migration only after all completion criteria pass**

Confirm zero Genspark runtime calls, one operational DB, blocked authority forgery, successful CRUD/search, successful Drive and UNC backups, successful recovery rehearsal, and no regression in existing homepage/cargo functionality. If any check fails, use the documented Vercel, Apps Script, or `ACTIVE_SPREADSHEET_ID` rollback rather than applying an untested production fix.
