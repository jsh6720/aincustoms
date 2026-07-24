# Dashboard Calendar Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the milestone board the default view, add `BL 진행` navigation, persist optional calendar event visibility per account, and provision the `CTF` consignee-filtered shipper account.

**Architecture:** Extend `shipper_accounts` with one JSONB preference object and return its normalized value through login and cargo-data responses. A focused authenticated preferences API owns account-scoped writes, while the existing single-file dashboard renders the board by default and filters optional calendar event groups from the saved setting.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js Vercel functions, Supabase Postgres/PostgREST, Node built-in test runner, Python unittest integration checks.

## Global Constraints

- Existing cargo mutation permissions remain unchanged.
- Viewer accounts may save only their own calendar display preference and remain unable to mutate cargo data.
- `서류요청`, `서류수령`, and `입항예정` are always shown.
- Optional preference keys are exactly `import_request` and `warehouse_expected`.
- Missing preferences normalize to both optional event types enabled.
- `CTF` is a regular active shipper account filtered by `캐틀팜`.
- The homepage source and local dashboard mirror must remain byte-for-byte synchronized.

---

### Task 1: Calendar Preference Contract and API

**Files:**
- Create: `lib/cargo-calendar-preferences.js`
- Create: `api/cargo-calendar-preferences.js`
- Create: `test/calendar-preferences.test.js`
- Modify: `api/cargo-login.js`
- Modify: `api/cargo-data.js`

**Interfaces:**
- Produces: `normalizeCalendarPreferences(value): { import_request: boolean, warehouse_expected: boolean }`
- Produces: `PATCH /api/cargo-calendar-preferences`
- Consumes: authenticated `cargo_session` and Supabase `shipper_accounts.calendar_preferences`

- [ ] **Step 1: Write failing normalization and API tests**

```js
test("calendar preferences default both optional event groups to visible", () => {
  assert.deepEqual(normalizeCalendarPreferences(null), {
    import_request: true,
    warehouse_expected: true,
  });
});

test("calendar preferences reject unsupported or non-boolean values", async () => {
  const response = await invoke({ import_request: "yes", unknown: true });
  assert.equal(response.statusCode, 400);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test test\calendar-preferences.test.js
```

Expected: FAIL because the helper and endpoint do not exist.

- [ ] **Step 3: Implement normalization and account-scoped persistence**

The endpoint must:

```js
const session = verifySession(req);
const preferences = normalizeCalendarPreferences(req.body);
await supabaseFetch(
  `/rest/v1/shipper_accounts?id=eq.${encodeURIComponent(session.account_id)}`,
  {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ calendar_preferences: preferences }),
  }
);
```

It must reject unknown keys and values that are not booleans before calling Supabase.

- [ ] **Step 4: Include normalized preferences in login and cargo-data responses**

Add `calendar_preferences` to the verified login result, signed session payload, and cargo-data user object. If the column is absent, return an error naming the new migration rather than silently discarding the setting.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test test\calendar-preferences.test.js
```

Expected: all calendar preference tests pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/cargo-calendar-preferences.js api/cargo-calendar-preferences.js api/cargo-login.js api/cargo-data.js test/calendar-preferences.test.js
git commit -m "feat: persist calendar display preferences"
```

### Task 2: Dashboard Default View and Calendar Legend

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `result.user.calendar_preferences`
- Produces: `calendarPreferences`, `saveCalendarPreference(key, checked)`, and filtered `progressCalendarEvents()`

- [ ] **Step 1: Write failing source and calendar behavior tests**

Add tests that require:

```js
assert.match(dashboard, /let currentPrimaryView = "board"/);
assert.match(dashboard, />BL 진행<\/button>/);
assert.match(dashboard, /data-calendar-preference="import_request"/);
assert.match(dashboard, /data-calendar-preference="warehouse_expected"/);
```

