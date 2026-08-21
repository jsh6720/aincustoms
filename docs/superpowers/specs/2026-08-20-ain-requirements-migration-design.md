# AIN 요건관리 마이그레이션 설계

- 작성일: 2026-08-20
- 대상 저장소: `jsh6720/aincustoms`
- 대상 서비스: AIN 수입요건 관리 시스템
- 상태: 사용자 승인 완료

## 1. 목적

Genspark에서 호스팅 중인 AIN 수입요건 관리 시스템을 기존 AIN 홈페이지의 GitHub/Vercel 배포 구조로 이전한다. 이전 후 서비스 주소는 `https://www.aincustoms.com/requirements/`로 통일하고, Google Sheets를 유일한 운영 데이터베이스로 유지한다.

이번 작업에는 다음 항목을 함께 포함한다.

- Genspark 런타임과 내부 DB 경로 제거
- Apps Script 서버측 인증 및 권한 검증 강화
- Google Drive 일일 백업과 사내 네트워크 주간 백업
- 검증된 백업을 이용한 비파괴 복구 절차
- Vercel Preview 기반 사전 검증과 운영 롤백 절차

## 2. 조사 결과

### 2.1 프런트엔드

- 프로젝트는 빌드 과정이 없는 HTML, CSS, Vanilla JavaScript 정적 사이트다.
- 로컬 패키지는 v5.4.4이며 Genspark 운영본은 v5.4.0이다.
- 검색 범위 확장, 확인필요 목록 검색 수정, 저장 중 중복 클릭 방지 등 로컬본에만 있는 변경이 확인됐다.
- 따라서 마이그레이션 원본은 Genspark 운영본이 아니라 로컬 v5.4.4로 한다.
- 실행 코드에는 `TableDataAdd` 등 Genspark 내부 DB 쓰기 호출이 없다. Genspark DB 관련 내용은 과거 문서에만 남아 있다.
- `app.js`와 `auth.js`에는 Genspark 편집 주소 및 도메인 판별 잔재가 있어 제거해야 한다.

### 2.2 백엔드와 데이터

- 현재 앱은 `tables/*` 형태의 브라우저 요청을 가로채 Google Apps Script에 POST한다.
- Apps Script 백업 코드의 스프레드시트 ID와 사용자가 지정한 `Ain_compliance_db`가 일치한다.
- 다음 9개 운영 탭이 코드와 실제 스프레드시트에 모두 존재한다.
  - `AIN_Users`
  - `AIN_Chemical_Confirmation`
  - `AIN_MSDS`
  - `AIN_Radio_Law`
  - `AIN_Electrical_Law`
  - `AIN_Medical_Device`
  - `AIN_Non_Target`
  - `AIN_Review_Needed`
  - `AIN_Edit_Requests`
- 공개 Apps Script 엔드포인트는 정상 응답하고 새 도메인 요청을 허용한다.
- 그러나 현재 백엔드는 로그인 세션을 검증하지 않고 요청에 담긴 `role`과 `companyName`을 신뢰한다. 인증하지 않은 조회도 처리되므로 운영 전 보강이 필수다.

### 2.3 홈페이지와 도메인

- 기존 홈페이지 저장소는 `jsh6720/aincustoms`의 `main` 브랜치다.
- 기존 홈페이지 메뉴의 `AIN 요건관리` 링크는 Genspark 주소를 직접 가리킨다.
- `aincustoms.com`과 `www.aincustoms.com`은 현재 Vercel에서 정상 작동한다.
- Apex는 `www`로 리디렉션되고 `www`는 프로젝트별 Vercel CNAME을 사용한다.
- 이번 마이그레이션에는 DNS 변경이 필요하지 않다.

## 3. 범위

### 3.1 포함

- 정적 앱을 `requirements/` 하위 경로에 추가
- 홈페이지 메뉴 링크를 `/requirements/`로 변경
- Apps Script v2 인증 프로토콜 구현
- 기존 계정의 단계적 비밀번호 해시 전환
- Google Drive 일일/월간 백업
- UNC 경로 주간 XLSX 백업
- 백업 검증, 로그, 실패 알림, 복구 절차
- 자동화 테스트와 브라우저 기반 운영 흐름 검증
- Vercel Preview와 운영 배포 후 확인

### 3.2 제외

- Supabase 등 별도 데이터베이스로의 데이터 이전
- React, npm 번들러 또는 새로운 프런트엔드 프레임워크 도입
- 기존 관세성실신고 및 축산물 통관조회 기능 변경
- DNS, Microsoft 메일 레코드 또는 기존 메일 서비스 변경
- 운영 DB 자동 덮어쓰기 복구

