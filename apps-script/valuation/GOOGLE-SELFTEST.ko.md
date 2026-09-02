# 과세가격 API — 별도 Google 프로젝트 검증

## 현재 확인된 사항

2026-08-31 사용자 제공 배포 관리 화면에서 기존 homage decl의 실행 계정은 jsh79065432@gmail.com, 웹 앱 접근 범위는 모든 사용자로 확인했습니다. 실행 계정은 앞서 확인한 두 원본 DB의 소유자와 같습니다. 현재 배포 버전 번호는 캡처에 보이지 않습니다.

시트의 일반 공유 제한과 웹 앱의 접속 범위는 서로 다릅니다. 시트를 비공개로 바꿨다고 기존 API의 인증 취약점까지 해소되는 것은 아닙니다. 새 서버/프런트 코드는 아직 운영 배포하지 않았습니다.

## 이번에 실행할 파일

파일 위치:

`C:\Users\jsh\.codex\visualizations\2026\08\20\01a01e77-b914-7993-ad98-8ed1af3a1e62\valuation-google-selftest-Code.txt`

이 파일은 현재 API와 별도 검증 코드를 합친 **테스트 전용 파일**입니다. 운영 Code.gs에 덧붙이거나 덮어쓰지 않습니다. 기존 homage decl / AIN Requirements API v2 / DB 백업 사본에는 넣지 않습니다.

실행할 때마다 내 드라이브에 가상 계정용·가상 신고내역용 스프레드시트가 각각 하나씩 만들어집니다. 실제 비밀번호나 원본 DB를 입력하지 않습니다. 생성한 테스트 파일은 삭제하지 않고 점검용으로 남깁니다. 반복 실행하면 테스트 파일이 추가로 생기므로 한 번 실행 후 결과를 확인합니다.

## 따라하기

1. [Apps Script 홈](https://script.google.com/home/my)을 새 탭에서 엽니다. 구글 계정이 jsh79065432@gmail.com인지 확인합니다.
2. **새 프로젝트**를 누릅니다. 왼쪽 위 프로젝트 이름을 **AIN_과세가격_검증용_20260831**로 바꿉니다. 기존 homage decl 편집기가 아닌지 이름을 다시 확인합니다.
3. 위 텍스트 파일의 내용을 전체 복사합니다. 새 프로젝트의 기본 Code.gs 내용만 모두 선택해 교체한 뒤 **저장**합니다.
4. 상단 함수 선택 목록에서 **runValuationGoogleSelfTest**를 선택하고 **실행**을 누릅니다. doPost, initializeValuationSecurity, backupValuationSheets는 선택하지 않습니다.
5. 권한 확인이 나오면 프로젝트 이름과 선택 계정을 확인합니다. 이 테스트는 Google 스프레드시트 생성·수정 권한을 사용합니다. **차단된 앱/액세스 차단**이 나오면 중단하고 그 화면을 보내주세요. 보호 기능을 해제하거나 인증 코드를 복사할 필요는 없습니다.
6. 실행이 끝나면 아래 **실행 로그**의 결과를 캡처해 보내주세요. 완료 여부, PASS/FAIL 항목, HTTP_NOT_TESTED 문구를 확인합니다. 스크립트 속성 값이나 시트의 비밀번호 열은 캡처하지 않습니다.

**배포 버튼은 누르지 않습니다.** 운영 프로젝트 ID에서는 실행을 막는 장치가 있지만, 잘못 붙여 넣어서 소스를 덮어쓰는 행위 자체를 막을 수는 없으므로 반드시 새 프로젝트에서 진행합니다.

## PASS가 의미하는 범위

실제 Google의 스프레드시트 읽기/쓰기·문자 저장·세션 서명·계정 편집·화주별 권한 분리를 편집기 안에서 확인합니다. 로그에는 비밀번호·토큰·세션 키를 출력하지 않습니다.

이 단계는 웹 브라우저의 실제 HTTP POST, 리디렉션, CORS 또는 홈페이지 연동을 검사하지 않습니다. 따라서 PASS는 운영 배포 완료 또는 전체 테스트 완료를 의미하지 않습니다. 다음 단계에서 별도 웹 연동 검증, 현재 운영 버전/전체 원본 코드 기록, 서버·프런트 동시 전환을 진행합니다.

공식 참고: [웹 앱 실행 계정과 권한](https://developers.google.com/apps-script/guides/web#permissions), [Google 서비스 권한 승인](https://developers.google.com/apps-script/guides/services/authorization), [스프레드시트 생성](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#create(String)).
