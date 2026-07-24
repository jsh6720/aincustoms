# Document Delivery Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-managed `삼현전달` and `창고전달` O/X statuses beside the progress state, and classify transport-entry provenance as `관리자(AIN)`, `화주`, or `납품처`.

**Architecture:** Extend `cargo_card_user_inputs` and the existing `/api/cargo-quota` `admin_status` action instead of adding an endpoint. Store account classification on `shipper_accounts`, preserve that classification in `transport_updated_by_role`, and merge document-delivery state across cards sharing the normalized BL and exact source folder.

**Tech Stack:** Vercel Node.js functions, Supabase/Postgres REST, vanilla HTML/CSS/JavaScript, Python Flask local dashboard and sync script, Node `node:test`, Python `unittest`.

## Global Constraints

- `서류전달` must appear immediately to the right of `진행상태`.
- Only administrators can change `삼현전달` and `창고전달`; other accounts can only read them.
- Existing cards default both values to X.
- Linked HCH/CTF cards must show the same delivery state.
- Transport provenance must show `관리자(AIN)`, `화주`, or `납품처`; CTF is `납품처`.
- Homepage source, local integration copy, Vercel package copy, and local template must stay behaviorally aligned.

---

### Task 1: Database Contract And Account Category

**Files:**
- Create: `supabase/migrations/20260724_add_document_delivery_status.sql`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Produces: `cargo_card_user_inputs.docs_delivered_samhyeon boolean`
- Produces: `cargo_card_user_inputs.docs_delivered_warehouse boolean`
- Produces: `shipper_accounts.account_category text`
- Produces: `verify_shipper_login(...).account_category`

- [ ] **Step 1: Write the failing migration contract test**

```js
test("migration adds delivery status and account category", () => {
  assert.match(migration, /docs_delivered_samhyeon\s+boolean/i);
  assert.match(migration, /docs_delivered_warehouse\s+boolean/i);
  assert.match(migration, /account_category\s+text/i);
  assert.match(migration, /where\s+lower\(login_id\)\s*=\s*lower\('CTF'\)/i);
  assert.match(migration, /account_category\s*=\s*'destination'/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/document-delivery-status.test.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the migration**

```sql
alter table public.cargo_card_user_inputs
  add column if not exists docs_delivered_samhyeon boolean not null default false,
  add column if not exists docs_delivered_warehouse boolean not null default false;

alter table public.shipper_accounts
  add column if not exists account_category text not null default 'shipper';

alter table public.shipper_accounts
  add constraint shipper_accounts_account_category_check
  check (account_category in ('shipper', 'destination'));

update public.shipper_accounts
set account_category = 'destination'
where lower(login_id) = lower('CTF');
```

Drop and recreate `verify_shipper_login(text, text)` with `account_category` in its return table.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test test/document-delivery-status.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260724_add_document_delivery_status.sql test/document-delivery-status.test.js
git commit -m "Add document delivery status schema"
```

### Task 2: Linked Delivery State And Save API

**Files:**
- Modify: `lib/cargo-linked-records.js`
- Modify: `lib/cargo-card-merge.js`
- Modify: `api/cargo-data.js`
- Modify: `api/cargo-quota.js`
- Test: `test/cargo-linked-records.test.js`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Produces: `mergeLinkedDeliveryStatus(card, cardRefs, inputs)`
- Consumes: `docs_delivered_samhyeon`, `docs_delivered_warehouse`

- [ ] **Step 1: Write failing linked-state and API tests**

```js
test("linked accounts share document delivery status", () => {
  const merged = mergeLinkedDeliveryStatus(hchCard, refs, [
    { account_id: "ctf", bl_number: "BL1", docs_delivered_samhyeon: true }
  ]);
  assert.equal(merged.docs_delivered_samhyeon, true);
  assert.equal(merged.docs_delivered_warehouse, false);
});
```

The API test must assert that `admin_status` accepts both booleans and upserts each linked account target.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/cargo-linked-records.test.js test/document-delivery-status.test.js`

Expected: FAIL because the helper and API fields are missing.

- [ ] **Step 3: Implement minimal linked merge and save**

Add both fields to the full Supabase select, fallback detection, card merge fields, and `applyUserInputs`. In `admin_status`, validate strict booleans and resolve linked targets by normalized BL plus exact `folder_name` before upserting.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/cargo-linked-records.test.js test/document-delivery-status.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cargo-linked-records.js lib/cargo-card-merge.js api/cargo-data.js api/cargo-quota.js test
git commit -m "Store linked document delivery status"
```

