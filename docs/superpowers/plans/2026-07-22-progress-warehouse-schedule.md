# BL 진행현황 반입 일정 및 원본서류 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BL별 진행현황에서 반입구역·반입예정일을 편집하고 화주 변경 메일 및 달력 일정을 제공하며, 원본 토글·모바일 양도증·수령메일 추가 수신인을 함께 개선한다.

**Architecture:** 기존 `/api/cargo-quota`의 `manual_fields` 저장 경로를 유지하고 서버 측 비교·메일만 추가한다. 모바일 양도증은 `cargo_original_docs.transfer_received_override`로 자동 스캔값과 분리하고, 메일 주소 파싱과 변경 비교는 테스트 가능한 순수 helper에 둔다.

**Tech Stack:** Static HTML/JavaScript, Vercel Node.js functions, Supabase REST, Nodemailer, Node.js built-in test runner.

## Global Constraints

- 새 Vercel API 엔드포인트를 추가하지 않는다.
- 반입 일정은 기존 `storage_yard`, `warehouse_expected_date` 컬럼을 사용한다.
- 화주가 실제 반입정보를 변경한 경우에만 메일을 발송하며 관리자 수정은 메일을 발송하지 않는다.
- 기본 H/C 수령메일 수신인과 참조인은 유지한다.
- 데스크톱 홈페이지와 `website_integration` 미러를 동일하게 유지한다.

---

### Task 1: 메일·변경 비교 helper와 테스트

**Files:**
- Create: `lib/cargo-mail-utils.js`
- Create: `test/cargo-mail-utils.test.js`

**Interfaces:**
- Produces: `parseRecipientList(value)`, `mergeRecipients(base, extra)`, `warehouseChanges(previous, next)`, `buildWarehouseChangeMail(card, session, previous, next)`

- [ ] **Step 1: 실패 테스트 작성**

```js
test("detects only changed warehouse fields", () => {
  assert.deepEqual(warehouseChanges(
    { storage_yard: "A", warehouse_expected_date: "2026-07-22" },
    { storage_yard: "B", warehouse_expected_date: "2026-07-22" }
  ), ["storage_yard"]);
});

test("merges and deduplicates additional recipients", () => {
  assert.deepEqual(mergeRecipients(["base@example.com"], "new@example.com, base@example.com"),
    ["base@example.com", "new@example.com"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/cargo-mail-utils.test.js`
Expected: FAIL because `lib/cargo-mail-utils.js` does not exist.

- [ ] **Step 3: 최소 helper 구현**

```js
function warehouseChanges(previous, next) {
  return ["storage_yard", "warehouse_expected_date"].filter(
    (key) => String(previous?.[key] || "").trim() !== String(next?.[key] || "").trim()
  );
}
```

