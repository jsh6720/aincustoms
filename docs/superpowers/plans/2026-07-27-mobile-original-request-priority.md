# Mobile Original Request Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show shipper-requested B/L cards prominently at the top of the mobile original-document manager.

**Architecture:** Add pure request-state and comparison helpers inside the existing mobile page. Render a compact badge from the same helpers and sort the filtered card list before assigning it to the live `visible` array.

**Tech Stack:** Static HTML, browser JavaScript, Node.js built-in test runner.

## Global Constraints

- Reuse the existing `/api/cargo-data` response.
- Do not add database columns or API routes.
- Keep homepage and local Vercel package copies identical.

---

### Task 1: Request priority and status rendering

**Files:**
- Modify: `cargo-docs-mobile.html`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Produces: `mobileOriginalRequestRank(card) -> number`
- Produces: `mobileOriginalRequestSort(left, right) -> number`
- Produces: `mobileOriginalRequestBadge(card) -> string`

- [ ] **Step 1: Write failing tests for requested-card ordering and badges**
- [ ] **Step 2: Run the focused test and confirm failure**
- [ ] **Step 3: Implement request ranking, sorting, and compact badges**
- [ ] **Step 4: Run focused and full Node tests**
- [ ] **Step 5: Mirror the mobile HTML into the local Vercel package**
- [ ] **Step 6: Update change history, commit, push, and verify Vercel**