### Task 3: Account Category And Provenance

**Files:**
- Modify: `api/cargo-login.js`
- Modify: `api/cargo-admin.js`
- Modify: `api/cargo-quota.js`
- Modify: `cargo-dashboard.html`
- Test: `test/document-delivery-status.test.js`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Session field: `account_category: "shipper" | "destination"`
- Stored provenance: `transport_updated_by_role: "admin" | "shipper" | "destination"`

- [ ] **Step 1: Write failing provenance tests**

```js
assert.equal(provenanceLabel("admin"), "관리자(AIN)");
assert.equal(provenanceLabel("shipper"), "화주");
assert.equal(provenanceLabel("destination"), "납품처");
assert.match(loginApi, /account_category/);
assert.match(quotaApi, /session\.account_category/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/document-delivery-status.test.js test/dashboard-source.test.js`

Expected: FAIL because account category is not present.

- [ ] **Step 3: Implement login, admin settings, and provenance display**

Return `account_category` from login and cargo-data user payloads. Save it through the account-management API. Add a `계정구분` selector (`화주`, `납품처`) to administrator settings. Map saved transport roles to the three Korean labels in title and hover popup.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/document-delivery-status.test.js test/dashboard-source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/cargo-login.js api/cargo-admin.js api/cargo-quota.js cargo-dashboard.html test
git commit -m "Classify cargo input provenance"
```

### Task 4: Progress Table Controls

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/dashboard-source.test.js`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Produces: `progressDeliveryStatus(card)`
- Produces: `toggleProgressDeliveryStatus(cardIndex, target)`

- [ ] **Step 1: Write failing markup and behavior tests**

Assert that `서류전달` follows `진행상태`, contains `삼현전달` and `창고전달`, asks for confirmation, posts `admin_status`, and renders non-admin values without clickable controls.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/dashboard-source.test.js test/document-delivery-status.test.js`

Expected: FAIL because the column and controls are absent.

- [ ] **Step 3: Add compact two-toggle cell**

Render two compact labels and O/X controls in one cell. Use the established `doc-o`, `doc-x`, and confirmation flow. Recalculate empty-table colspans for admin and non-admin views.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/dashboard-source.test.js test/document-delivery-status.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cargo-dashboard.html test
git commit -m "Add document delivery controls to progress table"
```

### Task 5: Local Dashboard And Sync Mirrors

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/sync_to_supabase.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/templates/index.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-data.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-login.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-admin.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-quota.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-card-merge.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-linked-records.js`
- Test: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_website_progress_features.py`

**Interfaces:**
- Consumes the same Supabase columns and browser functions as Tasks 1-4.

- [ ] **Step 1: Write failing local mirror tests**

Assert that both new columns are read by sync, local HTML exposes the two controls, and website/Vercel copies contain the same API fields and provenance labels.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m unittest discover -s tests -p "test_*.py"`

Expected: FAIL on missing delivery-state fields.

- [ ] **Step 3: Update local sync and copy verified homepage files**

Add the two columns to Supabase pulls and local card payloads. Copy the verified homepage HTML/API/lib files into the integration and Vercel package mirrors, then apply the equivalent compact control to the local template.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `python -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

### Task 6: Regression, Database Apply, Push, And Deployment

**Files:**
- Verify all modified files.

**Interfaces:**
- Produces a deployed homepage and a restart-ready local dashboard.

- [ ] **Step 1: Run full regression**

Run: `node --test`

Expected: all Node tests pass.

Run: `python -m unittest discover -s tests -p "test_*.py"`

Expected: all local tests pass.

- [ ] **Step 2: Verify source consistency**

Run byte or normalized-text comparisons for homepage HTML/API/lib files and their local integration/Vercel package copies.

Expected: no unintended differences.

- [ ] **Step 3: Apply the Supabase migration**

Execute `20260724_add_document_delivery_status.sql` in the project SQL editor and verify both delivery columns, `account_category`, and CTF=`destination`.

- [ ] **Step 4: Commit and push**

```bash
git add .
git commit -m "Add cargo document delivery tracking"
git push origin main
```

- [ ] **Step 5: Verify Vercel production**

Wait for the deployment to reach Ready, then sign in as administrator and CTF. Confirm the new column, linked status, administrator-only editing, and `납품처` provenance popup.