## 4. 목표 구조

```text
GitHub: jsh6720/aincustoms
├─ index.html
└─ requirements/
   ├─ index.html
   ├─ css/
   ├─ js/
   └─ data/
        │
        ▼
Google Apps Script v2
        │
        ▼
Ain_compliance_db Google Sheets
        ├─ Google Drive 일일/월간 사본
        └─ 사내 UNC 경로 주간 XLSX 사본
```

프런트엔드의 모든 조회, 추가, 수정, 삭제는 Apps Script v2만 통과한다. Google Sheets 이외의 운영 저장소를 만들지 않는다.

## 5. 저장소 구성

운영에 필요한 다음 파일만 `requirements/`에 배치한다.

- `index.html`
- `css/*.css`
- `js/*.js`
- `data/msds.csv`

다음 파일은 공개 운영 경로에 포함하지 않는다.

- `GoogleAppsScript_Code_*.gs`
- 마이그레이션 및 인계 문서
- 다운로드 스크립트
- 테스트용 DB 비교 자료
- Google 자격증명과 백업 파일
- Genspark 패키지 원본 파일

정적 앱은 절대 Genspark 주소를 호출하지 않는다. 홈페이지의 메뉴 링크는 루트 기준 `/requirements/`를 사용한다.

## 6. 데이터 흐름과 캐시

### 6.1 조회

1. 브라우저가 `tables/<table>` 요청을 생성한다.
2. Google Sheets API 모듈이 요청을 Apps Script v2 요청으로 변환한다.
3. 브라우저가 서명 토큰을 함께 보낸다.
4. Apps Script가 토큰을 검증하고 `AIN_Users`에서 현재 권한을 다시 읽는다.
5. Apps Script가 권한에 맞는 행만 반환한다.

### 6.2 쓰기

1. 브라우저가 추가, 수정 또는 삭제 요청과 토큰을 전송한다.
2. Apps Script가 사용자와 대상 레코드의 회사 범위를 서버에서 검증한다.
3. 검증에 성공한 요청만 Google Sheets에 반영한다.
4. 프런트엔드는 성공 응답 후 해당 테이블 캐시를 즉시 무효화한다.

### 6.3 캐시 정책

- 30분 메모리 캐시는 성능 보조 수단으로만 유지한다.
- 웹 UI에서 데이터가 변경되면 관련 캐시를 즉시 삭제한다.
- `DB 기준 새로고침` 기능은 전체 캐시를 삭제하고 Google Sheets에서 다시 읽는다.
- 캐시에는 비밀번호, 토큰 또는 사용자 목록을 저장하지 않는다.

## 7. 인증과 권한

### 7.1 로그인

- 로그인 요청은 사용자명과 비밀번호를 Apps Script v2에 전송한다.
- Apps Script가 `AIN_Users`에서 자격증명을 확인한다.
- 성공 시 8시간 유효한 HMAC-SHA256 서명 토큰을 발급한다.
- 토큰에는 버전, 사용자명, 발급 시각, 만료 시각, 계정 인증 버전만 포함한다.
- 역할과 회사명은 토큰이나 브라우저 값을 신뢰하지 않고 요청마다 `AIN_Users`에서 다시 읽는다.
- 서명 비밀키와 활성 스프레드시트 ID는 Apps Script의 Script Properties에만 저장한다.
- 브라우저는 토큰을 `sessionStorage`에만 저장한다.

### 7.2 비밀번호

- `AIN_Users`에 `password_hash`, `password_salt`, `auth_version` 필드를 추가한다.
- 새 해시는 계정별 무작위 salt와 Script Properties의 서버 pepper를 사용한 HMAC-SHA256으로 생성한다.
- 이전 호환 기간에는 기존 평문 비밀번호로 로그인한 뒤 해시를 생성한다.
- 운영 전환 후 24시간 동안은 롤백을 위해 평문 값을 유지한다.
- 24시간 안정화와 기존 Genspark API 비활성화가 끝나면 해시가 생성된 계정의 평문 값을 삭제한다.
- 아직 로그인하지 않은 계정은 다음 정상 로그인에서 해시로 전환한다.
- 평문 비밀번호, 입력 비밀번호, 해시, salt, pepper를 로그에 기록하지 않는다.

### 7.3 요청 검증