메일 주소는 쉼표·세미콜론·줄바꿈으로 분리하고 형식 검증 및 대소문자 기준 중복 제거를 수행한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/cargo-mail-utils.test.js`
Expected: PASS.

### Task 2: 기존 저장 API에 화주 반입정보 변경메일 추가

**Files:**
- Modify: `api/cargo-quota.js`
- Test: `test/cargo-mail-utils.test.js`

**Interfaces:**
- Consumes: Task 1 helper
- Produces: 기존 `manual_fields` 응답에 `email_sent`, `email_message`, `changed_fields` 추가

- [ ] **Step 1: 관리자·동일값·변경값 조건 테스트 추가**

```js
test("unchanged warehouse values produce no changes", () => {
  assert.deepEqual(warehouseChanges({ storage_yard: "A" }, { storage_yard: "A" }), []);
});
```

- [ ] **Step 2: 실패 확인 후 API 구현**

`manual_fields` 처리 전에 기존 사용자 입력과 `cargo_cards`를 조회한다. effective 이전값을 만든 뒤 upsert하고, `session.role === "shipper"`이며 변경 필드가 있을 때만 Nodemailer로 아래 주소에 발송한다.

```js
const WAREHOUSE_NOTIFY_TO = [
  "jsh@aincustoms.com", "jhcho@aincustoms.com",
  "bill@aincustoms.com", "ain@aincustoms.com",
];
```

메일 실패는 저장 성공을 되돌리지 않고 응답에 실패 메시지를 넣는다.

- [ ] **Step 3: 테스트와 구문 검사**

Run: `node --test test/*.test.js`
Expected: PASS.

Run: `node --check api/cargo-quota.js`
Expected: no output, exit 0.

### Task 3: 진행현황 반입정보 편집과 달력

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\tests\test_card_ui_state.py`

**Interfaces:**
- Consumes: `/api/cargo-quota` `manual_fields`
- Produces: `openProgressWarehouseEditor(index)`, `saveProgressWarehouseEditor()`, `closeProgressWarehouseEditor()`

- [ ] **Step 1: 실패하는 정적 UI 테스트 작성**

검사 항목은 `docsStatusBtn` 제거, `반입예정일` 헤더, 편집 모달 함수, `warehouse_expected_date` 캘린더 이벤트다.

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest hyundai_dashboard.tests.test_card_ui_state -v`
Expected: FAIL for missing progress warehouse editor.

- [ ] **Step 3: UI 구현**

진행현황 두 셀을 작은 버튼으로 만들고 같은 모달을 연다. 저장 payload는 카드의 나머지 수기 필드를 보존하면서 `storage_yard`, `warehouse_expected_date`만 바꾼다. 성공 후 현재 카드와 진행현황 표·달력을 다시 그리며 `email_sent === false && changed_fields.length`이면 경고한다.

- [ ] **Step 4: 달력 이벤트 추가**

```js
if (card.warehouse_expected_date) events.push({
  date: calendarDate(card.warehouse_expected_date),
  type: "warehouse",
  text: `반입예정 · ${card.bl_number} · ${yardText(card)}`,
});
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `python -m unittest hyundai_dashboard.tests.test_card_ui_state -v`
Expected: PASS.

### Task 4: BL/H-C 원본 O→X 토글 수정

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-dashboard.html`
- Test: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\tests\test_card_ui_state.py`

**Interfaces:**
- Produces: O 상태는 confirm 후 X 저장, X 상태는 날짜 입력 후 O 저장

- [ ] **Step 1: 실패 테스트 작성 및 확인**

테스트는 `saveProgressOriginalDoc`가 received 상태에서 `confirm`을 사용하고 날짜 prompt 경로를 건너뛰는지 검사한다.

- [ ] **Step 2: 토글 구현**

선택 문서가 O이면 확인 후 해당 boolean만 false로 저장한다. 다른 원본도 X일 때만 `actual_received_date`를 빈 값으로 전송한다. X이면 현재 날짜 입력 흐름을 유지한다.

- [ ] **Step 3: 전체 Python 테스트**

Run: `python -m unittest discover -s hyundai_dashboard/tests -v`
Expected: PASS.

### Task 5: 모바일 양도증 override

**Files:**
- Create: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\add_transfer_received_override.sql`
- Modify: `api/cargo-data.js`
- Modify: `api/cargo-original-docs.js`
- Modify: `cargo-docs-mobile.html`
- Mirror: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-data.js`
- Mirror: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_api\cargo-original-docs.js`
- Mirror: `Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\cargo-docs-mobile.html`

**Interfaces:**
- DB: nullable `cargo_original_docs.transfer_received_override boolean`
- API card field: `transfer_received_override` and effective `doc_transfer_received`

- [ ] **Step 1: 실패 정적 테스트 추가**

모바일 HTML에 `transfer{index}` 선택과 save payload가 없어서 실패하는 테스트를 추가한다.

- [ ] **Step 2: SQL 및 API 구현**

```sql
alter table public.cargo_original_docs
  add column if not exists transfer_received_override boolean;
```

`cargo-data`는 override가 null이면 자동 스캔값, boolean이면 override를 사용한다. `cargo-original-docs`는 `automatic`을 null로, `true/false`를 boolean으로 저장한다.

- [ ] **Step 3: 모바일 UI 구현**

양도증 select에 `자동`, `X`, `O`를 표시하고 전체 저장 payload에 포함한다.

- [ ] **Step 4: 테스트 및 구문 검사**

Run: `node --test test/*.test.js`
Expected: PASS.

### Task 6: H/C 수령메일 추가 수신인

**Files:**
- Modify: `api/cargo-original-doc-receipt-mail.js`
- Modify: `cargo-dashboard.html`
- Modify: `cargo-docs-mobile.html`
- Mirror corresponding integration files
- Test: `test/cargo-mail-utils.test.js`

**Interfaces:**
- Request field: `additional_recipients` string
- Consumes: Task 1 `mergeRecipients`

- [ ] **Step 1: 수신인 병합·오류 테스트 작성**

기본 수신인이 항상 포함되고 추가 주소가 중복 제거되는지, 잘못된 주소가 예외인지 검사한다.

- [ ] **Step 2: API 구현**

`additional_recipients`를 정리해 기본 수신인에 더하고 Nodemailer `to`에 전달한다. 기존 CC는 유지한다.

- [ ] **Step 3: 데스크톱·모바일 입력란 구현**

두 메일 모달에 추가 수신인 input과 안내문을 추가하고 요청 body에 포함한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/*.test.js`
Expected: PASS.

### Task 7: 최종 동기화·배포·운영 검증

**Files:**
- Verify all modified homepage and integration mirror files

- [ ] **Step 1: mirror 동일성 및 전체 테스트**

Run: `node --test test/*.test.js`

Run: `python -m unittest discover -s hyundai_dashboard/tests -v`

Run: `node -e "const fs=require('fs');for(const p of process.argv.slice(1)){const h=fs.readFileSync(p,'utf8');for(const m of h.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi))new Function(m[1]);console.log('OK',p)}" cargo-dashboard.html cargo-docs-mobile.html`

Expected: all PASS and both HTML scripts parse.

- [ ] **Step 2: 홈페이지 커밋·푸시**

Stage only files in this plan, commit with a focused message, and push `main` to `origin`.

- [ ] **Step 3: Vercel 배포 확인**

운영 HTML에서 새 편집 함수와 반입예정일 헤더가 확인될 때까지 배포를 확인한다.

- [ ] **Step 4: 브라우저 운영 검증**

관리자 세션에서 진행현황 편집 모달, 원본 O→X 확인창, 모바일 양도증 선택, 수령메일 추가 수신인 입력을 확인한다. 실제 데이터 변경이나 메일 발송은 테스트용 동일값/취소 흐름으로 검증한다.
