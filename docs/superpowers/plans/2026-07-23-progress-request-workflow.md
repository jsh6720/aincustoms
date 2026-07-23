# BL Progress Request Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BL progress table the default dashboard and add shipper request, transport-notification choice, provenance, confirmation hover, and complete calendar workflows without adding a Vercel API function.

**Architecture:** Extend the existing request and quota endpoints, adding only additive Supabase columns. Merge latest request and transport provenance metadata in `cargo-data`, then render role-specific table controls from the existing single-page dashboard. Keep the local `website_integration` copies byte-equivalent to deployed sources.

**Tech Stack:** Static HTML/CSS/JavaScript, Vercel Node.js functions, Supabase REST/PostgreSQL, Nodemailer, Node.js built-in test runner, Python unittest for the local dashboard mirror.

## Global Constraints

- Do not add a new file under `/api`; the Vercel Hobby function count must not increase.
- Both admin and shipper accounts land on `BL별 진행현황` after login.
- Document requests are active only for `입항전`, `입항`, and `반입`.
- Import requests are active only for `입항` and `반입`.
- Shipper request columns appear only to shipper accounts.
- Admin transport saves never send email.
- Shipper transport changes offer `저장만` and `저장+메일`.
- Shipper-originated values use subtle visual emphasis; login and time appear only on hover.
- Existing cargo, request, confirmation, original-document, and calendar data must not be deleted.
- Homepage and `website_integration` mirror files must remain equivalent.

---

### Task 1: Additive Database Migration And Read Compatibility

**Files:**
- Create: `supabase/migrations/20260723_add_progress_request_metadata.sql`
- Create: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\add_progress_request_metadata.sql`
- Modify: `api/cargo-data.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-data.js`
- Create: `test/progress-request-workflow.test.js`

**Interfaces:**
- Produces DB columns:
  - `cargo_import_requests.requested_import_date date`
  - `cargo_card_user_inputs.transport_updated_by_role text`
  - `cargo_card_user_inputs.transport_updated_by_login text`
  - `cargo_card_user_inputs.transport_updated_at timestamptz`
- Produces card fields:
  - `last_import_requested_import_date`
  - `last_import_request_created_at`
  - `transport_updated_by_role`
  - `transport_updated_by_login`
  - `transport_updated_at`

- [ ] **Step 1: Write failing source-contract tests**

Add tests that read the migration and `api/cargo-data.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node --test test/progress-request-workflow.test.js
```

Expected: FAIL because the migration and merged fields do not exist.

- [ ] **Step 3: Add the additive SQL migration**

Use identical SQL in both migration files:

```sql
alter table public.cargo_import_requests
  add column if not exists requested_import_date date;

alter table public.cargo_card_user_inputs
  add column if not exists transport_updated_by_role text,
  add column if not exists transport_updated_by_login text,
  add column if not exists transport_updated_at timestamptz;
```

- [ ] **Step 4: Extend cargo-data reads and fallbacks**

Add the provenance fields to the primary user-input select and merge:

```js
transport_updated_by_role: input.transport_updated_by_role || "",
transport_updated_by_login: input.transport_updated_by_login || "",
transport_updated_at: input.transport_updated_at || null,
```

Add `requested_import_date` to the primary import-request select. If Supabase reports that column missing, retry the legacy select without it. Merge:

```js
last_import_requested_import_date:
  item.requested_import_date || koreaDateFromTimestamp(item.created_at),
last_import_request_created_at: item.created_at || null,
```

Keep existing table-missing fallbacks unchanged.

- [ ] **Step 5: Mirror API and run tests**

Copy the completed source logic into the local Vercel API mirror using `apply_patch`, then run:

```powershell
node --test test/progress-request-workflow.test.js
node --check api/cargo-data.js
```

Expected: PASS and syntax check exit 0.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260723_add_progress_request_metadata.sql api/cargo-data.js test/progress-request-workflow.test.js
git commit -m "feat: add progress request metadata"
```

