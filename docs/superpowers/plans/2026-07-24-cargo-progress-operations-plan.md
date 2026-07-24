# Cargo Progress Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tri-state quarantine management, three-day free-time expiry, independent ETA/warehouse dates, sticker and OBL submission tracking, deterministic progress sorting, and reversible local-source lifecycle handling to the cargo dashboard.

**Architecture:** Extend the existing `cargo_card_user_inputs` record and add one lifecycle table keyed by account and BL. Reuse the existing Vercel API files because the Hobby deployment already has 12 serverless functions, then mirror the validated homepage behavior into the local Flask dashboard while preserving its local-only differences.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Vercel Node serverless functions, Supabase/PostgreSQL, Python 3 local sync, Flask, Node test runner, Python `unittest`.

## Global Constraints

- Keep the Vercel serverless function count at 12; do not create another `api/*.js` file.
- `O` means passed, `△` means application prepared, and `X` means not prepared.
- API-confirmed quarantine passes remain automatic and cannot be manually downgraded.
- Free time defaults to 3 calendar days and includes the arrival day, so expiry is effective arrival date plus 2 days.
- ETA and warehouse expected date are independent fields.
- Missing local BL folders are auto-hidden and recoverable; permanent exclusion prevents later sync recreation until an administrator restores the tombstone.
- Local and website card behavior must remain aligned, but preserve the local template title, `ontoggle` persistence, and local `saveManualFields` open-state handling.

---

### Task 1: Pure dashboard behavior and regression tests

**Files:**
- Modify: `test/dashboard-source.test.js`
- Modify: `test/cargo-card-merge.test.js`
- Modify: `test/cargo-original-doc-utils.test.js`
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: existing `calendarDate`, `milestoneIndex`, `inspectionPassed`, and card rendering helpers.
- Produces: `freeTimeExpiry(card) -> "YYYY-MM-DD" | ""`, `sortProgressCards(cards) -> Card[]`, and tri-state status rendering.

- [ ] **Step 1: Write failing tests for inclusive expiry, progress sorting, tri-state controls, sticker defaults, and ETA/warehouse separation**

```js
test("three free-time days include the arrival date", () => {
  assert.equal(freeTimeExpiry({ eta_date: "2026-07-25", free_time_days: 3 }), "2026-07-27");
});

test("progress cards sort by destination, ETA, milestone, then BL", () => {
  const sorted = sortProgressCards(fixtures);
  assert.deepEqual(sorted.map((card) => card.bl_number), expectedBlOrder);
});

test("warehouse save payload does not include unchanged eta_date", () => {
  assert.equal(source.includes("payload.eta_date = etaDate;"), false);
});
```

- [ ] **Step 2: Run the focused Node tests and confirm they fail**

Run: `node --test test/dashboard-source.test.js test/cargo-card-merge.test.js test/cargo-original-doc-utils.test.js`

Expected: FAIL on missing three-day expiry, sorting, tri-state, or independent-date behavior.

- [ ] **Step 3: Implement minimal pure helpers and rendering behavior**

```js
function freeTimeExpiry(card) {
  if (card.free_time_expiry_override) return calendarDate(card.free_time_expiry_override);
  const base = calendarDate(effectiveEtaDate(card));
  if (!base) return "";
  const days = Math.max(1, Number(card.free_time_days || 3));
  return addCalendarDays(base, days - 1);
}

function sortProgressCards(cards) {
  return [...cards].sort((a, b) =>
    destinationName(a).localeCompare(destinationName(b), "ko") ||
    compareDatesMissingLast(effectiveEtaDate(a), effectiveEtaDate(b)) ||
    milestoneIndex(a.stage) - milestoneIndex(b.stage) ||
    String(a.bl_number).localeCompare(String(b.bl_number))
  );
}
```

