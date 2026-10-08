# 요건관리 검색 지연·로그아웃 점검 — 2026-10-07

## 운영에서 확인한 사실

- 사용자가 별도 Chrome 검증 창에 로그인한 뒤 실제 API 읽기만 수행했다. 계정 비밀번호나 토큰은 출력/파일 저장하지 않았으며, DB 수정·계정 초기화는 하지 않았다.
- 기존 클라이언트에서 Google ContentService 전달 응답 404가 여러 메뉴에서 발생했다. 이후 전파법 조회의 HTTP 200 / JSON UNAUTHORIZED가 실제 세션 삭제와 로그인 화면 전환을 일으켰다.
- 재로그인 직후 토큰의 잔여 유효기간은 480분이었다. 같은 세션의 전파법 단독 조회는 1,110행을 약 3초에 반환했다.
- 기존 요청/캐시 배제 요청 A/B 비교 모두 성공했으므로 캐시를 단독 원인으로 확정할 수 없다.
- 같은 세션에서 화학물질 단독 조회는 41초 후 UNAUTHORIZED를 반환했다. 정확히 어떤 서버 서비스에서 실패했는지는 운영 소스/실행 로그 대조가 필요하다.
- 프런트 수정본을 검증 브라우저에만 적용했을 때 일부 메뉴는 정상 조회됐지만, 화학물질을 포함한 전체 실제 검색 성공은 아직 확인하지 못했다.

## 로컬 수정 (운영 배포 전)

- 전체 조회 대기열/재시도를 90초 이내로 제한하고 네트워크 및 본문 읽기 지연을 종료한다. 단일 읽기는 최대 60초, 최대 2개 동시 요청, 최대 3회 시도를 유지한다. 리뷰에서 20초 제한이 정상적인 느린 응답을 반복 취소함을 발견해 수정했다. 25초 응답 1개 및 16초 응답 7개의 회귀 테스트를 RED/GREEN으로 확인했다.
- 인증된 JSON의 명시적 UNAUTHORIZED와 일반 upstream HTTP 오류를 구분한다. 후자만으로 세션을 지우지 않는다.
- 요청마다 고유 URL과 no-store를 사용해 응답 전달 URL 재사용 가능성을 배제한다. 토큰은 URL에 넣지 않는다.
- 통합검색은 먼저 도착한 결과부터 렌더링한다. 미확인/실패 메뉴를 X 또는 검색결과 없음으로 오인시키지 않고 재시도를 제공한다.
- DB 새로고침은 현재 검색어를 유지해 현재 화면 조회를 즉시 다시 시작한다. 초기화/이전 사용자 응답은 새 화면을 덮지 않는다.
- 기존 미배포 로그인 안내/중복 제출 방지 변경을 보존했다.
- backend verifySessionToken의 광범위 catch가 Google Properties/Utilities 서비스 장애를 UNAUTHORIZED로 잘못 바꾸는 경로를 테스트로 재현했다. 검증 입력 오류만 UNAUTHORIZED로 남기고 서비스 장애는 handleRequest의 INTERNAL_ERROR 경로로 전달하도록 수정했다. Google 로그인 후 실제 배포 버전 7과 수정 전 로컬 백업의 SHA-256이 881d27d6bc487000aad14ecbad4b314ba23d993f7d374dd10410c112d85809bc로 일치함을 확인했다.
- 만료·변조·비활성·auth_version 변경 토큰은 계속 거절한다. 인증기간, 서명키, 회사별 권한, 사용자 DB를 변경하지 않는다.

## 검증과 남은 작업

