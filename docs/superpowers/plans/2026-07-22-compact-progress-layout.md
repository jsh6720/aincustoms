# Compact Progress Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten compact dashboard cards, shorten progress-table shipper and destination labels, and allow ETA editing from the progress editor.

**Architecture:** Keep the existing single-page dashboard and `/api/cargo-quota` flow. Add presentation-only helper functions for progress-table labels, extend the current progress modal with ETA, and adjust CSS grid sizing without introducing a new endpoint or schema.

**Tech Stack:** Static HTML/CSS/JavaScript, Vercel Node API, Node test runner, Python unittest integration tests.

## Global Constraints

- Preserve all existing dashboard fields and card expansion behavior.
- Keep B/L values complete and on one line.
- Display progress-table shipper and destination values on one line.
- Reuse the existing manual-fields save API and email rules.
- Mirror the website HTML into the local integration directory.

---

### Task 1: Define the display and ETA editor contract

**Files:**
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `cargo-dashboard.html` as source text.
- Produces: regression assertions for compact grid sizing, `progressConsignee`, `progressDestination`, `progressEtaDate`, and `eta_date` in the progress save payload.

- [ ] **Step 1: Write failing source tests**

Add assertions that require content-aware compact B/L sizing, four-character shipper output, first-underscore destination output, an ETA date input, and `eta_date` in the existing progress payload.

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test test/dashboard-source.test.js`

Expected: FAIL because the new helpers and ETA editor input do not exist.

### Task 2: Implement compact layout and progress editing

**Files:**
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Produces: `progressConsignee(value) -> string`, `progressDestination(value) -> string`, and an extended progress editor payload containing `eta_date`.

- [ ] **Step 1: Tighten compact card CSS**

Use a content-aware B/L track, reduce column gaps, and retain one-line overflow behavior for B/L and summary values.

- [ ] **Step 2: Add progress display helpers**

Normalize the shipper with `displayConsignee`, slice its first four characters, and split destination text at the first underscore.

- [ ] **Step 3: Extend the progress editor**

Add an `입항예정일` date input, preload it from `etaText(card)`, and submit it as `eta_date` with the existing warehouse fields.

- [ ] **Step 4: Verify the focused tests pass**

Run: `node --test test/dashboard-source.test.js`

Expected: PASS.

### Task 3: Mirror, verify, and deploy

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`

**Interfaces:**
- Consumes: verified website dashboard HTML.
- Produces: matching local dashboard behavior and deployed Vercel page.

- [ ] **Step 1: Mirror the verified HTML**

Copy the completed website dashboard HTML into the local integration path without changing encoding.

- [ ] **Step 2: Run complete verification**

Run: `node --test test/*.test.js`

Run from `Y:/3. Automation/15. Hyundai corp dashboard`: `python -m unittest discover -s hyundai_dashboard/tests -v`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Commit and push**

Commit the scoped files on `main`, push `origin/main`, and confirm the working tree is clean.

- [ ] **Step 4: Verify production**

Fetch `https://www.aincustoms.com/cargo-dashboard.html` with a cache-busting query and confirm the ETA editor and progress label helpers are present.
