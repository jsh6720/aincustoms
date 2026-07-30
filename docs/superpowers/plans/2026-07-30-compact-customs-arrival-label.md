# Compact Customs Arrival Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Customs arrival dates within the fixed-width progress column while preserving source and confirmation information.

**Architecture:** Keep the date resolver and automatic confirmation logic unchanged. Change the display helper to return only the date, and add a dedicated title helper used by the progress-table button.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, Vercel

## Global Constraints

- Do not change cargo data, Supabase columns, sorting, confirmation rules, or calendar dates.
- Customs actual arrival dates keep the existing confirmed border.
- The hover description is `관세청 실제입항일 · 자동 확정`.

---

### Task 1: Compact Customs Arrival Presentation

**Files:**
- Modify: `test/dashboard-source.test.js`
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: `etaText(card)` and `calendarDate(card.entry_date)`
- Produces: `etaDisplayText(card): string` and `etaDisplayTitle(card): string`

- [ ] **Step 1: Write the failing test**

Update the Customs arrival display test to expect `2026-07-23` from
`etaDisplayText(card)` and `관세청 실제입항일 · 자동 확정` from
`etaDisplayTitle(card)`. Assert that the progress-table date button renders
the title helper.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
node --test --test-name-pattern "Customs arrival is displayed" test/dashboard-source.test.js
```

Expected: FAIL because `etaDisplayText(card)` still includes `(관세청)` and
`etaDisplayTitle(card)` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Make `etaDisplayText(card)` return `displayDate(etaText(card))`. Add:

```js
function etaDisplayTitle(card) {
  return calendarDate(card.entry_date)
    ? "관세청 실제입항일 · 자동 확정"
    : "";
}
```

Set the progress-table ETA button title from `etaDisplayTitle(card)`.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test --test-name-pattern "Customs arrival is displayed" test/dashboard-source.test.js
node --test test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit and deploy**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "fix: compact Customs arrival dates"
git push origin main
```

Verify the production page renders date-only text, the confirmed class, and
the Customs hover title.
