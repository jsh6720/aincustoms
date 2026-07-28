# Receipt Mail Auto Receive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** H/C 수령메일 발송 성공 시 연결된 모든 계정의 OBL/H/C 수취상태와 실제 수령일을 자동 저장하고, 모바일 원본서류 목록의 업무 우선순위를 개선한다.

**Architecture:** 메일 API가 SMTP 발송을 완료한 뒤 서버 전용 유틸리티를 호출해 동일 B/L과 폴더로 연결된 계정의 `cargo_original_docs` 행을 일괄 upsert한다. 프런트엔드는 성공 응답 후 데이터를 다시 조회하며, 모바일 정렬은 순수 rank 함수로 검증한다.

**Tech Stack:** Node.js, Vercel Serverless Functions, Supabase PostgREST, Nodemailer, HTML/Vanilla JavaScript, Node test runner

## Global Constraints

- 메일 발송 실패 시 원본서류 상태를 변경하지 않는다.
- 메일 발송일은 `Asia/Seoul` 기준 `YYYY-MM-DD`로 저장한다.
- H/C 수령메일만 OBL/H/C 자동 수취 처리하며 OBL 선사 접수메일은 기존 동작을 유지한다.
- 동일 B/L과 `folder_name`으로 연결된 관리자, 화주, 납품처 계정에 동일하게 반영한다.
- 메일 발송 후 DB 저장 실패는 메일 발송 완료를 명시한 부분 성공 오류로 응답한다.

---

### Task 1: 연결 계정 원본서류 수취 저장 유틸리티

**Files:**
- Create: `lib/cargo-original-doc-receipt.js`
- Create: `test/original-doc-receipt-mail-status.test.js`

**Interfaces:**
- Consumes: `supabaseFetch(path, options)`와 `{ account_id, bl_number, folder_name }` 카드
- Produces: `koreaDate(now?: Date): string`, `markLinkedOriginalDocsReceived({ supabaseFetch, card, receivedDate, updatedBy }): Promise<{ accountIds: string[], receivedDate: string }>`

- [ ] **Step 1: 한국 날짜 및 연결 계정 저장 실패 테스트 작성**

`test/original-doc-receipt-mail-status.test.js`에 한국 날짜 경계, 동일 B/L·폴더 계정 검색, 각 계정 upsert payload가 `obl_received`, `hc_received`, `actual_received_date`를 포함하는지 검증한다.

- [ ] **Step 2: 테스트가 기능 부재로 실패하는지 확인**

Run: `node --test test/original-doc-receipt-mail-status.test.js`

Expected: FAIL because `lib/cargo-original-doc-receipt.js` does not exist.

- [ ] **Step 3: 최소 저장 유틸리티 구현**

`koreaDate`는 UTC 시각에 9시간을 더해 날짜를 반환한다. `markLinkedOriginalDocsReceived`는 `folder_name`이 있으면 동일 B/L과 폴더의 카드를 조회하고, 없으면 원 카드 계정만 사용한다. 중복 계정을 제거한 뒤 각 계정에 다음 payload를 upsert한다.

```js
{
  account_id: accountId,
  bl_number: card.bl_number,
  obl_received: true,
  hc_received: true,
  actual_received_date: receivedDate,
  updated_by: updatedBy
}
```

- [ ] **Step 4: 유틸리티 테스트 통과 확인**

Run: `node --test test/original-doc-receipt-mail-status.test.js`

Expected: PASS.

- [ ] **Step 5: 유틸리티와 테스트 커밋**

```bash
git add lib/cargo-original-doc-receipt.js test/original-doc-receipt-mail-status.test.js
git commit -m "Add linked original document receipt updater"
```

### Task 2: 수령메일 API에 자동 수취 저장 연결

**Files:**
- Modify: `api/cargo-original-doc-receipt-mail.js`
- Modify: `test/original-doc-receipt-mail-status.test.js`

**Interfaces:**
- Consumes: Task 1의 `koreaDate`, `markLinkedOriginalDocsReceived`
- Produces: 성공 응답 `{ success, email_sent, receipt_saved, received_date }`; 부분 성공 응답 `{ success: false, email_sent: true, receipt_saved: false, message }`

- [ ] **Step 1: 메일 성공·실패·부분 성공 API 테스트 작성**

SMTP 성공 후 상태 유틸리티 호출, SMTP 실패 시 미호출, `obl_carrier_submission` 시 미호출, 상태 저장 실패 시 `email_sent: true`와 명시적 부분 성공 문구를 검증한다.

- [ ] **Step 2: 새 테스트가 현재 API에서 실패하는지 확인**

Run: `node --test test/original-doc-receipt-mail-status.test.js`

Expected: FAIL because the API response lacks `receipt_saved` and no status updater is called.

- [ ] **Step 3: 메일 성공 후 자동 수취 저장 구현**

`hc_receipt`에서만 SMTP 성공 후 한국 날짜를 계산하고 연결 계정 저장 유틸리티를 호출한다. 저장 실패는 다음 의미의 500 응답을 반환한다.

