# Customs Arrival Date Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관세청 실제 입항일을 수기 입항예정일보다 우선 표시하고 `(관세청)` 출처 및 자동 확정 상태를 제공하면서 수기 편집값은 보존한다.

**Architecture:** 관세청 실제 입항일의 유효성 및 자동 확정 판정은 공용 진행 유틸리티에서 처리하고 `cargo-data` 응답에 병합한다. 브라우저에서는 표시용 날짜, 편집용 날짜, 출처가 붙은 표시 문자열을 별도 함수로 분리해 표·카드·캘린더가 각자 필요한 형태를 사용한다.

**Tech Stack:** Node.js, Vercel Serverless Functions, vanilla JavaScript/HTML, Node test runner

## Global Constraints

- 관세청 실제 입항일(`entry_date`)이 있으면 `YYYY-MM-DD (관세청)`으로 표시한다.
- 실제 입항일이 없으면 수기 입항예정일(`eta_date`)과 기존 최초 입항일 대체값 순으로 표시한다.
- 실제 입항일이 있으면 입항일은 자동 확정 상태로 판정한다.
- 수기 입항예정일과 수기 확정값은 삭제하거나 덮어쓰지 않는다.
- 캘린더 이벤트에는 `(관세청)` 문구를 붙이지 않는다.
- Supabase 컬럼 추가나 데이터 마이그레이션은 하지 않는다.

---

### Task 1: 관세청 실제 입항일 자동 확정

**Files:**
- Modify: `lib/cargo-progress-utils.js`
- Modify: `api/cargo-data.js`
- Test: `test/cargo-progress-utils.test.js`

**Interfaces:**
- Produces: `customsArrivalConfirmed(card: object): boolean`
- Consumes: `entry_date` in compact `YYYYMMDD` or ISO `YYYY-MM-DD` form

- [ ] **Step 1: Write the failing utility test**

```js
const {
  customsArrivalConfirmed,
  effectiveArrivalDate,
} = require("../lib/cargo-progress-utils");

test("Customs entry date automatically confirms the arrival date", () => {
  assert.equal(customsArrivalConfirmed({ entry_date: "20260801" }), true);
  assert.equal(customsArrivalConfirmed({ entry_date: "2026-08-01" }), true);
  assert.equal(customsArrivalConfirmed({ entry_date: "", eta_date: "2026-07-31" }), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/cargo-progress-utils.test.js`

Expected: FAIL because `customsArrivalConfirmed` is not exported.

- [ ] **Step 3: Implement the pure confirmation helper**

```js
function customsArrivalConfirmed(card) {
  return Boolean(isoDate(card?.entry_date));
}

module.exports = {
  customsArrivalConfirmed,
  // existing exports remain unchanged
};
```

- [ ] **Step 4: Apply the helper to the cargo-data response**

```js
const { customsArrivalConfirmed } = require("../lib/cargo-progress-utils");

eta_date_confirmed:
  customsArrivalConfirmed(card) || input.eta_date_confirmed === true,
```

This derives automatic confirmation at read time without modifying stored manual values.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `node --test test/cargo-progress-utils.test.js test/cargo-card-merge.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the automatic confirmation change**

```powershell
git add lib/cargo-progress-utils.js api/cargo-data.js test/cargo-progress-utils.test.js
git commit -m "feat: auto-confirm Customs arrival dates"
```

### Task 2: 관세청 출처 표시와 수기 편집값 보존

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Produces: `etaText(card): string`
- Produces: `etaDisplayText(card): string`
- Produces: `editableEtaText(card): string`
- Produces: `progressFieldConfirmed(card, field): boolean`
- Consumes: `entry_date`, `eta_date`, `first_arrival_date`, and `eta_date_confirmed`

- [ ] **Step 1: Replace the stale user-priority test with display/edit separation tests**

```js
test("Customs arrival is displayed with its source while manual ETA remains editable", () => {
  const context = dashboardRuntimeContext("admin", [{
    entry_date: "20260801",
    eta_date: "2026-07-31",
    eta_date_user_entered: true,
    eta_date_confirmed: false,
  }]);

  assert.equal(vm.runInContext("etaText(__testCards[0])", context), "2026-08-01");
  assert.equal(
    vm.runInContext("etaDisplayText(__testCards[0])", context),
    "2026-08-01 (관세청)"
  );
  assert.equal(
    vm.runInContext("editableEtaText(__testCards[0])", context),
    "2026-07-31"
  );
  assert.equal(
    vm.runInContext("progressFieldConfirmed(__testCards[0], 'eta_date')", context),
    true
  );
});

test("manual ETA is displayed without a Customs label before actual arrival", () => {
  const context = dashboardRuntimeContext("admin", [{
    entry_date: "",
    eta_date: "2026-07-31",
    eta_date_confirmed: false,
  }]);

  assert.equal(
    vm.runInContext("etaDisplayText(__testCards[0])", context),
    "2026-07-31"
  );
  assert.equal(
    vm.runInContext("progressFieldConfirmed(__testCards[0], 'eta_date')", context),
    false
  );
});
```

- [ ] **Step 2: Run the dashboard test and verify RED**

Run: `node --test test/dashboard-source.test.js`

Expected: FAIL because `etaDisplayText`, `editableEtaText`, and `progressFieldConfirmed` do not exist and `etaText` still prefers a user-entered ETA.

- [ ] **Step 3: Implement separate display and edit helpers**

```js
function etaText(card) {
  return calendarDate(card.entry_date)
    || calendarDate(card.eta_date)
    || calendarDate(card.first_arrival_date)
    || "-";
}

function etaDisplayText(card) {
  const value = etaText(card);
  return calendarDate(card.entry_date)
    ? `${displayDate(value)} (관세청)`
    : displayDate(value);
}

function editableEtaText(card) {
  return calendarDate(card.eta_date)
    || calendarDate(card.first_arrival_date)
    || calendarDate(card.entry_date)
    || "";
}

function progressFieldConfirmed(card, field) {
  if (field === "eta_date" && calendarDate(card?.entry_date)) return true;
  return card?.[`${field}_confirmed`] === true;
}
```

- [ ] **Step 4: Use the helpers at the correct presentation boundaries**

```js
// Compact dashboard and BL progress table:
etaDisplayText(card)

// Sorting and calendar:
etaText(card)

// Transport editor initial and previous values:
editableEtaText(card)

// Confirmation styling and modal state:
progressFieldConfirmed(card, field)
```

This keeps the calendar date clean and prevents a Customs actual date from overwriting the saved manual ETA during editor comparisons.

- [ ] **Step 5: Run focused and full regression tests**

Run:

```powershell
node --test test/dashboard-source.test.js test/cargo-progress-utils.test.js
node --test test/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the display/edit separation**

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "feat: label Customs arrival dates"
```

### Task 3: Production verification

**Files:**
- No source files expected

**Interfaces:**
- Consumes: the commits from Tasks 1 and 2
- Produces: deployed production behavior at `https://www.aincustoms.com/cargo-dashboard.html`

- [ ] **Step 1: Confirm a clean worktree and recent commits**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: no uncommitted source changes; both feature commits are present.

- [ ] **Step 2: Push the main branch**

Run: `git push origin main`

Expected: push succeeds.

- [ ] **Step 3: Verify Vercel deployment**

Confirm the deployment for the pushed commit reaches `Ready` and production serves:

- `YYYY-MM-DD (관세청)` when `entry_date` exists.
- a red confirmed border for an actual Customs arrival date.
- the saved manual ETA when the transport editor opens.
- no `(관세청)` suffix inside calendar events.

