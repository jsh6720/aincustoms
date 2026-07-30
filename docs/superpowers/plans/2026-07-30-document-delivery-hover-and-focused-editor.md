# 서류전달 입력일 호버 및 필드별 편집창 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 삼현·창고 서류전달 O 입력일을 정확히 보존해 호버로 표시하고, 반입예정일 셀에서는 해당 날짜만 편집하는 창을 제공한다.

**Architecture:** `cargo_card_user_inputs`에 전달 항목별 날짜를 추가하고 기존 연결 계정 저장 경로로 상태와 날짜를 함께 전파한다. 데이터 API는 상태를 만든 행의 날짜를 병합해 카드에 노출하고, 대시보드는 O 토글에만 입력일 툴팁을 렌더링한다. 공용 운송정보 모달은 호출된 필드에 따라 관련 입력 그룹만 표시하되 전체 편집 호출은 기존 화면을 유지한다.

**Tech Stack:** Vercel Node.js Functions, Supabase/PostgreSQL, vanilla JavaScript/HTML/CSS, Node.js test runner

## Global Constraints

- 다른 상태 변경은 기존 서류전달 O/X와 입력일을 변경하지 않는다.
- 연결된 화주·납품처 계정은 서류전달 상태와 입력일을 동일하게 공유한다.
- 과거 O 데이터의 입력일을 임의로 생성하지 않는다.
- 반입예정일 전용 편집은 기존 저장·확정 API를 재사용한다.
- 전체 운송정보 편집 동작과 메일 발송 조건은 유지한다.

---

### Task 1: 서류전달 입력일 데이터 모델과 병합

**Files:**
- Create: `supabase/migrations/20260730_add_document_delivery_dates.sql`
- Modify: `lib/cargo-user-input-query.js`
- Modify: `lib/cargo-linked-records.js`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Produces: `docs_delivered_samhyeon_date`와 `docs_delivered_warehouse_date` 카드 필드
- Consumes: 기존 `linkedRows(card, cardRefs, inputs)` 연결 계정 행

- [ ] **Step 1: 날짜 컬럼 및 상태 원본 행 병합 실패 테스트 작성**

```js
test("linked delivery status keeps the date from the row that set O", () => {
  const merged = mergeLinkedDeliveryStatus(card, cards, [
    {
      account_id: "hch",
      bl_number: "BL-1",
      docs_delivered_samhyeon: true,
      docs_delivered_samhyeon_date: "2026-07-22",
      updated_at: "2026-07-22T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "BL-1",
      docs_delivered_samhyeon: false,
      docs_delivered_samhyeon_date: null,
      updated_at: "2026-07-30T01:00:00Z",
    },
  ]);
  assert.equal(merged.docs_delivered_samhyeon, true);
  assert.equal(merged.docs_delivered_samhyeon_date, "2026-07-22");
});
```

- [ ] **Step 2: 테스트를 실행해 날짜 필드 부재로 실패 확인**

Run: `node --test --test-name-pattern "linked delivery status keeps the date" test/document-delivery-status.test.js`

Expected: `docs_delivered_samhyeon_date`가 `undefined`여서 FAIL

- [ ] **Step 3: 마이그레이션과 조회·병합 구현**

```sql
alter table public.cargo_card_user_inputs
  add column if not exists docs_delivered_samhyeon_date date,
  add column if not exists docs_delivered_warehouse_date date;
```

`CARGO_USER_INPUT_COLUMNS`에 두 날짜를 추가한다. `mergeLinkedDeliveryStatus`는 각 상태가
`true`인 행 중 해당 날짜가 있는 최신 행을 선택하고, 날짜가 없는 과거 O는 빈 문자열을
반환한다.

- [ ] **Step 4: 날짜 병합 테스트 통과 확인**

Run: `node --test test/document-delivery-status.test.js test/cargo-user-input-query.test.js`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/20260730_add_document_delivery_dates.sql lib/cargo-user-input-query.js lib/cargo-linked-records.js test/document-delivery-status.test.js
git commit -m "feat: track document delivery dates"
```

### Task 2: 서류전달 토글 날짜 저장과 초기화

**Files:**
- Modify: `api/cargo-quota.js`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Consumes: `admin_status` 요청의 `docs_delivered_samhyeon` 또는 `docs_delivered_warehouse`
- Produces: 상태 O에는 한국 기준 오늘 날짜, 상태 X에는 `null`

- [ ] **Step 1: O/X 날짜 저장 규칙 실패 테스트 작성**

API 소스가 전달 필드와 날짜 필드를 매핑하고 O에는 `koreaToday()`, X에는 `null`을
저장하는지 검증한다.

```js
assert.match(cargoQuotaApi, /docs_delivered_samhyeon_date/);
assert.match(cargoQuotaApi, /docs_delivered_warehouse_date/);
assert.match(cargoQuotaApi, /payload\[dateField\]\s*=\s*body\[field\]\s*\?\s*koreaToday\(\)\s*:\s*null/);
```

- [ ] **Step 2: 테스트를 실행해 날짜 저장 로직 부재로 실패 확인**

Run: `node --test --test-name-pattern "delivery toggle stores" test/document-delivery-status.test.js`

Expected: 날짜 필드 정규식 불일치로 FAIL

- [ ] **Step 3: 최소 저장 구현**

```js
const DELIVERY_DATE_FIELDS = {
  docs_delivered_samhyeon: "docs_delivered_samhyeon_date",
  docs_delivered_warehouse: "docs_delivered_warehouse_date",
};
payload[field] = body[field];
payload[DELIVERY_DATE_FIELDS[field]] = body[field] ? koreaToday() : null;
```

연결 계정 저장 payload에도 날짜가 포함되게 하고, 누락 컬럼 오류 메시지에는 새
마이그레이션 파일명을 안내한다.

- [ ] **Step 4: API 테스트 통과 확인**

Run: `node --test test/document-delivery-status.test.js`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add api/cargo-quota.js test/document-delivery-status.test.js
git commit -m "feat: save document delivery dates"
```