```js
{
  success: false,
  email_sent: true,
  receipt_saved: false,
  message: "수령메일은 발송됐지만 OBL/H/C 수취상태 저장에 실패했습니다. 메일을 다시 보내지 말고 관리자에게 상태 저장을 요청해 주세요."
}
```

- [ ] **Step 4: API 테스트 통과 확인**

Run: `node --test test/original-doc-receipt-mail-status.test.js`

Expected: PASS.

- [ ] **Step 5: API 변경 커밋**

```bash
git add api/cargo-original-doc-receipt-mail.js test/original-doc-receipt-mail-status.test.js
git commit -m "Mark original documents received after receipt mail"
```

### Task 3: 관리자·모바일 성공 후 즉시 새로고침

**Files:**
- Modify: `cargo-dashboard.html`
- Modify: `cargo-docs-mobile.html`
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: Task 2의 `received_date`, `receipt_saved`
- Produces: 수령메일 성공 후 `load()` 또는 화면 역할에 맞는 기존 데이터 재조회 함수 호출

- [ ] **Step 1: 성공 후 재조회 및 부분 성공 안내 소스 테스트 작성**

두 HTML의 `submitReceiptMail`이 성공 시 데이터를 다시 불러오고, `email_sent === true && receipt_saved === false`일 때 중복 발송 방지 안내를 표시하는지 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/dashboard-source.test.js`

Expected: FAIL because the current success handlers only close the modal and alert.

- [ ] **Step 3: 성공 처리 최소 수정**

관리자 대시보드와 모바일 페이지에서 성공 후 모달을 닫고 수령일을 포함한 메시지를 표시한 뒤 기존 데이터 로더를 호출한다. 부분 성공 응답은 메일이 이미 발송됐다는 경고만 표시하고 재발송을 유도하지 않는다.

- [ ] **Step 4: 화면 소스 테스트 통과 확인**

Run: `node --test test/dashboard-source.test.js`

Expected: PASS.

- [ ] **Step 5: 화면 변경 커밋**

```bash
git add cargo-dashboard.html cargo-docs-mobile.html test/dashboard-source.test.js
git commit -m "Refresh original document status after receipt mail"
```

### Task 4: 모바일 원본서류 업무 우선순위 정렬

**Files:**
- Modify: `cargo-docs-mobile.html`
- Modify: `test/dashboard-source.test.js`

**Interfaces:**
- Consumes: `last_original_doc_request`, `obl_received`, `hc_received`, `obl_carrier_submitted`, `obl_carrier_submitted_date`, `stage`
- Produces: `mobileOriginalRequestRank(card): number`, `mobileOriginalRequestSort(left, right): number`

- [ ] **Step 1: 정렬 우선순위 회귀 테스트 작성**

다음 B/L 순서를 검증한다.

```js
[
  "BL-SHIPPER-PENDING",
  "BL-RECEIVED-NOT-SUBMITTED",
  "BL-ARRIVED-MISSING",
  "BL-GENERAL",
  "BL-REQUEST-COMPLETE"
]
```

- [ ] **Step 2: 현재 rank 함수에서 실패하는지 확인**

Run: `node --test test/dashboard-source.test.js`

Expected: FAIL because received-but-not-carrier-submitted cards are not ranked immediately below pending shipper requests.

- [ ] **Step 3: rank 함수 수정**

OBL/H/C 모두 수령했고 OBL 선사 접수 상태 또는 접수일이 없는 건에 전용 rank를 부여한다. 화주 요청 완료 건은 OBL 선사 접수까지 완료된 경우 마지막 그룹으로 보낸다.

- [ ] **Step 4: 정렬 테스트 통과 확인**

Run: `node --test test/dashboard-source.test.js`

Expected: PASS.

- [ ] **Step 5: 정렬 변경 커밋**

```bash
git add cargo-docs-mobile.html test/dashboard-source.test.js
git commit -m "Prioritize received documents awaiting OBL submission"
```

### Task 5: 로컬 배포 사본 동기화 및 전체 검증

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/cargo-dashboard.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/cargo-docs-mobile.html`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-original-doc-receipt-mail.js`
- Create: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-original-doc-receipt.js`

**Interfaces:**
- Consumes: 검증된 홈페이지 저장소 파일
- Produces: 로컬 통합·Vercel 패키지와 홈페이지 저장소의 동일 동작

- [ ] **Step 1: 홈페이지 파일을 로컬 패키지 사본에 동기화**

검증된 HTML, API, 새 서버 유틸리티를 대응 경로에 복사한다.

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test`

Expected: 모든 테스트 PASS.

- [ ] **Step 3: 문법과 사본 일치 검증**

Run:

```powershell
node --check api/cargo-original-doc-receipt-mail.js
node --check lib/cargo-original-doc-receipt.js
git diff --check
```

Expected: exit code 0 and no output from `git diff --check`.

- [ ] **Step 4: 최종 변경 커밋 및 GitHub 푸시**

```bash
git add .
git commit -m "Complete receipt mail auto receive workflow"
git push origin main
```

- [ ] **Step 5: Vercel 배포 확인**

Vercel 최신 production deployment가 Ready인지 확인하고 `https://www.aincustoms.com/cargo-dashboard.html` 및 모바일 원본서류 페이지의 응답과 신규 소스를 확인한다.