The calendar harness must prove that base events remain present while optional events disappear when their saved keys are false.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test test\dashboard-source.test.js
```

Expected: FAIL on the old progress default and missing legend controls.

- [ ] **Step 3: Restore board-first navigation**

Set:

```js
let currentPrimaryView = "board";
```

Remove the viewer-only progress forcing and viewer board hiding. Keep viewer edit controls disabled. Rename the toolbar navigation to `BL 진행` and the progress-page return action to `대시보드`.

- [ ] **Step 4: Add compact optional-event legend**

Place two labeled checkboxes in the progress calendar header:

```html
<label><input type="checkbox" data-calendar-preference="import_request"> 수입신고요청</label>
<label><input type="checkbox" data-calendar-preference="warehouse_expected"> 반입예정</label>
```

Show fixed colored labels for the three always-on groups without checkboxes.

- [ ] **Step 5: Filter events and save preference changes**

`progressCalendarEvents()` always emits request, receipt, and ETA events. It emits import-request and warehouse events only when the corresponding preference is true. A failed PATCH restores the previous checkbox state, redraws the calendar, and displays the returned error.

- [ ] **Step 6: Run dashboard tests and verify GREEN**

Run:

```powershell
node --test test\dashboard-source.test.js
```

Expected: all dashboard source and calendar harness tests pass.

- [ ] **Step 7: Commit**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "feat: restore dashboard and add calendar legend"
```

### Task 3: Supabase Migration and CTF Account

**Files:**
- Create: `supabase/migrations/20260724_add_calendar_preferences_and_ctf.sql`
- Modify: `test/calendar-preferences.test.js`

**Interfaces:**
- Produces: `shipper_accounts.calendar_preferences jsonb`
- Produces: updated `verify_shipper_login(text,text)` result including preferences
- Produces: active `CTF` account with `캐틀팜` filter

- [ ] **Step 1: Write failing migration assertions**

Tests must require:

```js
assert.match(sql, /calendar_preferences jsonb/);
assert.match(sql, /'CTF'/);
assert.match(sql, /'캐틀팜'/);
assert.match(sql, /extensions\.crypt\('ctf1234'/);
```

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```powershell
node --test test\calendar-preferences.test.js
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement idempotent migration**

The migration must:

- Add the JSONB column with both optional flags true by default.
- Drop and recreate `verify_shipper_login(text,text)` with the additional return field.
- Upsert `CTF` case-insensitively by the existing unique login ID rule.
- Hash `ctf1234` with `extensions.crypt(..., extensions.gen_salt('bf'))`.
- Set display name and consignee filter to `캐틀팜`, role to `shipper`, and active to true.

- [ ] **Step 4: Run migration tests and verify GREEN**

Run:

```powershell
node --test test\calendar-preferences.test.js
```

Expected: all migration assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260724_add_calendar_preferences_and_ctf.sql test/calendar-preferences.test.js
git commit -m "feat: add CTF account and calendar preference schema"
```

### Task 4: Local Mirror, Full Verification, and Deployment

**Files:**
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\tests\test_website_progress_features.py`

**Interfaces:**
- Consumes: final homepage dashboard source
- Produces: byte-identical local mirror and production deployment

- [ ] **Step 1: Add a failing local mirror integration assertion**

The Python test must assert the local mirror contains the board default, `BL 진행`, and both calendar preference keys.

- [ ] **Step 2: Run the focused Python test and verify RED**

Run:

```powershell
python -m unittest hyundai_dashboard.tests.test_website_progress_features
```

from `Y:\3. Automation\15. Hyundai corp dashboard`.

- [ ] **Step 3: Copy the verified dashboard source to the local mirror**

Use a byte-preserving copy after the homepage source tests pass.

- [ ] **Step 4: Run all automated checks**

Run:

```powershell
node --test test\*.test.js
python -m unittest discover -s hyundai_dashboard\tests -p "test_*.py"
```

Expected: zero failures.

- [ ] **Step 5: Apply Supabase migration and deploy**

Run the exact migration in the connected Supabase SQL editor, push `main`, and confirm the resulting Vercel production deployment reaches `Ready`.

- [ ] **Step 6: Verify production behavior**

Verify:

- Existing accounts open on the milestone board.
- `BL 진행` opens the progress table.
- Calendar optional selections persist after reload.
- `CTF / ctf1234` logs in and every visible cargo item contains the `캐틀팜` filter.
- CTF cannot access administrator controls.
- Viewer remains read-only while seeing the milestone board.

- [ ] **Step 7: Record rollback point**

Report the production commit SHA and live URL in the final response.
