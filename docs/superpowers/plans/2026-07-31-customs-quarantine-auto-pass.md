# Customs Quarantine Auto Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관세청 동물검역·식품의약품 합격 문구를 정확히 판정해 관리자 수동값보다 우선하는 읽기 전용 `O`와 `관세청 확인` 호버를 제공한다.

**Architecture:** 공통 검역 판정 함수를 `lib/cargo-progress-utils.js`에 두고 `api/cargo-data.js`가 원본 관세청 상태와 자동 합격 boolean을 응답한다. `cargo-dashboard.html`은 자동 합격을 최우선으로 렌더링하되 수동 override 데이터는 변경하지 않는다.

**Tech Stack:** Node.js CommonJS, Vercel Serverless API, 정적 HTML/JavaScript, Node test runner

## Global Constraints

- 관세청 자동 합격은 수동 `△/X`보다 우선한다.
- 수동 override 데이터는 삭제하거나 덮어쓰지 않는다.
- 자동 `O`는 읽기 전용이며 호버에 `관세청 확인`을 표시한다.
- 데이터베이스 마이그레이션을 추가하지 않는다.
- 기존 변경 이력과 데이터 보존 규칙을 갱신한다.

---

### Task 1: 검역 합격 판정과 API 원문 보존

**Files:**
- Modify: `lib/cargo-progress-utils.js`
- Modify: `api/cargo-data.js`
- Test: `test/cargo-progress-utils.test.js`
- Test: `test/customs-quarantine-auto-pass.test.js`

**Interfaces:**
- Consumes: 관세청 원문 검역 상태 문자열
- Produces: `customsQuarantinePassed(value, type)` 및 카드의 `animal_quarantine_customs_passed`, `food_quarantine_customs_passed`

- [ ] **Step 1: 합격·불합격·검역 종류 분리 테스트를 먼저 작성한다.**
- [ ] **Step 2: `node --test test/cargo-progress-utils.test.js test/customs-quarantine-auto-pass.test.js`를 실행해 신규 테스트가 실패하는지 확인한다.**
- [ ] **Step 3: 공백을 정규화하고 종류별 정확한 합격 문구를 판정하는 최소 함수를 구현한다.**
- [ ] **Step 4: API가 원본 관세청 필드와 자동 합격 boolean을 함께 반환하게 한다.**
- [ ] **Step 5: 대상 테스트를 다시 실행해 통과를 확인한다.**

### Task 2: 자동 O와 출처 호버 표시

**Files:**
- Modify: `cargo-dashboard.html`
- Test: `test/customs-quarantine-auto-pass.test.js`

**Interfaces:**
- Consumes: `animal_quarantine_customs_passed`, `food_quarantine_customs_passed`
- Produces: 읽기 전용 자동 `O`와 `title="관세청 확인"`

- [ ] **Step 1: 수동 `△/X`보다 자동 O가 우선하고 자동 O에 토글 버튼이 없는 실패 테스트를 작성한다.**
- [ ] **Step 2: 대상 테스트를 실행해 실패 이유가 표시 로직 부재인지 확인한다.**
- [ ] **Step 3: `progressManualStatusToggle`에서 자동 합격을 최우선으로 렌더링한다.**
- [ ] **Step 4: `inspectionStatusLabel`에 선택적 출처 호버를 추가한다.**
- [ ] **Step 5: 대상 테스트를 실행해 통과를 확인한다.**

### Task 3: 누적 문서와 회귀 검증 및 배포

**Files:**
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`
- Modify: `docs/DATA_PRESERVATION_RULES.md`

**Interfaces:**
- Consumes: 구현 완료 상태
- Produces: 누적 변경 이력, 데이터 보존 규칙, 배포 커밋

- [ ] **Step 1: 2026-07-31 변경 이력과 자동/수동 우선순위 규칙을 기록한다.**
- [ ] **Step 2: `node --test`와 `git diff --check`를 실행한다.**
- [ ] **Step 3: 변경 범위와 민감정보 포함 여부를 검토한다.**
- [ ] **Step 4: 커밋하고 GitHub `main`에 푸시한다.**
- [ ] **Step 5: 운영 HTML에서 `관세청 확인` 자동 합격 코드가 배포됐는지 확인한다.**