- `getData`, `addData`, `updateData`, `deleteData`는 모두 유효한 토큰을 요구한다.
- `migrateData` 공개 액션은 제거한다.
- 일반 사용자는 자기 회사 데이터만 조회하고 수정할 수 있다.
- 영인에스엔 그룹 계정은 서버에 정의된 그룹사 범위만 접근한다.
- `master`는 `AIN_Users`에 현재 `master`로 등록된 계정만 인정한다.
- 로그인 실패는 사용자명 기준 10분 동안 5회로 제한하고 초과 시 15분 잠근다.
- Apps Script는 토큰 누락, 변조, 만료, 인증 버전 불일치에 `error_code: UNAUTHORIZED`를 반환하고, 브라우저 fetch 어댑터가 이를 합성 401 응답으로 변환한다.
- Apps Script는 회사 권한 부족에 `error_code: FORBIDDEN`을 반환하고, 브라우저 fetch 어댑터가 이를 합성 403 응답으로 변환한다.

## 8. 백업

### 8.1 Google Drive 일일/월간 백업

- 실행 주체: Google Apps Script 시간 기반 트리거
- 실행 시각: 매일 02:00 KST
- 저장 위치: `aincustomskr@gmail.com`이 소유한 비공개 백업 전용 폴더
- 폴더 ID는 Script Properties의 `BACKUP_FOLDER_ID`에 저장한다.
- 일일 파일명: `Ain_compliance_db_DAILY_YYYYMMDD_HHmm`
- 월간 파일명: `Ain_compliance_db_MONTHLY_YYYYMM`
- 일일 사본은 30일 보존한다.
- 매월 1일 생성하는 월간 사본은 12개월 보존한다.
- 보존기간이 지났고 지정된 `Ain_compliance_db_DAILY_` 또는 `Ain_compliance_db_MONTHLY_` 접두사가 일치하는 파일만 백업 폴더 안에서 삭제한다. 운영 파일이나 다른 폴더는 삭제하지 않는다.

백업 완료 후 원본과 사본에서 다음 항목을 비교한다.

- 필수 9개 탭 존재 여부
- 각 탭의 마지막 행과 마지막 열
- 첫 번째 행의 헤더 배열
- 백업 파일을 다시 열 수 있는지 여부

검증을 통과하지 못한 사본은 정상 백업으로 기록하지 않는다.

### 8.2 사내 네트워크 주간 백업

- 실행 주체: Windows 작업 스케줄러
- 실행 시각: 매주 일요일 03:00 KST
- 형식: XLSX
- 저장 경로:
  `\\192.168.0.107\아인서울_업무\3. Automation\3. Analysis of Import\에스티 요건 정리\0. DB 백업`
- 주간 파일명: `Ain_compliance_db_WEEKLY_YYYYMMDD_HHmm.xlsx`
- 최근 52개 주간 사본을 보존하고, 지정된 `Ain_compliance_db_WEEKLY_` 접두사가 일치하는 초과 사본만 정리한다.
- 예약 작업에서는 `Y:` 드라이브 문자를 사용하지 않고 UNC 경로를 사용한다.
- Google 자격증명은 GitHub나 평문 설정 파일에 저장하지 않고 작업 계정의 Windows 보안 저장소에서 읽는다.
- Google API 권한은 스프레드시트 조회와 내보내기에 필요한 최소 범위로 제한한다.

### 8.3 로그와 알림

- 백업 로그에는 시작 시각, 종료 시각, 백업 종류, 파일 ID 또는 경로, 탭별 행·열 수, 결과, 오류 요약을 기록한다.
- 비밀번호, 토큰, Google 자격증명은 로그에 남기지 않는다.
- 일일 또는 주간 백업 실패 시 `jsh@aincustoms.com`으로 `[AIN DB 백업 실패]` 알림을 보낸다.
- 메일 전송 자체가 실패하면 동일 오류를 로컬 로그와 Apps Script 실행 로그에 남긴다.

## 9. 복구

복구는 원본을 덮어쓰지 않는 절차만 허용한다.

1. 선택한 백업에서 새 Google Sheet 또는 별도 복구 파일을 만든다.
2. 필수 9개 탭, 헤더, 행·열 수를 원본 백업 기록과 비교한다.
3. 임시 시험 계정으로 로그인, 조회, 검색, 추가, 수정, 삭제를 검증한다.
4. 사용자가 복구본을 승인한다.
5. Script Properties의 `ACTIVE_SPREADSHEET_ID`를 복구본 ID로 변경한다.
6. 운영 URL에서 다시 연동 시험을 수행한다.
7. 문제가 있으면 이전 ID로 되돌린다.

기존 운영 DB와 실패한 복구본은 원인 확인이 끝나기 전에 삭제하지 않는다.

## 10. 배포 순서

### 10.1 사전 단계

