# Document Delivery Timestamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서류전달 `삼현` 및 `창고`를 X에서 O로 전환한 정확한 시각을 보존하고 O 상태 호버에서 한국시간으로 표시한다.

**Architecture:** 기존 boolean 및 date 컬럼은 그대로 두고, 별도 `timestamptz` 컬럼 두 개를 추가한다. API는 X→O에서만 서버 시각을 기록하고 O→X에서 날짜와 시각을 모두 지우며, 연결 계정 병합은 상태가 O인 행의 시각을 함께 선택한다. 새 컬럼이 없는 배포 순서에서도 기존 날짜 저장으로 후퇴한다.

**Tech Stack:** Node.js Vercel Functions, Supabase PostgREST/PostgreSQL, 정적 HTML/JavaScript, `node:test`

## Global Constraints

- 기존 O/X 값과 기존 날짜를 보존한다.
- 기존 O 데이터에 임의 시각을 소급 생성하지 않는다.
- 삼현과 창고의 상태·날짜·시각은 서로 독립적이다.
- 새 시각 컬럼이 없더라도 기존 O/X 및 날짜 저장은 계속 동작해야 한다.
- 호버 시각은 `Asia/Seoul` 기준 `YYYY-MM-DD HH:mm`으로 표시한다.

---

### Task 1: Timestamp Migration And Query Contract

**Files:**
- Create: `supabase/migrations/20260803_add_document_delivery_timestamps.sql`
- Modify: `lib/cargo-user-input-query.js`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Produces: `docs_delivered_samhyeon_at timestamptz`, `docs_delivered_warehouse_at timestamptz`
- Produces: `DOCUMENT_DELIVERY_TIMESTAMP_COLUMNS: readonly string[]`

- [ ] **Step 1: Write the failing migration/query test**

```js
assert.match(deliveryTimestampMigration, /docs_delivered_samhyeon_at\s+timestamptz/i);
assert.match(deliveryTimestampMigration, /docs_delivered_warehouse_at\s+timestamptz/i);
assert.doesNotMatch(deliveryTimestampMigration, /update\s+public\.cargo_card_user_inputs/i);
assert.ok(CARGO_USER_INPUT_COLUMNS.includes("docs_delivered_samhyeon_at"));
```

- [ ] **Step 2: Run the focused test and confirm it fails because the migration and columns are absent**

Run: `node --test test/document-delivery-status.test.js test/cargo-user-input-query.test.js`

- [ ] **Step 3: Add the migration and query columns**

```sql
alter table public.cargo_card_user_inputs
  add column if not exists docs_delivered_samhyeon_at timestamptz,
  add column if not exists docs_delivered_warehouse_at timestamptz;
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `node --test test/document-delivery-status.test.js test/cargo-user-input-query.test.js`

### Task 2: Preserve Transition Time In API And Linked Records

**Files:**
- Modify: `api/cargo-quota.js`
- Modify: `api/cargo-data.js`
- Modify: `lib/cargo-linked-records.js`
- Test: `test/document-delivery-status.test.js`
- Test: `test/admin-status-propagation.test.js`

**Interfaces:**
- Consumes: timestamp columns from Task 1
- Produces: merged card properties `docs_delivered_samhyeon_at`, `docs_delivered_warehouse_at`

- [ ] **Step 1: Write failing tests for X→O, repeated O, O→X, fallback, and linked merge**

```js
assert.equal(enabledPayload.docs_delivered_samhyeon_at, fixedNow);
assert.equal(repeatedEnabledPayload.docs_delivered_samhyeon_at, existingAt);
assert.equal(disabledPayload.docs_delivered_samhyeon_at, null);
assert.equal(merged.docs_delivered_samhyeon_at, "2026-08-03T05:25:00Z");
```

- [ ] **Step 2: Run the tests and confirm the new assertions fail**

Run: `node --test test/document-delivery-status.test.js test/admin-status-propagation.test.js`

- [ ] **Step 3: Implement transition-aware payloads and compatibility fallback**

```js
const deliveryTimestampFields = {
  docs_delivered_samhyeon: "docs_delivered_samhyeon_at",
  docs_delivered_warehouse: "docs_delivered_warehouse_at",
};
payload[timestampField] = enabled
  ? (currentInput?.[field] === true && currentInput?.[timestampField]
      ? currentInput[timestampField]
      : new Date().toISOString())
  : null;
