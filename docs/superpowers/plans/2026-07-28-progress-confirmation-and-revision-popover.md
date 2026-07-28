# Progress Confirmation And Revision Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators confirm ETA, bonded-area, and warehouse-entry dates with a persistent red visual state, while making the B/L confirmation popover stable and editable.

**Architecture:** Extend the existing `cargo_card_user_inputs` transport record and `/api/cargo-quota` `manual_fields` action instead of adding a new function. Reuse `/api/cargo-revision` for confirmation edits and keep progress-table interaction delegated from `#progressRows`.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js Vercel functions, Supabase PostgREST/PostgreSQL migrations, Node built-in test runner.

## Global Constraints

- Only administrators may confirm or unconfirm transport values.
- `저장` clears confirmation; `확정` saves and confirms; `확정취소` preserves the value and clears confirmation.
- Linked account rows are updated only when normalized B/L and exact `folder_name` match.
- Shipper, destination, and viewer accounts can see confirmation styling but cannot edit it.
- No new Vercel serverless function is added.
- Existing revision write permissions remain authoritative.
- Homepage, local integration copy, and Vercel package copy must have identical SHA-256 values.

---

### Task 1: Persist Transport Confirmation Flags

**Files:**
- Create: `supabase/migrations/20260728_add_transport_confirmation_flags.sql`
- Modify: `api/cargo-data.js`
- Modify: `api/cargo-quota.js`
- Modify: `lib/cargo-card-merge.js`
- Test: `test/progress-request-workflow.test.js`
- Test: `test/cargo-card-merge.test.js`

**Interfaces:**
- Consumes: `manual_fields` requests with optional `confirm_field` and `confirmation_action`.
- Produces: `eta_date_confirmed`, `storage_yard_confirmed`, and `warehouse_expected_date_confirmed` booleans on merged cards.

- [ ] **Step 1: Write failing API and merge tests**

Add tests that post:

```js
{
  action: "manual_fields",
  account_id: "account-a",
  bl_number: "BL-1",
  eta_date: "2026-07-31",
  confirm_field: "eta_date",
  confirmation_action: "confirm"
}
```

Assert an admin save writes `eta_date_confirmed: true` to every exact-folder linked target, a non-admin request returns `403`, normal `eta_date` save writes `eta_date_confirmed: false`, and merge uses the latest transport row's value and confirmation together.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test test/progress-request-workflow.test.js test/cargo-card-merge.test.js
```

Expected: failures because the confirmation columns and request contract are not implemented.

- [ ] **Step 3: Add the additive migration**

Create:

```sql
alter table public.cargo_card_user_inputs
  add column if not exists eta_date_confirmed boolean not null default false,
  add column if not exists storage_yard_confirmed boolean not null default false,
  add column if not exists warehouse_expected_date_confirmed boolean not null default false;
```

- [ ] **Step 4: Extend API reads, writes, and linked propagation**

In `api/cargo-data.js`, include all three columns in primary and fallback selects and merge them as strict booleans.

In `api/cargo-quota.js`, validate:

```js
const CONFIRMABLE_FIELDS = {
  eta_date: "eta_date_confirmed",
  storage_yard: "storage_yard_confirmed",
  warehouse_expected_date: "warehouse_expected_date_confirmed",
};
```

Allow `confirmation_action` values `confirm` and `unconfirm`. Require admin for either action. For a normal field save, set its mapped confirmation flag to `false`. Use `linkedCardTargets(card)` and an upsert array when an admin changes confirmation state; preserve optimistic concurrency for ordinary shipper edits.

- [ ] **Step 5: Keep value and flag atomic during merge**

Add the three flags to `TRANSPORT_FIELDS` in `lib/cargo-card-merge.js` so the newest `transport_updated_at` row contributes both the transport value and its flag.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test test/progress-request-workflow.test.js test/cargo-card-merge.test.js
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```powershell
git add api/cargo-data.js api/cargo-quota.js lib/cargo-card-merge.js test/progress-request-workflow.test.js test/cargo-card-merge.test.js supabase/migrations/20260728_add_transport_confirmation_flags.sql
git commit -m "Add transport confirmation persistence"
```

### Task 2: Add Administrator Confirmation Editors

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: the three `*_confirmed` card booleans from Task 1.
- Produces: `openProgressTransportConfirmation(cardIndex, field)`, `saveProgressTransportConfirmation(action)`, and confirmed-cell CSS.

- [ ] **Step 1: Write failing rendering and interaction tests**

Assert source and rendered row output include:

```html
class="progress-field-confirmed"
data-progress-confirm-field="eta_date"
data-progress-confirm-field="storage_yard"
data-progress-confirm-field="warehouse_expected_date"
```

Assert non-admin rows omit the editable trigger attributes while retaining `progress-field-confirmed`, and confirm requests send `confirm_field` plus `confirmation_action`.

- [ ] **Step 2: Run the dashboard test and verify RED**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: failures because the confirmation editor and styling do not exist.

- [ ] **Step 3: Render compact confirmed states**

Add a class helper:

```js
function progressConfirmedClass(card, field) {
  return card?.[`${field}_confirmed`] === true ? " progress-field-confirmed" : "";
}
```

Apply it to ETA, bonded-area, and warehouse-entry date cells. Add a 1px red border and light red background without changing row height.

- [ ] **Step 4: Add the administrator editor**

Use one fixed-position popover with the correct control type:

```js
const fieldConfig = {
  eta_date: { label: "입항예정일", type: "date" },
  storage_yard: { label: "반입예정구역", type: "text" },
  warehouse_expected_date: { label: "반입예정일", type: "date" },
};
```

Render `저장`, `확정`, and conditional `확정취소` buttons. Save through `/api/cargo-quota` and reopen the same editor after `loadData()` only when the request fails; close it after success.

- [ ] **Step 5: Run the dashboard test and verify GREEN**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: all dashboard source tests pass.

- [ ] **Step 6: Commit**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "Add admin transport confirmation controls"
```