---

### Task 2: Expand Request APIs And Import Request Date

**Files:**
- Create: `lib/cargo-request-utils.js`
- Modify: `api/cargo-import-request.js`
- Modify: `api/cargo-original-doc-request.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-import-request.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-original-doc-request.js`
- Modify: `test/progress-request-workflow.test.js`

**Interfaces:**
- Produces `koreaDate(now) -> YYYY-MM-DD`
- Produces `normalizeIsoDate(value, fallback) -> YYYY-MM-DD`
- Import request body accepts `requested_import_date`
- Import response returns the saved request including `requested_import_date`

- [ ] **Step 1: Write failing unit and contract tests**

```js
test("Korea request date defaults deterministically", () => {
  assert.equal(koreaDate(new Date("2026-07-23T01:00:00Z")), "2026-07-23");
});

test("request APIs contain the approved stage sets", () => {
  assert.match(originalRequestApi, /\["입항전",\s*"입항",\s*"반입"\]/);
  assert.match(importRequestApi, /\["입항",\s*"반입"\]/);
  assert.match(importRequestApi, /requested_import_date/);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/progress-request-workflow.test.js
```

Expected: FAIL because the helper and expanded stage sets are missing.

- [ ] **Step 3: Implement date helper**

```js
function koreaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeIsoDate(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}
```

Export both functions.

- [ ] **Step 4: Expand original-document request validation**

Replace the two-stage conditional with:

```js
const ALLOWED_STAGES = ["입항전", "입항", "반입"];
if (!ALLOWED_STAGES.includes(card.stage)) {
  return res.status(400).json({
    success: false,
    message: "입항전, 입항 또는 반입 마일스톤의 카드만 원본서류 도착/수령 요청할 수 있습니다.",
  });
}
```

- [ ] **Step 5: Expand import request and persist request date**

Read and validate:

```js
const requestedImportDate = normalizeIsoDate(
  body.requested_import_date,
  koreaDate()
);
if (!requestedImportDate) {
  return res.status(400).json({
    success: false,
    message: "수입신고 요청일자 형식이 올바르지 않습니다.",
  });
}
```

Allow `["입항", "반입"]`, add `requested_import_date` to `requestPayload`, and include:

```js
`수입신고 요청일자: ${request.requested_import_date || "-"}`
```

in the email body.

- [ ] **Step 6: Mirror, test, and syntax-check**

Run:

```powershell
node --test test/progress-request-workflow.test.js
node --check api/cargo-import-request.js
node --check api/cargo-original-doc-request.js
```

Expected: PASS and both syntax checks exit 0.

- [ ] **Step 7: Commit**

```powershell
git add lib/cargo-request-utils.js api/cargo-import-request.js api/cargo-original-doc-request.js test/progress-request-workflow.test.js
git commit -m "feat: expand cargo request workflows"
```

---

### Task 3: Add Save-Only, Save-And-Mail, And Transport Provenance

**Files:**
- Modify: `api/cargo-quota.js`
- Modify: `lib/cargo-mail-utils.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-quota.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\_cargo-mail-utils.js`
- Modify: `test/cargo-mail-utils.test.js`
- Modify: `test/progress-request-workflow.test.js`

**Interfaces:**
- `manual_fields` accepts `send_notification: boolean`
- Successful response preserves `changed_fields`, `email_sent`, and `email_message`
- Saved input records transport provenance

- [ ] **Step 1: Write failing tests**

Add source-contract assertions:

```js
test("manual transport save honors explicit notification choice", () => {
  assert.match(quotaApi, /body\.send_notification === true/);
  assert.match(quotaApi, /transport_updated_by_role/);
  assert.match(quotaApi, /transport_updated_by_login/);
  assert.match(quotaApi, /transport_updated_at/);
});
```

