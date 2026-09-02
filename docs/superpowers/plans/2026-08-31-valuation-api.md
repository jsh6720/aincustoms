# Valuation API Implementation Plan

> Use superpowers:executing-plans task-by-task and superpowers:requesting-code-review before delivery. No remote deployment in this plan.

**Goal:** 기존 두 시트를 보존하면서 계정 편집을 서버 인증 API에 연결한다.
**Architecture:** doPost가 서명 세션을 검증하고 계정 시트에서 권한을 다시 읽는다. mutation은 ScriptLock 및 HMAC revision을 검사한다. 중앙 callAPI가 token/revision을 첨부한다.
**Tech Stack:** Apps Script V8, vanilla JavaScript, node:test/VM, local browser verification.
**Spec:** 이 문서의 Global Constraints.

## Global Constraints

- 기존 LOGIN_SHEET_ID/DUTY_SHEET_ID, 원본 데이터, 앞서 수정된 레이아웃/회사명 검색 유지.
- 승인 전 운영 실행/DB 변경/배포/푸시 금지.
- 원본 제공 파일 백업 SHA256: CB30C0637CD7E640C8D9A8D5A7D584968FC975CFA83495B6D773326A4BA6326E.
- 요청 isMaster/company는 권한 근거가 아니다. 계정 목록은 id/company/rowIndex만 반환한다.
- 비밀번호 생략/빈 문자열은 유지, 입력값은 정확히 저장. ID 변경 금지. aincustoms는 대소문자 무관 보호.
- 표 조회 revision과 실제 rowIndex/id를 검사한다. 직접 시트 편집은 ScriptLock 밖이므로 전환 중 중단한다.
- 서버의 비밀번호/토큰/시트/요청 본문 로깅과 에러 echo 제거. 평문 저장 방식의 일괄 마이그레이션은 하지 않는다.
- 종료/만료 시 세션과 이전 사용자 DOM/입력을 지운다. 회사명 접근권한은 정규화 후 완전 일치만 허용한다.

## Task 1: 백엔드 계약

Files: apps-script/valuation/Code.gs, test/helpers/valuation-gas-harness.js, test/valuation-api.test.js.
Interfaces: doPost(e) -> JSON {success,code?,data?,revision?,user?}; user={username,company,isMaster,token,expiresAt}; account row={id,company,rowIndex}; duty row=string[6].

- [x] 제공 원본을 VM에서 실행하고 미인증 조회/비밀번호 로그/빈 비밀번호 초기화 실패를 확인한다.
- [x] 8시간 HMAC-SHA256 token 발급, 만료/서명/변경 계정 재검증을 구현한다. key는 VALUATION_SESSION_SECRET 속성.
- [x] mutation은 잠금 안에서 인증, 관리자, revision, 행 일치, 중복 검사를 차례로 수행한다.
- [x] 새 값은 RichText로 기록하여 '='를 수식으로 실행하지 않는다. 생략 password는 B열을 쓰지 않는다.
- [x] JSON/FormData 및 공격/행 이동/보호계정/리터럴 저장 회귀 테스트를 통과시킨다.

## Task 2: 프런트 통합

Files: index.html, lib/valuation-ui.js, test/valuation-session.test.js.
- [x] 실제 inline script의 callAPI를 VM에서 실행하여 토큰 전달/권한값 제거/만료를 실패 재현한다.
- [x] normalizeUser는 token/expiresAt을 보존하고 callAPI는 마지막 성공 조회 revision을 첨부한다.
- [x] 현재 세션의 UNAUTHORIZED만 로그인으로 되돌린다. 늦은 이전 세션 응답은 새 세션에 영향을 주지 않는다.
- [x] 성공 조회/저장/재조회와 종료 시 DOM 초기화를 통합 검증한다.

## Task 3: 백업 및 운영 인계

Files: apps-script/valuation/README.ko.md.
- [x] 편집기 전용 backupValuationSheets로 두 스프레드시트를 복사하되 원본 쓰기는 하지 않는 테스트.
- [x] initializeValuationSecurity는 최초 key/탭 ID만 설정하고 재실행해도 유지하는 테스트.
- [x] 동일 배포 ID의 새 버전과 프런트를 함께 전환하는 순서, 롤백/긴급중지, 기존 평문/로그 잔여위험을 기록.
- [x] 전체 node --test 및 독립 리뷰. 실제 Google 실행/배포 검증은 승인 후 별도 수행.

## 검증 결과 (2026-08-31, 로컬)

- 최초 제공 원본으로 신규 서버 27개 테스트 실패 확인 후 구현.
- UI 연동 및 리뷰 지적사항 각각 실패 재현 후 수정.
- 서버29 + 세션통합13 + 기존 화면24 = 관련66개 통과.
- 최종 전체 회귀 462/462 통과, git diff --check 오류 없음.
- 독립 리뷰 지적: idle 만료, 편집 상태 정리, 삭제 flush, 마지막 행 추가를 반영.
- README의 잘못된 gid 차단 범위 표현을 실제 구현에 맞게 수정.
- 실제 CSS가 로드된 격리 Chromium에서 로그인/편집/비번유지/화주격리/검색초기화/레이아웃 확인.
  1440px 화면에서 팝업1416px, 표 가로 넘침 없음, nowrap; 900px 화면 가로스크롤;
  375px 높이에서 팝업 top8/bottom367, 닫기버튼 범위 내.
- 브라우저 테스트는 모든 운영 API 요청을 가상 Google 서비스로 대체. 실제 API 호출0.
- 테스트 창에서 공개 CSS/글꼴 읽기만 허용했으며 사용자 브라우저 세션은 사용하지 않음.
- 실제 Google DB 사본 생성, Google 실행권한/셀서식/CORS 검증, 원격 커밋/푸시/배포는 미수행.