Extend the inspection renderer to accept only `O`, `△`, `X`, and automatic blank state. Add sticker `O/X`, OBL carrier submission, and free-time expiry cells without adding a serverless function.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `node --test test/dashboard-source.test.js test/cargo-card-merge.test.js test/cargo-original-doc-utils.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the behavior foundation**

```bash
git add cargo-dashboard.html test/dashboard-source.test.js test/cargo-card-merge.test.js test/cargo-original-doc-utils.test.js
git commit -m "Add cargo progress operations behavior"
```

### Task 2: Supabase schema and API persistence

**Files:**
- Create: `supabase/migrations/20260724_add_cargo_progress_operations.sql`
- Modify: `api/cargo-data.js`
- Modify: `api/cargo-quota.js`
- Modify: `api/cargo-card-visibility.js`
- Modify: `test/cargo-card-merge.test.js`
- Modify: `test/viewer-account.test.js`

**Interfaces:**
- Consumes: authenticated account id and BL from existing session/API helpers.
- Produces: persisted `sticker_requested`, OBL submission fields, `free_time_expiry_override`, inspection tri-state values, and lifecycle state.

- [ ] **Step 1: Write failing API/source tests for new columns and actions**

```js
assert.match(cargoDataSource, /free_time_expiry_override/);
assert.match(cargoQuotaSource, /sticker_requested/);
assert.match(visibilitySource, /permanent_exclude/);
assert.match(visibilitySource, /restore_exclusion/);
```

- [ ] **Step 2: Run focused API tests and confirm they fail**

Run: `node --test test/cargo-card-merge.test.js test/viewer-account.test.js`

Expected: FAIL because persistence fields and lifecycle actions are absent.

- [ ] **Step 3: Add the idempotent migration**

```sql
alter table public.cargo_card_user_inputs
  add column if not exists sticker_requested boolean not null default false,
  add column if not exists obl_carrier_submitted boolean not null default false,
  add column if not exists obl_carrier_submitted_date date,
  add column if not exists obl_carrier_submitted_by text,
  add column if not exists obl_carrier_submitted_at timestamptz,
  add column if not exists free_time_expiry_override date;

update public.cargo_card_user_inputs
set free_time_days = 3
where free_time_days is distinct from 3;

create table if not exists public.cargo_card_lifecycle (
  account_id uuid not null references public.shipper_accounts(id) on delete cascade,
  bl_number text not null,
  source_missing boolean not null default false,
  source_missing_at timestamptz,
  permanently_excluded boolean not null default false,
  permanently_excluded_at timestamptz,
  permanently_excluded_by text,
  restored_at timestamptz,
  restored_by text,
  updated_at timestamptz not null default now(),
  primary key (account_id, bl_number)
);
```

Add service-role-only grants and RLS consistent with the existing migrations.

- [ ] **Step 4: Extend existing APIs without adding a thirteenth function**

In `cargo-data.js`, select and merge the six new user-input fields and lifecycle state. In `cargo-quota.js`, validate inspection values with:

```js
function cleanInspection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!["", "O", "△", "X"].includes(normalized)) throw new Error("invalid inspection status");
  return normalized || null;
}
```

Persist sticker, OBL submission, expiry override, and manual status actions. In `cargo-card-visibility.js`, add `permanent_exclude` and `restore_exclusion` actions with administrator checks.

- [ ] **Step 5: Run API tests and confirm they pass**

Run: `node --test test/cargo-card-merge.test.js test/viewer-account.test.js`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit schema and API persistence**

```bash
git add supabase/migrations/20260724_add_cargo_progress_operations.sql api/cargo-data.js api/cargo-quota.js api/cargo-card-visibility.js test/cargo-card-merge.test.js test/viewer-account.test.js
git commit -m "Persist cargo progress operations"
```

### Task 3: Progress table, card editor, and date bug fix

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`
- Modify: `test/progress-request-workflow.test.js`

**Interfaces:**
- Consumes: Task 1 helpers and Task 2 API fields/actions.
- Produces: administrator-editable tri-state quarantine, expiry override, sticker request, OBL submission display, and correctly separated ETA/warehouse saves.

- [ ] **Step 1: Add failing source tests for required columns and controls**

```js
assert.match(source, /OBL 접수일/);
assert.match(source, /만기\\(프리타임\\)/);
assert.match(source, /스티커요청/);
assert.match(source, /동물검역.*식품검역/s);
assert.match(source, /△/);
```

Add a regression assertion proving the warehouse modal sends `eta_date` only when the ETA input changed.

- [ ] **Step 2: Run UI source tests and confirm they fail**

Run: `node --test test/dashboard-source.test.js test/progress-request-workflow.test.js`

Expected: FAIL on absent columns or incorrect payload logic.

- [ ] **Step 3: Implement progress and expanded-card UI**

Add the columns in this order:

```text
입항예정 | 만기(프리타임) | 반입(예정)구역 | 반입예정일 | 마일스톤 | 진행상태 |
OBL 접수일 | 동물검역 | 식품검역 | 유통이력 | 스티커요청 | 문서 상태...
```

