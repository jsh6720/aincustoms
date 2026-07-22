# Progress Table Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact and align the B/L progress table while marking transfer-document receipt events distinctly in the calendar.

**Architecture:** Keep the existing single-page dashboard and data model. Add semantic CSS classes to the schedule and descriptive columns, adjust the fixed table widths and alignment rules, and derive the calendar label from the existing `doc_transfer_received` flag.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, Python unittest integration checks, Git/Vercel deployment.

## Global Constraints

- Keep every existing progress column and behavior.
- Do not add an API route, database field, or migration.
- Keep long warehouse and progress-state text left-aligned.
- Keep the website and local integration HTML byte-identical.

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: the rendered source contract in `cargo-dashboard.html`.
- Produces: assertions for `.progress-date`, centered short cells, long-text classes, and the transfer calendar suffix.

- [ ] **Step 1: Write the failing tests**

Add assertions that require date cells to use a non-wrapping class, short cells to use centered classes, long text to keep an explicit left-aligned class, and calendar text to include `${card.doc_transfer_received ? " (양도증)" : ""}`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/dashboard-source.test.js`

Expected: FAIL because the new classes and transfer suffix are not present.

---

### Task 2: Compact and Align the Progress Table

**Files:**
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: existing `renderProgressStatus()` row data.
- Produces: semantic classes `.progress-date`, `.progress-short`, and `.progress-long` used by the table CSS.

- [ ] **Step 1: Add minimal CSS**

Set explicit widths for compact columns, apply `text-align:center` and `vertical-align:middle` to short values, give date columns enough width with smaller non-wrapping text, and retain left alignment for warehouse and state text.

- [ ] **Step 2: Apply semantic classes to headers and cells**

Add the same column classes to matching `<th>` and `<td>` elements so header and body alignment share one rule.

- [ ] **Step 3: Run the focused test**

Run: `node --test test/dashboard-source.test.js`

Expected: calendar suffix assertion still fails while layout assertions pass.

---

### Task 3: Distinguish Transfer Receipt Events

**Files:**
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: `card.doc_transfer_received` and the existing effective receipt date.
- Produces: `서류수령 B/L (양도증)` only when transfer receipt is true.

- [ ] **Step 1: Update the calendar event label**

Build the receipt event text with the existing label plus ` (양도증)` when `card.doc_transfer_received` is true.

- [ ] **Step 2: Run the focused test**

Run: `node --test test/dashboard-source.test.js`

Expected: PASS.

---

### Task 4: Synchronize, Verify, and Deploy

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`

**Interfaces:**
- Consumes: verified homepage HTML.
- Produces: identical local and deployed dashboard files.

- [ ] **Step 1: Copy the verified HTML to the local integration**

Use `Copy-Item` and compare SHA-256 hashes.

- [ ] **Step 2: Run all tests**

Run: `node --test test/*.test.js`

Run: `python -m unittest discover -s hyundai_dashboard/tests -v`

Expected: all Node and Python tests pass with zero failures.

- [ ] **Step 3: Commit and push**

Commit the test, HTML, plan, and synchronized behavior with a focused message, then push `main`.

- [ ] **Step 4: Verify production**

Open `https://www.aincustoms.com/cargo-dashboard.html`, confirm the schedule dates remain on one line, header/body alignment matches, and a transfer receipt event displays `(양도증)`.