- 전체 787개 시험 통과, note 릴리스 보존 검사 통과. 별도 읽기 전용 코드 리뷰의 Important 1건을 수정한 뒤 재검토에서 추가 Critical/Important 없음 판정을 받았다. 운영 검색 성공을 의미하지 않는다.
- 로컬 모의 브라우저에서 STD72110-01 부분 결과와 실패 메뉴/재시도 버튼의 실제 렌더링을 확인했다. 이 모의 결과는 운영 데이터 검증이 아니다.
- 로컬 소스 기준 롤백 참조: HEAD 9579df675a145c5069946077d5fafc1ffc878a3d. 운영 Apps Script는 별도 버전 백업/대조 후 기존 배포 ID로 업데이트해야 한다.
- 운영 Google Apps Script 프로젝트: 1PPUc1g44ZVAcNoD96uvYw3lcwn3TKclQziy0CiQ9XF_7550hSO0jSJAm. 다른 valuation 프로젝트와 혼동 금지.
- Google 로그인 완료 후 수정본 저장을 별도 편집기 탭에서 다시 읽어 검증했다. 저장본 SHA-256은 0f2434a9984d3ab9e3c970612d7da773a07ad2da273507c06f78ac44eaae36b4로 로컬 수정본과 일치한다. 기존 활성 배포 ID와 버전 7을 확인했으며, 서명키/계정/DB/배포 권한은 변경하지 않았다.
- 2026-10-07 18:03 KST 동일한 Apps Script 배포 ID를 버전 8로 업데이트했다. 배포 관리의 완료 문구/버전/ID로 확인했다. 버전 7로 롤백 가능하다. 프런트 배포 및 화학물질·MSDS 대량 읽기, 실제 STD72110-01/72110 검색·세션 유지 검증이 남아 있다.

## 후속 재현과 확정 원인

- 프런트 275ccdb / Apps Script 버전 8 반영 후에도 화학물질 조회에서 재발했다. 앞의 광범위 catch 수정과 캐시 배제만으로 해결됐다고 판단하지 않는다.
- 실제 브라우저 요청 이력에서 인증된 POST getData → ContentService echo GET → 원래 /exec로 본문 없는 GET 재전달 → UNAUTHORIZED 응답을 확인했다. 재전달 GET에는 action/token/body가 모두 없었다. 정상 요청의 인증 정보 유실을 잘못된 인증으로 분류한 것이 로그아웃의 직접 원인이다. Google 전달 주소가 다시 /exec로 돌아오는 플랫폼 내부 이유까지 확정한 것은 아니다.
- action 없는 요청은 데이터 없이 REQUEST_INCOMPLETE를 반환하고, 클라이언트는 읽기에 한해 원래 인증된 요청을 기존 횟수/시간 제한 내에서 재시도한다. 완전한 getData 요청의 토큰 누락·만료·변조는 계속 차단하며 쓰기는 자동 재시도하지 않는다.
- 2개 실패 시험을 먼저 확인하고 수정 후 전체 790개 시험 및 note 릴리스 보존 검사 통과. 별도 리뷰에서 34개 관련 시험 재실행 통과, Critical/Important 없음. 운영 성공 여부는 아래 실제 검증 결과로 별도 판단한다.
- 저장 후 다시 읽은 Apps Script 소스 SHA-256: c0dea25e356b312bc6afa3ac919cc724064c77a34649d33c57c7e4bc828220f0. 후속 수정 롤백 지점은 275ccdb / Apps Script 버전 8이다.

## 적용 스킬

- import-requirement-review, Obsidian 이전 지식 확인, UI/UX, Playwright 지침 적용.
- 최초 점검 당시 지정된 Superpowers 경로와 Ponytail 설치가 없었으나, 이후 설치 목록 갱신으로 canonical 개인 스킬을 사용할 수 있게 됐다. 현재 using-superpowers, systematic-debugging, ponytail, test-driven-development, verification-before-completion, requesting-code-review 지침을 읽고 적용했다. 최소 원인 수정과 별도 코드 리뷰, 느린 정상 응답 재현 시험을 수행했다.

## 2026-10-08 서버 통합검색