Retain and extend the existing rollback test to require provenance fields in the rollback payload.

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/cargo-mail-utils.test.js test/progress-request-workflow.test.js
```

Expected: FAIL on notification choice and provenance.

- [ ] **Step 3: Add explicit notification and provenance to manual_fields**

Before saving:

```js
const sendNotification = body.send_notification === true;
const changedFields = !isAdmin
  ? warehouseChanges(previousWarehouse, nextWarehouse)
  : [];

nextPayload.transport_updated_by_role = isAdmin ? "admin" : "shipper";
nextPayload.transport_updated_by_login = session.login_id || "";
nextPayload.transport_updated_at = new Date().toISOString();
```

Send mail only under:

```js
if (!isAdmin && sendNotification && changedFields.length) {
  // existing send and rollback path
}
```

On rollback restore all changed warehouse values and the three previous provenance values. For `저장만`, return success with `email_sent: false` and no SMTP dependency.

- [ ] **Step 4: Add migration guidance**

Extend the existing missing-column error list with the three provenance column names so a write before migration returns the precise `add_progress_request_metadata.sql` instruction.

- [ ] **Step 5: Mirror and verify**

Run:

```powershell
node --test test/*.test.js
node --check api/cargo-quota.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add api/cargo-quota.js lib/cargo-mail-utils.js test/cargo-mail-utils.test.js test/progress-request-workflow.test.js
git commit -m "feat: add transport save notification choice"
```

---

### Task 4: Default Progress View And Shipper Request Columns

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`
- Modify: `test/progress-request-workflow.test.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\tests\test_card_ui_state.py`

**Interfaces:**
- Produces `currentPrimaryView` with default `"progress"`
- Produces `showPrimaryView(view)` and toolbar navigation
- Produces `progressRequestToggle(card, type)`
- Reuses `openOriginalDocModal(blNumber)` and `openImportModal(blNumber)`

- [ ] **Step 1: Write failing dashboard tests**

Test the following source contracts:

```js
assert.match(dashboard, /let currentPrimaryView = "progress"/);
assert.match(dashboard, /서류수령요청/);
assert.match(dashboard, /수입신고요청/);
assert.match(dashboard, /요청 O/);
assert.match(dashboard, /요청 X/);
assert.match(dashboard, /progress-shipper-only/);
assert.match(dashboard, /openOriginalDocModal/);
assert.match(dashboard, /openImportModal/);
```

Update progress column-count tests to account for two shipper-only columns while ensuring role CSS hides the correct column group.

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/dashboard-source.test.js test/progress-request-workflow.test.js
python -m unittest hyundai_dashboard.tests.test_card_ui_state -v
```

Expected: FAIL for missing default view and request columns.

- [ ] **Step 3: Preserve and default the primary view**

Add:

```js
let currentPrimaryView = "progress";

function showPrimaryView(view) {
  currentPrimaryView = view === "board" ? "board" : "progress";
  document.getElementById("boardWrap").style.display =
    currentPrimaryView === "board" ? "" : "none";
  document.getElementById("progressPanel").style.display =
    currentPrimaryView === "progress" ? "block" : "none";
  if (currentPrimaryView === "progress") {
    renderProgressStatus();
    renderProgressCalendar();
  }
}
```

Make `showCargoUi()` respect `currentPrimaryView`. After `loadData()` receives valid data, call `showPrimaryView(currentPrimaryView)`. Repurpose the existing progress toolbar command into a clear board/progress toggle without removing access to either screen.

- [ ] **Step 4: Add shipper-only headers and controls**

Insert after `진행상태`:

```html
<th class="progress-short center progress-shipper-only">서류수령요청</th>
<th class="progress-short center progress-shipper-only">수입신고요청</th>
```

Render:

```js
${progressRequestToggle(card, "docs")}
${progressRequestToggle(card, "import")}
```

The helper:

- Returns nothing for admin rendering.
- Uses `last_original_doc_request` or `last_import_request` for O/X.
- Enables docs only in `입항전/입항/반입`.
- Enables import only in `입항/반입`.
- Uses a compact CSS hover panel containing the latest request fields.
- Opens the existing request dialog on click.
- Uses disabled styling and a stage-restriction tooltip outside allowed stages.

- [ ] **Step 5: Add import request date to the existing modal**

Add an import-only field:

```html
<div class="modal-field" id="importRequestDateWrap">
  <label for="importRequestDate">수입신고 요청일자</label>
  <input id="importRequestDate" type="date">
</div>
```

`openImportModal` fills the latest date or `koreaToday()`. Other request modes hide the field. Submit includes:

```js
requested_import_date: document.getElementById("importRequestDate").value
```

Disable the submit command until the request completes. On success, update the card from the returned request or call `await loadData()` so O/X and calendar refresh immediately.

- [ ] **Step 6: Mirror and test**

Run:

```powershell
node --test test/*.test.js
python -m unittest discover -s hyundai_dashboard/tests -v
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js test/progress-request-workflow.test.js
git commit -m "feat: add progress request controls"
```

---

### Task 5: Transport Choice UI, Provenance Styling, Confirmation Hover, And Calendar

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`
- Modify: `test/progress-request-workflow.test.js`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\tests\test_card_ui_state.py`

**Interfaces:**
- Produces `saveProgressWarehouseEditor(sendNotification)`
- Produces `transportProvenanceClass(card)` and `transportProvenanceTitle(card)`
- Produces `progressRevisionTooltip(card)`
- Extends `progressCalendarEvents()`

- [ ] **Step 1: Write failing UI and calendar tests**

Test:

```js
assert.match(dashboard, /저장만/);
assert.match(dashboard, /저장\+메일/);
assert.match(dashboard, /send_notification/);
assert.match(dashboard, /transport_updated_by_role/);
assert.match(dashboard, /revisionSource/);
assert.match(dashboard, /수입신고요청/);
assert.match(dashboard, /\(OBL, H\/C\)/);
assert.match(dashboard, /\(양도증\)/);
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/dashboard-source.test.js test/progress-request-workflow.test.js
python -m unittest hyundai_dashboard.tests.test_card_ui_state -v
```

Expected: FAIL for the new commands, provenance, hover, and calendar labels.

- [ ] **Step 3: Add role-specific transport commands**

Render modal actions as:

```js
currentUserRole === "admin"
  ? `<button class="btn" onclick="saveProgressWarehouseEditor(false)">저장</button>`
  : `
      <button class="btn gray" onclick="saveProgressWarehouseEditor(false)">저장만</button>
      <button class="btn" onclick="saveProgressWarehouseEditor(true)">저장+메일</button>
    `;
```

Include `send_notification: sendNotification === true` in the payload. Success messaging distinguishes saved-only, emailed, and email-failed outcomes.

- [ ] **Step 4: Add admin provenance styling**

When `card.transport_updated_by_role === "shipper"`, apply a pale-blue class to ETA, storage-yard, and warehouse-date buttons. Set a title such as:

```js
`화주 입력 · ${card.transport_updated_by_login || "-"} · ${displayDateTime(card.transport_updated_at)}`
```

Do not print login or time as permanent cell text.

- [ ] **Step 5: Add BL confirmation hover**

Wrap each BL value in a tooltip host. Render every revision with:

- escaped text
- completion class
- `아인` or `화주` from `revisionSource(item)`
- no edit or delete controls

Return plain BL text when no revisions exist.

- [ ] **Step 6: Add admin request indicators**

Admins do not receive request columns. Append compact `화주요청` badges inside the progress-state cell for existing latest docs/import requests. Each badge uses the same latest-request hover formatter as the shipper O button.

- [ ] **Step 7: Complete calendar events**

Add import request:

```js
const importRequestDate = calendarDate(card.last_import_requested_import_date);
if (importRequestDate) {
  events.push({
    date: importRequestDate,
    type: "import-request",
    text: `수입신고요청 ${label}`,
  });
}
```

Build receipt labels independently:

```js
const originalTypes = [
  card.obl_received ? "OBL" : "",
  card.hc_received ? "H/C" : "",
].filter(Boolean);
if (effectiveActualDate && originalTypes.length) {
  events.push({
    date: effectiveActualDate,
    type: "actual",
    text: `서류수령 ${label} (${originalTypes.join(", ")})`,
  });
}
if (effectiveActualDate && card.doc_transfer_received) {
  events.push({
    date: effectiveActualDate,
    type: "actual transfer",
    text: `서류수령 ${label} (양도증)`,
  });
}
```

Keep arrival, document-request, and warehouse events.

- [ ] **Step 8: Mirror and run complete local tests**

Run:

```powershell
node --test test/*.test.js
python -m unittest discover -s hyundai_dashboard/tests -v
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js test/progress-request-workflow.test.js
git commit -m "feat: complete progress request experience"
```

---

### Task 6: Final Verification, Push, SQL Handoff, And Production Deployment

**Files:**
- Verify all files modified by Tasks 1-5
- Verify local mirror files under `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration`

**Interfaces:**
- Consumes all prior tasks
- Produces deployed production behavior and an operator-ready SQL migration

- [ ] **Step 1: Verify homepage/local mirror equivalence**

Run content comparisons for:

```powershell
cargo-dashboard.html
api/cargo-data.js
api/cargo-import-request.js
api/cargo-original-doc-request.js
api/cargo-quota.js
lib/cargo-mail-utils.js
```

Expected: each homepage source matches its corresponding integration mirror, accounting only for the mirror underscore naming convention in `vercel_api`.

- [ ] **Step 2: Run full automated verification**

```powershell
node --test test/*.test.js
node --check api/cargo-data.js
node --check api/cargo-import-request.js
node --check api/cargo-original-doc-request.js
node --check api/cargo-quota.js
node -e "const fs=require('fs');const h=fs.readFileSync('cargo-dashboard.html','utf8');for(const m of h.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi))new Function(m[1]);console.log('OK cargo-dashboard.html')"
python -m unittest discover -s hyundai_dashboard/tests -v
```

Expected: all tests PASS, all syntax checks exit 0, and the HTML script prints `OK`.

- [ ] **Step 3: Browser-test both roles locally**

Verify:

- Login lands on progress view.
- Board navigation remains available.
- Admin has no shipper request columns.
- Shipper sees two request columns in the correct position.
- Stage restrictions match the approved matrix.
- Request hover and BL confirmation hover do not overlap table content.
- Import date defaults to today.
- `저장만` and `저장+메일` are distinct.
- Admin shipper-origin styling is subtle and readable.
- Calendar displays request and distinct receipt events.

- [ ] **Step 4: Commit any final verification corrections**

Stage only files belonging to this plan and use a focused commit message. Confirm:

```powershell
git status --short
git log --oneline -6
```

Expected: no uncommitted implementation changes.

- [ ] **Step 5: Push `main`**

```powershell
git push origin main
```

Expected: push succeeds and the remote includes all plan commits.

- [ ] **Step 6: Apply additive SQL**

In the Supabase SQL Editor for project `bbuoegplscttvixbuavy`, run the exact contents of:

```text
Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\add_progress_request_metadata.sql
```

Expected: `Success. No rows returned.` Existing rows and tables remain intact.

- [ ] **Step 7: Verify Vercel production deployment**

Confirm the deployment for the latest Git commit reaches `Ready` and is assigned to:

```text
https://www.aincustoms.com
```

If Git auto-deploy is not triggered, redeploy the latest successful production source with the current project settings.

- [ ] **Step 8: Verify live behavior**

At `https://www.aincustoms.com/cargo-dashboard.html`, verify the same role matrix and UI behavior. Use non-destructive hover/open/cancel checks first; use one approved shipper test request only when SMTP and recipients are confirmed.