### Task 3: 서류전달 O 입력일 호버

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/document-delivery-status.test.js`

**Interfaces:**
- Consumes: 카드의 `docs_delivered_samhyeon_date`, `docs_delivered_warehouse_date`
- Produces: O이며 날짜가 있을 때 `입력일 YYYY-MM-DD` 툴팁

- [ ] **Step 1: 호버 렌더링 실패 테스트 작성**

```js
assert.match(dashboard, /function progressDeliveryDateTitle/);
assert.match(dashboard, /입력일 \$\{displayDate\(date\)\}/);
assert.match(dashboard, /title="\$\{esc\(progressDeliveryDateTitle/);
```

- [ ] **Step 2: 테스트를 실행해 헬퍼 부재로 실패 확인**

Run: `node --test --test-name-pattern "delivery O exposes" test/document-delivery-status.test.js`

Expected: `progressDeliveryDateTitle` 부재로 FAIL

- [ ] **Step 3: 날짜 호버 최소 구현**

```js
function progressDeliveryDateTitle(enabled, date) {
  return enabled && calendarDate(date) ? `입력일 ${displayDate(date)}` : "";
}
```

삼현과 창고 버튼의 `title`에 해당 헬퍼 결과를 넣는다. X 또는 날짜 없는 과거 O의
title은 빈 문자열로 둔다.

- [ ] **Step 4: UI 소스 테스트 통과 확인**

Run: `node --test test/document-delivery-status.test.js`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add cargo-dashboard.html test/document-delivery-status.test.js
git commit -m "feat: show document delivery date on hover"
```

### Task 4: 반입예정일 전용 편집창

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `openProgressWarehouseEditor(cardIndex, focusField)`
- Produces: `focusField`에 대응하는 입력 그룹만 표시하는 모달

- [ ] **Step 1: 필드별 모달 실패 테스트 작성**

```js
test("warehouse expected date opens a focused editor", () => {
  assert.match(dashboard, /id="progressWarehouseDateGroup"/);
  assert.match(dashboard, /progressWarehouseModalTitle/);
  assert.match(openBody, /warehouse_expected_date:\s*"반입예정일 입력"/);
  assert.match(openBody, /toggleProgressWarehouseGroups\(progressWarehouseFocusField\)/);
});
```

- [ ] **Step 2: 테스트를 실행해 필드 그룹 분기 부재로 실패 확인**

Run: `node --test --test-name-pattern "warehouse expected date opens a focused editor" test/dashboard-source.test.js`

Expected: 그룹 ID 또는 분기 함수 부재로 FAIL

- [ ] **Step 3: 모달 그룹과 제목 분기 구현**

각 입력 블록에 `progressWarehouseEtaGroup`, `progressFreeTimeExpiryGroup`,
`progressWarehouseYardGroup`, `progressWarehouseDateGroup` ID를 부여한다.

```js
const focusedTitles = {
  eta_date: "입항예정일 입력",
  storage_yard: "반입(예정)구역 입력",
  warehouse_expected_date: "반입예정일 입력",
};
```

`focusField`가 있으면 대응 그룹만 표시하고, 빈 값이면 네 그룹을 모두 표시한다.
저장 payload는 표시된 필드만 포함해 숨겨진 기존 값이 덮이지 않게 한다.

- [ ] **Step 4: 편집창과 기존 저장 회귀 테스트 통과 확인**

Run: `node --test test/dashboard-source.test.js test/progress-request-workflow.test.js`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "fix: focus progress date editors"
```

### Task 5: 전체 검증, 변경 이력, 배포

**Files:**
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`

**Interfaces:**
- Consumes: Tasks 1-4의 완료 상태
- Produces: 검증된 main 배포

- [ ] **Step 1: 변경 이력에 데이터 보존 규칙 추가**

서류전달 항목별 입력일, X 전환 시 날짜 초기화, 반입예정일 전용 편집창을 기록한다.

- [ ] **Step 2: 전체 테스트와 정적 검증 실행**

Run:

```bash
git diff --check
node --test test/*.test.js
```

Expected: 모든 테스트 PASS, diff 오류 없음

- [ ] **Step 3: 최종 커밋과 push**

```bash
git add docs/CHANGE_REQUEST_HISTORY.md
git commit -m "docs: record delivery date hover behavior"
git push origin main
```

- [ ] **Step 4: Vercel 운영 배포 확인**

`https://www.aincustoms.com/cargo-dashboard.html`에서 새 함수와 모달 그룹이
반영될 때까지 확인한다.

- [ ] **Step 5: 운영 브라우저 검증**

관리자 계정에서 다음을 확인한다.

- 반입예정일 클릭 시 해당 날짜 입력란만 표시
- 삼현/창고 O에 입력일 호버 표시
- X에는 입력일 호버 미표시
- O/X 토글과 표 레이아웃 유지