### Task 3: Stabilize And Edit The B/L Confirmation Popover

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `revisionEditModes`, `revisionEditDrafts`, `saveEditRevision`, and `/api/cargo-revision`.
- Produces: delegated progress-popover edit controls and delayed close behavior.

- [ ] **Step 1: Write failing popover tests**

Add tests that assert:

```js
progressRevisionTooltip(card)
```

renders `수정`, edit input, `저장`, and `취소` according to `revisionEditModes`. Add event tests where `pointerout.relatedTarget` is inside the same `.progress-request-wrap`, outside the wrapper, and where `Escape` or outside click closes the active popover.

- [ ] **Step 2: Run the dashboard test and verify RED**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: failures because progress revision rows are read-only and close state is not delayed.

- [ ] **Step 3: Render existing revisions with edit controls**

Extend `progressRevisionControlFromEvent` to return `revisionIndex` and `revision`. Render:

```html
<button data-progress-revision-action="edit">수정</button>
<input data-progress-revision-action="edit-draft">
<button data-progress-revision-action="save">저장</button>
<button data-progress-revision-action="cancel">취소</button>
```

Use `revisionEditModes[id]` and `revisionEditDrafts[id]` so the card and progress views share one draft.

- [ ] **Step 4: Preserve the popover during pointer and focus movement**

Track the active wrapper, add a 120ms close timer, cancel it on `pointerover` or `focusin` anywhere inside the wrapper, and close only after both pointer and focus leave. Add document-level outside-click and `Escape` handlers. Keep the popover open after edit/cancel and reopen it after successful save by remembering `cardStateKey(card)`.

- [ ] **Step 5: Run the dashboard test and verify GREEN**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: all dashboard source tests pass.

- [ ] **Step 6: Commit**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "Fix editable BL confirmation popover"
```

### Task 4: Synchronize Copies, Document, Verify, And Deploy

**Files:**
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/cargo-dashboard.html`
- Modify: matching `website_integration/vercel_package/api` and `lib` files
- Create: matching migration copy if the package maintains migrations

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: matching local/Vercel package artifacts and a deployable `main`.

- [ ] **Step 1: Update change history**

Record the date, three confirmation fields, administrator-only behavior, red styling, linked-account propagation, and editable B/L popover in `docs/CHANGE_REQUEST_HISTORY.md`.

- [ ] **Step 2: Copy exact deployment artifacts**

Use `Copy-Item -LiteralPath` for the HTML, API, library, and migration files. Do not manually retype or partially patch the generated copies.

- [ ] **Step 3: Verify hashes**

Run:

```powershell
Get-FileHash cargo-dashboard.html -Algorithm SHA256
Get-FileHash 'Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html' -Algorithm SHA256
Get-FileHash 'Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_package\cargo-dashboard.html' -Algorithm SHA256
```

Expected: all three hashes are identical.

- [ ] **Step 4: Run the complete test suite**

Run:

```powershell
npm test
git diff --check
```

Expected: every test passes and `git diff --check` prints nothing.

- [ ] **Step 5: Commit and push**

```powershell
git add cargo-dashboard.html api/cargo-data.js api/cargo-quota.js lib/cargo-card-merge.js supabase/migrations docs test
git commit -m "Add progress transport confirmations"
git push origin main
```

- [ ] **Step 6: Verify deployment**

Confirm GitHub commit status reports Vercel success, then request `https://www.aincustoms.com/cargo-dashboard.html` and verify the deployed source contains `eta_date_confirmed` and the editable progress revision action marker.