Use compact O/△/X controls, lock API-confirmed O values, and show copyable distribution-history numbers on hover. Add expiry editing for administrators and fix the warehouse save payload:

```js
if (etaDate !== calendarDate(etaText(card))) {
  payload.eta_date = etaDate || null;
}
if (warehouseDate !== calendarDate(card.warehouse_expected_date)) {
  payload.warehouse_expected_date = warehouseDate || null;
}
```

- [ ] **Step 4: Run UI tests and confirm they pass**

Run: `node --test test/dashboard-source.test.js test/progress-request-workflow.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the progress UI**

```bash
git add cargo-dashboard.html test/dashboard-source.test.js test/progress-request-workflow.test.js
git commit -m "Update BL progress operations UI"
```

### Task 4: Mobile OBL carrier submission and completion mail

**Files:**
- Modify: `cargo-docs-mobile.html`
- Modify: `api/cargo-original-doc-receipt-mail.js`
- Modify: `test/cargo-mail-utils.test.js`
- Modify: `test/cargo-original-doc-utils.test.js`

**Interfaces:**
- Consumes: Task 2 OBL submission fields and the existing SMTP configuration.
- Produces: mobile OBL submission save and completion email using the existing receipt-mail API function.

- [ ] **Step 1: Write failing tests for OBL submission UI and mail payload**

```js
assert.match(mobileSource, /OBL 접수 관리/);
assert.match(mobileSource, /obl_carrier_submitted_date/);
assert.match(mailSource, /obl_carrier_submission/);
assert.match(mailSource, /OBL 접수 완료/);
```

- [ ] **Step 2: Run mobile/mail tests and confirm they fail**

Run: `node --test test/cargo-mail-utils.test.js test/cargo-original-doc-utils.test.js`

Expected: FAIL because OBL carrier submission mode is absent.

- [ ] **Step 3: Extend the existing mobile page and mail endpoint**

Add a top-level mode selector for original receipt versus OBL carrier submission. Save the OBL flag/date first through `cargo-quota`; only after a successful save call `cargo-original-doc-receipt-mail` with:

```json
{
  "request_type": "obl_carrier_submission",
  "bl_number": "ONEY...",
  "submitted_date": "2026-07-24",
  "additional_to": []
}
```

If mail fails after the save, display that the submission was saved but the email failed.

- [ ] **Step 4: Run mobile/mail tests and confirm they pass**

Run: `node --test test/cargo-mail-utils.test.js test/cargo-original-doc-utils.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit mobile OBL handling**

```bash
git add cargo-docs-mobile.html api/cargo-original-doc-receipt-mail.js test/cargo-mail-utils.test.js test/cargo-original-doc-utils.test.js
git commit -m "Add mobile OBL carrier submission"
```

### Task 5: Local source lifecycle reconciliation

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/sync_to_supabase.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_sync_account_routing.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_sync_document_refresh.py`
- Modify: `api/cargo-data.js`
- Modify: `cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: complete current account/BL key set from local scanning and Task 2 lifecycle table.
- Produces: idempotent source-missing hide/restore, permanent exclusion, and exclusion-history restore.

- [ ] **Step 1: Write failing Python tests for missing, restored, and tombstoned BLs**

```python
def test_missing_source_is_hidden_without_deleting_history():
    result = reconcile_lifecycle(previous={"A"}, current=set(), tombstones=set())
    assert result["missing"] == {"A"}

def test_returned_source_is_restored_unless_tombstoned():
    result = reconcile_lifecycle(previous={"A"}, current={"A"}, tombstones={"A"})
    assert result["restore"] == set()
    assert result["skip_upload"] == {"A"}
```

- [ ] **Step 2: Run focused Python tests and confirm they fail**

Run: `python -m unittest tests.test_sync_account_routing tests.test_sync_document_refresh -v`

Expected: FAIL because lifecycle reconciliation does not exist.

- [ ] **Step 3: Implement complete-set reconciliation**

Add a pure helper returning `missing`, `restore`, and `skip_upload` sets. During sync:

1. Fetch tombstones for each account.
2. Skip uploads for tombstoned keys.
3. Upsert current cards.
4. Clear `source_missing` for returned keys.
5. Mark previously active absent keys `source_missing=true` and `is_hidden=true`.

Do not delete notes, request rows, document status, or calendar history.