- 운영(98a0f7b) 실측: 통합검색이 7개 시트 전체를 각각 내려받음 — 화학물질 6,024행/약 4MB, MSDS 12,685행/약 3.2MB, 시트당 2.5~28초. 동시 2개 제한과 대기열 포함 90초 예산 때문에 마지막 순서인 확인필요 List가 "조회 실패 (미확인)"로 표시됐다. 같은 측정에서 radio_law UPSTREAM_ERROR, non_target REQUEST_INCOMPLETE 간헐 실패도 재현.
- 72110은 AIN_Review_Needed `STD72110-01`(영인에스티, 화관법·화평법 확인필요)로 존재하며 클라이언트 필터 자체는 정상 매칭된다. 미조회는 데이터 전송 실패 때문이다.
- Apps Script에 `search` 액션 추가: 요청 1건으로 7개 시트를 서버에서 같은 필드·정규화로 걸러 권한 통과 행만 반환, 시트별 실패는 `failed`로 구분. 프런트는 이를 우선 사용하고 `UNKNOWN_ACTION`(구버전 백엔드)일 때만 기존 시트별 조회로 대신한다.
- 배포: 프런트 e7ec2a7 main 푸시(Vercel Production). Apps Script는 편집기 소스가 98a0f7b(CRLF)와 SHA c0dea25e…로 일치함을 확인한 뒤 새 소스(SHA 0ee49668…)로 교체·저장하고 같은 배포 ID를 버전 10으로 업데이트했다. 롤백은 버전 9.
- 운영 확인: `search` 단독 8.4초, 실제 통합검색 UI 10~11초에 7개 메뉴 모두 응답, `72110`·`STD72110-01` 모두 확인 필요 List O(영인에스티, VEOLIA)로 표시. 이전 방식은 시트별 순차 측정 합계 약 80초에 2개 메뉴 실패.

## 2026-10-08 간헐 실패 (REQUEST_INCOMPLETE·UNAUTHORIZED) 개선

- 재현: 페이지 접속 직후(대시보드가 시트 6개 전체 약 9MB를 받는 구간)에 다른 조회를 겹치면, 평소 2~7초인 요청이 13~38초 걸린 뒤 REQUEST_INCOMPLETE 또는 JSON이 아닌 응답으로 끝났다. 접속 후 안정된 상태에서는 같은 요청이 모두 성공. 같은 구간에서 정상 토큰이 UNAUTHORIZED로 2회 거절되고 다음 요청은 성공한 사례도 관측(클라이언트 토큰 변경 없음 확인).
- 판단: 접속 직후 대용량 동시 실행이 Apps Script 응답 전달(echo 리다이렉트) 유실을 유발한다. UNAUTHORIZED는 서버 측 일시 거절로 보이나 어느 검사인지 미확정.
- 조치: 대시보드는 `stats` 액션 1건으로 건수만 받는다(시트 전체 다운로드 제거, 구버전 백엔드에선 기존 방식). 읽기 요청은 UNAUTHORIZED를 1회 재확인 후에만 로그아웃한다(진짜 만료·변조 토큰은 재확인에서도 거절되어 기존대로 차단). 서버는 토큰을 남기지 않고 어느 검사에서 거절했는지만 실행 로그에 남긴다(`UNAUTHORIZED signature|auth_version|user_missing…`). 다음 재발 시 Apps Script 실행 로그에서 원인 검사를 확인할 것.
- 배포: 9883e0a main 푸시, Apps Script 편집기 소스가 버전 10(SHA 0ee49668…)과 일치함을 확인 후 교체(SHA 6fe6a2db…), 같은 배포 ID 버전 11. 롤백은 버전 10.
- 원인 확정(16:36~16:50 KST): 브라우저·쿠키·사이트 코드 없이 curl 로 잘못된 토큰 POST 30회 → 정상(UNAUTHORIZED) 17, REQUEST_INCOMPLETE 5, Google Drive "페이지를 찾을 수 없음" HTML 8. 실패 시 echo URL(script.googleusercontent.com)이 저장된 결과를 주지 않고 302로 `/exec`(쿼리 없음)에 되돌려 보내 본문 없는 GET 이 새로 실행되거나, echo 결과 자체를 찾지 못한다. 요청당 약 19초로 평소(약 1초)보다 크게 느렸다. Apps Script 웹앱 결과 전달 계층의 장애이며 사이트 코드로는 재시도·요청 수 축소로 완화만 가능하다.
- v11 측정 중 UNAUTHORIZED 는 같은 시각(16:31:16) 해당 브라우저에서 재로그인이 있어 세션 교체 영향과 구분되지 않는다. 실행 화면에는 사유 로그가 보이지 않아 확인하지 못했다(Cloud Logging 연결 필요).
- 근본 대안: 읽기 경로를 Apps Script 웹앱 대신 Vercel 서버리스(api/) → Google Sheets API(서비스 계정)로 옮기면 echo 리다이렉트 계층이 사라진다. 서비스 계정 키·시트 공유·토큰 서명키 이관이 필요하다.
