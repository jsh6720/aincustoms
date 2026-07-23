# All-Cargo Viewer Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `viewer` role and create `guest` so it can see every shipper's cargo without receiving administrator or shipper write capabilities.

**Architecture:** The session keeps the database role unchanged. `cargo-data` treats `admin` and `viewer` as all-account readers, while a shared authorization helper rejects viewer writes before mutation handlers run. The dashboard renders viewer as a read-only shipper-style progress table.

**Tech Stack:** Vercel Node.js functions, Supabase/PostgreSQL, vanilla HTML/CSS/JavaScript, Node test runner.

## Global Constraints

- Existing `admin` and `shipper` behavior must remain unchanged.
- `viewer` can read all cargo and calendar data but cannot mutate any cargo or account data.
- `guest` uses no consignee filter and must not expose administrator controls.
- The database migration must be idempotent.

---

### Task 1: Viewer authorization and all-cargo query

**Files:**
- Modify: `lib/cargo-auth.js`
- Modify: `api/cargo-data.js`
- Test: `test/viewer-account.test.js`

**Interfaces:**
- Produces: `requireWritableSession(req, res)` returning a session or `null`
- Produces: `canReadAllCargo(role)` returning a boolean

- [ ] **Step 1: Write failing tests**

Add tests proving `viewer` is an all-cargo reader and `requireWritableSession` returns HTTP 403 for viewer sessions.

- [ ] **Step 2: Verify RED**

Run: `node --test test/viewer-account.test.js`

Expected: FAIL because viewer helpers and all-cargo behavior do not exist.

- [ ] **Step 3: Implement minimal authorization**

Add `canReadAllCargo` and `requireWritableSession` to `lib/cargo-auth.js`. Use `canReadAllCargo` in `api/cargo-data.js` to choose the unfiltered query for `admin` and `viewer`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/viewer-account.test.js`

Expected: PASS.

### Task 2: Block viewer mutation APIs

**Files:**
- Modify: `api/cargo-quota.js`
- Modify: `api/cargo-import-request.js`
- Modify: `api/cargo-original-doc-request.js`
- Modify: `api/cargo-original-docs.js`
- Modify: `api/cargo-release-request.js`
- Modify: `api/cargo-revision.js`
- Test: `test/viewer-account.test.js`

**Interfaces:**
- Consumes: `requireWritableSession(req, res)` from Task 1

- [ ] **Step 1: Extend the failing test**

Assert each shipper-writable API imports and uses `requireWritableSession`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/viewer-account.test.js`

Expected: FAIL listing mutation handlers that still accept viewer sessions.

- [ ] **Step 3: Replace mutation authentication**

Use `requireWritableSession` in every shipper-writable handler. Keep existing admin-only checks unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/viewer-account.test.js`

Expected: PASS.

### Task 3: Viewer account management and read-only UI

**Files:**
- Modify: `api/cargo-admin.js`
- Modify: `cargo-dashboard.html`
- Test: `test/viewer-account.test.js`

**Interfaces:**
- Produces: `currentUserRole === "viewer"` read-only rendering
- Produces: administrator role option value `viewer`

- [ ] **Step 1: Extend the failing test**

Assert the account API preserves `viewer`, only shipper requires a filter, and the dashboard hides all mutation controls for viewer.

- [ ] **Step 2: Verify RED**

Run: `node --test test/viewer-account.test.js`

Expected: FAIL because account and UI role handling only know admin and shipper.

- [ ] **Step 3: Implement viewer UI and account validation**

Add `viewer` to the role selector and API payload normalization. Render the progress table for viewer while suppressing request, edit, revision, quota, original-document, release, and administrator controls.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/viewer-account.test.js`

Expected: PASS.

### Task 4: Database migration and guest account

**Files:**
- Create: `supabase/migrations/20260724_add_all_cargo_viewer.sql`

**Interfaces:**
- Produces: role constraint accepting `viewer`
- Produces: `admin_upsert_shipper_account` preserving `viewer`
- Produces: active login `guest`

- [ ] **Step 1: Write migration assertions**

Extend `test/viewer-account.test.js` to assert the migration adds `viewer`, updates the RPC role normalization, and upserts `guest`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/viewer-account.test.js`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Add idempotent migration**

Drop and recreate the role check, update the RPC to accept `viewer`, and upsert `guest` with a pgcrypto password hash.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/viewer-account.test.js`

Expected: PASS.

### Task 5: Regression, deployment, and live verification

**Files:**
- Mirror: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`

**Interfaces:**
- Consumes: all prior tasks

- [ ] **Step 1: Run full tests**

Run: `node --test test/*.test.js`

Expected: all tests pass.

- [ ] **Step 2: Verify syntax and mirror**

Run `node --check` against the inline dashboard script and compare SHA-256 hashes for the homepage and local mirror.

- [ ] **Step 3: Commit and push**

Commit the feature, fast-forward `main`, and push `origin/main`.

- [ ] **Step 4: Apply Supabase migration**

Run `20260724_add_all_cargo_viewer.sql` in the production Supabase SQL editor and confirm success.

- [ ] **Step 5: Verify production**

Confirm Vercel production is Ready, log in as `guest`, verify all cargo rows are visible, and verify no write controls or administrator controls are present.