- [ ] **Step 4: Add hidden-view permanent exclusion and restore-history UI**

The administrator hidden view shows `로컬 폴더 없음`, exposes `영구 제외`, and includes an exclusion-history panel with `복구`. Normal views exclude source-missing and permanently excluded rows.

- [ ] **Step 5: Run lifecycle tests and confirm they pass**

Run: `python -m unittest tests.test_sync_account_routing tests.test_sync_document_refresh -v`

Run: `node --test test/dashboard-source.test.js test/cargo-card-merge.test.js`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit website lifecycle changes**

```bash
git add api/cargo-data.js cargo-dashboard.html test/dashboard-source.test.js test/cargo-card-merge.test.js
git commit -m "Add reversible cargo card lifecycle"
```

The local sync files are on the shared operational workspace and are verified separately rather than committed in the homepage repository.

### Task 6: Local dashboard mirror and full verification

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/templates/index.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-docs-mobile.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/cargo-docs-mobile.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_card_ui_state.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_website_progress_features.py`

**Interfaces:**
- Consumes: validated homepage HTML from Tasks 1-5.
- Produces: equivalent local behavior with preserved local-only differences.

- [ ] **Step 1: Add failing local-template tests**

```python
self.assertIn("만기(프리타임)", html)
self.assertIn("OBL 접수일", html)
self.assertIn("스티커요청", html)
self.assertIn("manualEditOpen[bl] = true", html)
```

- [ ] **Step 2: Run local tests and confirm they fail**

Run: `python -m unittest discover -s tests -v`

Expected: FAIL on missing progress-operation controls.

- [ ] **Step 3: Mirror website files and preserve local differences**

Copy the validated dashboard/mobile markup to the integration mirrors. Apply the feature blocks to `templates/index.html` while preserving:

```html
<title>축산물 통관 대시보드</title>
```

and the local details open-state/`ontoggle` behavior.

- [ ] **Step 4: Run all automated tests**

Run in homepage repo: `node --test test/*.test.js`

Expected: all Node tests PASS.

Run in local dashboard: `python -m unittest discover -s tests -v`

Expected: all Python tests PASS.

- [ ] **Step 5: Validate serverless function count and syntax**

Run: `(Get-ChildItem api -Filter *.js).Count`

Expected: `12`.

Run: `node --check api/cargo-data.js; node --check api/cargo-quota.js; node --check api/cargo-card-visibility.js; node --check api/cargo-original-doc-receipt-mail.js`

Expected: exit code 0 for each file.

### Task 7: Database application, sync smoke test, push, and production deployment

**Files:**
- Verify: `supabase/migrations/20260724_add_cargo_progress_operations.sql`
- Verify: all committed homepage changes
- Verify: shared local dashboard files

**Interfaces:**
- Consumes: completed Tasks 1-6 and configured Supabase/Vercel credentials.
- Produces: live production dashboard and operational local sync.

- [ ] **Step 1: Apply the migration with the configured Supabase project**

Use the Supabase SQL Editor if no CLI/database credential is available. Re-running the migration must succeed because all DDL is idempotent.

- [ ] **Step 2: Restart the local server and run one manual sync**

Run:

```powershell
Set-Location "Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard"
powershell -ExecutionPolicy Bypass -File ".\website_integration\run_dashboard_server.ps1"
python ".\website_integration\sync_to_supabase.py"
```

Expected: local API responds, sync uploads current non-tombstoned cards, and lifecycle reconciliation reports no HTTP error.

- [ ] **Step 3: Verify representative BL behavior**

Check one current BL for 3-day expiry, separate ETA/warehouse date, tri-state controls, sticker toggle, OBL submission, and sorting. Temporarily remove/re-add a test folder only if a disposable test BL exists; otherwise verify lifecycle through automated tests.

- [ ] **Step 4: Push the homepage commits**

```bash
git status --short
git push origin main
```

Expected: push succeeds and Vercel starts a production deployment from `main`.

- [ ] **Step 5: Inspect Vercel deployment and live production**

Confirm the deployment is `Ready`, then open `https://www.aincustoms.com/cargo-dashboard.html` and verify the production UI and API responses. If deployment is non-terminal, wait and inspect again; do not report completion while it is still building.

- [ ] **Step 6: Record the final verification**

Report the applied migration, commits, test totals, manual sync result, production deployment URL/status, and any remaining manual operational action.
