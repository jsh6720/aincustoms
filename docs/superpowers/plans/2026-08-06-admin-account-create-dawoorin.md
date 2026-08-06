# Admin Account Creation and Dawoorin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new-account creation obvious in administrator settings and add the Dawoorin destination account with its default email.

**Architecture:** Reuse the existing administrator form, `/api/cargo-admin`, and `admin_upsert_shipper_account` RPC. Add a focused UI entry point that resets and focuses the form, plus an idempotent Supabase migration that creates or updates the Dawoorin account without changing unrelated rows.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js `node:test`, Vercel serverless functions, Supabase PostgreSQL.

## Global Constraints

- Preserve all existing accounts, cargo cards, and mail settings.
- Never return or display stored passwords in plaintext.
- Dawoorin settings are `DWR`, `dwr1234`, `shipper`, `destination`, `다우린`, `다우린`, `ocm3800@hyundaicorp.com`, active.
- Reuse the existing company-name mail recipient matching logic.

---

### Task 1: Administrator account-create entry point

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/mail-settings-and-obl-input.test.js`

**Interfaces:**
- Consumes: existing `resetAdminForm()` and `adminLoginId` input.
- Produces: `startAdminAccountCreate()` with no arguments; resets the form, scrolls it into view, and focuses the login ID field.

- [ ] **Step 1: Write the failing UI contract test**

Add assertions that the dashboard contains a toolbar button calling `startAdminAccountCreate()`, and that the function calls `resetAdminForm()`, `scrollIntoView`, and `focus()`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/mail-settings-and-obl-input.test.js`

Expected: FAIL because `startAdminAccountCreate` and the toolbar button do not exist.

- [ ] **Step 3: Implement the minimal UI behavior**

Add `id="adminAccountForm"` to the existing form, add a `+ 계정 추가` toolbar button, and implement:

```js
function startAdminAccountCreate() {
  resetAdminForm();
  document.getElementById("adminAccountForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("adminLoginId")?.focus();
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/mail-settings-and-obl-input.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit the UI change**

```powershell
git add -- cargo-dashboard.html test/mail-settings-and-obl-input.test.js
git commit -m "Expose administrator account creation"
```

### Task 2: Idempotent Dawoorin destination account

**Files:**
- Create: `supabase/migrations/20260806_add_dawoorin_account.sql`
- Create: `test/dawoorin-account.test.js`

**Interfaces:**
- Consumes: `public.shipper_accounts`, `extensions.crypt`, and `extensions.gen_salt` already used by account migrations.
- Produces: one active `DWR` account with destination category and Dawoorin default email.

- [ ] **Step 1: Write the failing migration contract test**

Create a Node test that reads the migration and asserts the presence of the login ID, password hash generation, display/filter values, destination category, default email, active state, and a case-insensitive existing-account lookup.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/dawoorin-account.test.js`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Implement the idempotent migration**

Use a `DO $$` block to find `lower(login_id) = lower('DWR')`. Insert when missing; otherwise update the same row. Hash `dwr1234` with `extensions.crypt(..., extensions.gen_salt('bf'))` and set the approved account fields without touching unrelated accounts.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/dawoorin-account.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit the account migration**

```powershell
git add -- supabase/migrations/20260806_add_dawoorin_account.sql test/dawoorin-account.test.js
git commit -m "Add Dawoorin destination account"
```

### Task 3: Mail matching regression, history, and deployment

**Files:**
- Modify: `test/mail-settings-and-obl-input.test.js`
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`

**Interfaces:**
- Consumes: existing `resolveCardCompanyRecipients()` behavior in `lib/cargo-mail-settings.js`.
- Produces: regression evidence that `다우린` resolves `ocm3800@hyundaicorp.com` as a recipient.

- [ ] **Step 1: Add the Dawoorin recipient regression test**

Use an active account fixture with `display_name: "다우린"`, `consignee_filter: "다우린"`, `account_category: "destination"`, and `release_request_to: "ocm3800@hyundaicorp.com"`; assert that a card with destination `다우린` resolves that address.

- [ ] **Step 2: Run the focused tests**

Run: `node --test test/mail-settings-and-obl-input.test.js test/dawoorin-account.test.js`

Expected: all tests pass.

- [ ] **Step 3: Record the behavior in change history**

Add a dated entry documenting the visible account-create action, Dawoorin account fields, and company-name email matching.

- [ ] **Step 4: Run the full web test suite**

Run: `node --test test/*.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit, push, and verify production deployment**

```powershell
git add -- docs/CHANGE_REQUEST_HISTORY.md test/mail-settings-and-obl-input.test.js
git commit -m "Verify Dawoorin account mail routing"
git push origin main
```

Confirm the pushed commit is the remote `main` head and verify the production dashboard serves the new `+ 계정 추가` text. Apply the Supabase migration through the configured deployment route or report the exact remaining SQL action if direct database execution is unavailable.