```

When PostgREST reports either timestamp column missing, remove only the two timestamp fields and retry the same linked upsert with existing date fields intact.

- [ ] **Step 4: Merge timestamp from the enabled source row**

Extend `mergedDeliveryField(rows, statusField, dateField, timestampField)` to return `timestamp` from the matching O row, preferring a row with a timestamp and retaining date fallback.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run: `node --test test/document-delivery-status.test.js test/admin-status-propagation.test.js`

### Task 3: Korea-Time Hover Display

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Consumes: merged `*_at` timestamps and legacy `*_date`
- Produces: `progressDeliveryDateTitle(enabled, timestamp, date): string`

- [ ] **Step 1: Write the failing hover-format tests**

```js
assert.match(dashboard, /입력일시/);
assert.match(dashboard, /Asia\/Seoul/);
assert.match(dashboard, /card\.docs_delivered_samhyeon_at/);
```

- [ ] **Step 2: Run the focused test and confirm it fails on missing timestamp rendering**

Run: `node --test test/document-delivery-status.test.js`

- [ ] **Step 3: Implement timestamp-first hover text with date fallback**

```js
function progressDeliveryDateTitle(enabled, timestamp, date) {
  if (!enabled) return "";
  if (timestamp) return `입력일시 ${formatKoreaDateTime(timestamp)}`;
  return calendarDate(date) ? `입력일 ${displayDate(date)}` : "";
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `node --test test/document-delivery-status.test.js`

### Task 4: Mirrors, History, Full Verification, And Deployment

**Files:**
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`
- Modify: `docs/DATA_PRESERVATION_RULES.md`
- Mirror: `hyundai_dashboard/website_integration/vercel_package/api/cargo-quota.js`
- Mirror: `hyundai_dashboard/website_integration/vercel_package/api/cargo-data.js`
- Mirror: `hyundai_dashboard/website_integration/vercel_package/lib/cargo-linked-records.js`
- Mirror: `hyundai_dashboard/website_integration/vercel_package/lib/cargo-user-input-query.js`
- Mirror: `hyundai_dashboard/website_integration/vercel_package/cargo-dashboard.html`
- Mirror: `hyundai_dashboard/website_integration/add_document_delivery_timestamps.sql`
- Modify: `hyundai_dashboard/website_integration/CHANGE_REQUEST_HISTORY.md`
- Modify: `hyundai_dashboard/website_integration/DATA_PRESERVATION_RULES.md`

**Interfaces:**
- Consumes: completed website implementation
- Produces: byte-identical local deployment mirror and cumulative change record

- [ ] **Step 1: Refresh all website mirrors and add the SQL convenience copy**

Use PowerShell `Copy-Item -LiteralPath` for byte-identical mechanical copies.

- [ ] **Step 2: Record timestamp preservation and fallback rules in both history sets**

Document X→O timestamp creation, repeated O preservation, O→X clearing, linked-account sharing, and legacy date fallback.

- [ ] **Step 3: Run complete verification**

Run: `node --test`

Expected: all tests pass and the Vercel function-count test remains green.

- [ ] **Step 4: Verify mirror SHA-256 equality and clean Git status**

Compare each website source with its local mirror using `Get-FileHash -Algorithm SHA256`.

- [ ] **Step 5: Commit and push**

```powershell
git add api cargo-dashboard.html lib supabase test docs
git commit -m "feat: record document delivery timestamps"
git push origin main
```

- [ ] **Step 6: Verify production deployment**

Confirm `https://www.aincustoms.com/cargo-dashboard.html` serves the timestamp-aware dashboard source, then report the one-time Supabase SQL action if the new columns are not yet present.
