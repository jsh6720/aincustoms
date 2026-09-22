# 과세가격 로그인 지연 점검 — 2026-09-22

## 확인된 현상
- 홈페이지: HTTP 200, Vercel cache HIT, 0.16초.
- Google Apps Script 상태 응답: HTTP 200, API v2, 1.67초.
- 존재하지 않는 진단용 ID 로그인: UNAUTHORIZED, 19.21초.
- 유효하지 않은 토큰 조회: UNAUTHORIZED, 9.11초.
- 각 1회 측정이며 실제 사용자 계정의 전체 로그인/자료 조회 시간은 미측정.
- GitHub main b6b7abf의 Vercel Production 배포는 success.

## 검증된 수정본
- 로그인/읽기 제한 20초 -> 45초. 쓰기 제한은 20초 유지, 자동 재시도 없음.
- 관리자 계정 목록은 로그인 직후가 아닌 계정 탭 최초 선택 시 조회.
- 계정 탭 반복 클릭은 진행 중 요청 공유, 로그아웃 시 초기화.
- 로그인 로딩 문구와 요청 종류별 지연 안내.
- Google 코드: 읽기 전용 로그인에서 쓰기 잠금 대기 제거, getLastRow 중복 호출 제거.
- 쓰기 잠금, revision 충돌 검증, 매 요청 계정 재검증 유지.
- 시간 제한 완화 자체는 Google 처리시간 개선을 의미하지 않음.

## 검증 및 배포 상태
- 관련 회귀 검증 79개 통과.
- 운영 계정 및 스프레드시트 변경 없음.
- 홈페이지/GitHub 운영 반영 전. main 직접 push 및 Vercel 배포가 자동 승인 검토에서 거절되어 명시 승인 대기.
- Google Apps Script 운영 반영 전. 관리 브라우저/Computer Use 연결 시간 초과이며 clasp 미설치.
- GitHub/Vercel 배포로 Google /exec 버전이 자동 갱신되지는 않음.
- 실제 Google 운영 코드와 대조 후 기존 배포 ID를 새 버전으로 갱신하고 사용자 로그인 지연을 재측정해야 함.