1. 운영 DB 즉시 전체 백업
2. 기능 브랜치 생성
3. `requirements/` 정적 앱 추가
4. 홈페이지 링크 변경
5. Apps Script v2 코드를 별도 배포 URL로 배포
6. 백업 트리거와 Windows 주간 작업 준비

기존 Genspark 앱과 기존 Apps Script 배포는 이 단계에서 변경하지 않는다.

### 10.2 Preview 검증

- Vercel Preview에서 새 정적 경로를 검증한다.
- `AIN_TEST` 회사의 임시 일반 계정과 시험 레코드만 사용한다.
- 시험 레코드는 다른 회사 데이터와 겹치지 않는 고유 표식을 사용한다.
- 검증 후 시험 레코드와 임시 계정을 제거한다.

### 10.3 운영 전환

1. 배포 직전 백업을 한 번 더 실행한다.
2. 승인된 기능 브랜치를 `main`에 병합한다.
3. Vercel 운영 배포가 완료될 때까지 기다린다.
4. `/requirements/`와 홈페이지 메뉴 링크를 확인한다.
5. 로그인, 데이터 조회, 검색, 쓰기, 백업 로그를 재확인한다.
6. 24시간 안정화 후 기존 Genspark Apps Script 배포를 비활성화한다.
7. 해시가 생성된 계정의 평문 비밀번호를 삭제한다.

## 11. 검증 항목

### 11.1 기능

- 로그인 성공과 실패
- 역할별 메뉴와 데이터 범위
- 7개 업무 데이터 탭과 수정요청 탭 조회
- 추가, 수정, 삭제
- `STD85000-01` 통합검색
- 확인필요 목록 검색
- 파일 업로드와 다운로드
- `DB 기준 새로고침`
- 모바일과 데스크톱 기본 레이아웃

### 11.2 보안

- 토큰 없는 요청 거부
- 변조 토큰 거부
- 만료 토큰 거부
- 클라이언트가 위조한 `role`과 `companyName` 무시
- 일반 계정의 다른 회사 레코드 접근 거부
- 공개 `migrateData` 호출 거부
- 로그인 실패 제한
- 브라우저와 Apps Script 로그의 비밀정보 미출력

### 11.3 백업과 복구

- 일일 백업 수동 실행
- 월간 보존 사본 생성 조건
- 30일/12개월 보존 규칙
- 주간 XLSX 내보내기
- 52개 보존 규칙
- 필수 9개 탭 및 행·열 검증
- 별도 복구본 생성
- `ACTIVE_SPREADSHEET_ID` 전환과 원복
- 실패 알림

### 11.4 회귀

- 홈페이지 기본 섹션과 연락처
- 관세성실신고 조회
- 축산물 통관조회
- 기존 Vercel API 기능과 테스트

## 12. 롤백

- 프런트엔드 문제는 직전 Vercel 운영 배포로 롤백한다.
- Apps Script 문제는 직전 배포 버전 또는 기존 Apps Script URL로 되돌린다.
- 데이터 문제는 검증된 백업에서 새 복구본을 만들고 `ACTIVE_SPREADSHEET_ID`만 변경한다.
- 24시간 호환 기간에는 기존 평문 비밀번호와 Genspark 경로를 비상 롤백용으로만 보존한다.
- 안정화가 확인되면 기존 Genspark Apps Script 배포를 비활성화하고 평문 비밀번호를 제거한다.

## 13. 완료 기준

- `https://www.aincustoms.com/requirements/`가 정상 응답한다.
- 홈페이지의 `AIN 요건관리`가 새 경로를 연다.
- 실행 코드에서 Genspark 호출이 0건이다.
- Google Sheets 이외 운영 저장 경로가 0개다.
- 인증 및 권한 우회 검사가 모두 차단된다.
- 기능 및 회귀 테스트가 통과한다.
- Google Drive와 UNC 백업이 각각 성공한다.
- 실제 별도 복구본을 이용한 복원 시험이 성공한다.
- 기존 홈페이지, 관세성실신고, 축산물 통관조회에 회귀 문제가 없다.

## 14. 운영 안전 원칙

- 원본 Google Sheet와 기존 백업은 자동으로 삭제하거나 덮어쓰지 않는다.
- 공개 저장소에 자격증명, Script Properties 값, DB 백업을 커밋하지 않는다.
- 배포, Apps Script 변경, 백업 스케줄 등록은 각 단계의 검증을 통과한 뒤 수행한다.
- GitHub 푸시, PR, 병합과 운영 배포는 실제 변경 범위를 확인한 뒤 실행한다.
- 실패한 단계는 다음 단계로 진행하지 않고 기존 운영 서비스를 유지한다.
