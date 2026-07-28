# Original Document Re-request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable original-document requests for any cargo with a missing OBL or H/C and preload the latest request for editing and re-requesting.

**Architecture:** Introduce one pure missing-original predicate in the dashboard and mirror the same boolean rule in the request API. Use the latest request already returned by `/api/cargo-data` to populate the existing modal, while preserving request history by continuing to insert a new request row.

**Tech Stack:** Static HTML, browser JavaScript, Vercel Node.js functions, Supabase REST, Node.js built-in test runner.

## Global Constraints

- OBL or H/C missing enables the request regardless of milestone.
- Both OBL and H/C received disables the request.
- Re-request inserts a new history row.
- Keep homepage and local package HTML copies synchronized.
- Do not add database columns or API routes.

---

### Task 1: Request eligibility

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `api/cargo-original-doc-request.js`
- Test: `test/dashboard-source.test.js`
- Test: `test/progress-request-workflow.test.js`

**Interfaces:**
- Produces: `canRequestOriginalDocuments(card) -> boolean`
- Consumes: `card.obl_received`, `card.hc_received`

- [ ] **Step 1: Write failing tests for post-inbound missing originals and fully received restriction**
- [ ] **Step 2: Run focused tests and confirm the old stage rule fails**
- [ ] **Step 3: Implement the shared frontend predicate and equivalent API validation**
- [ ] **Step 4: Run focused tests and confirm they pass**

### Task 2: Existing request preload

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `card.last_original_doc_request`
- Populates: requester, email, requested receipt date, memo

- [ ] **Step 1: Write a failing source test for latest request modal defaults**
- [ ] **Step 2: Run the focused test and confirm failure**
- [ ] **Step 3: Populate the modal from the latest original-document request**
- [ ] **Step 4: Run the focused test and confirm it passes**

### Task 3: Copies, history, and deployment

**Files:**
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`
- Modify: local `website_integration/cargo-dashboard.html`
- Modify: local `website_integration/vercel_package/cargo-dashboard.html`

**Interfaces:**
- Produces identical dashboard HTML behavior in homepage and local package copies.

- [ ] **Step 1: Mirror the verified dashboard HTML into both local copies**
- [ ] **Step 2: Record the eligibility and re-request rules in change history**
- [ ] **Step 3: Run `git diff --check` and the full `node --test` suite**
- [ ] **Step 4: Commit, push, and verify the Vercel production deployment**
