# 원본서류 요청 Outlook 일정 연동 (2026-09-09)

## 구현 규칙
- 원본서류 수령 요청 메일의 발송 완료가 확인된 요청만 대상입니다.
- 요청일 오전 09:00~09:30, Korea Standard Time, jsh@aincustoms.com 일정입니다.
- 참석자: jsh@aincustoms.com, jhcho@aincustoms.com, bill@aincustoms.com, ain@aincustoms.com.
- 화주명+B/L별 하나의 일정 ID를 유지합니다. 동일 요청은 무변경, 날짜/담당자/메모 변경은 PATCH입니다.
- Microsoft transactionId, DB 행 잠금과 5분 작업 잠금으로 동시 생성/재시도 중복을 방지합니다.
- 기존 업무 테이블/입력 상태를 수정하지 않습니다. 일정 전용 cargo_receipt_calendar에만 저장합니다.
- Graph 연결 전에는 요청 메일은 정상 발송되고 일정은 대기합니다. 설정 > Outlook 일정 등록 현황에서 확인합니다.
- 실패 건은 관리자 재시도 또는 매일 09:00 KST 예약 실행에서 1건씩 처리합니다.
- 일정 수동 삭제 후 404가 발생하면 자동 재생성하지 않습니다. 관리자가 확인해야 합니다.
- 과거 전체 요청 소급 생성은 하지 않습니다. 이미 생성한 ONEYSYDG03114800은 기존 event ID와 연결했습니다.

## Microsoft 연결 (필수 수동 단계)
1. https://entra.microsoft.com 에서 Microsoft 365 관리자 계정으로 로그인합니다.
2. 앱 등록 > 새 등록: 이름 AIN Cargo Calendar, 이 조직 디렉터리 계정만 선택합니다.
3. 개요에서 디렉터리(테넌트) ID와 애플리케이션(클라이언트) ID를 확인합니다.
4. 인증서 및 비밀에서 클라이언트 비밀을 생성합니다. 비밀은 채팅/공유 코드에 붙이지 않습니다.
5. Microsoft 365 관리자에게 이 앱의 일정 쓰기를 jsh@aincustoms.com 사서함에 한정하여 허용하도록 요청합니다.
   Exchange Online Application RBAC의 Application Calendars.ReadWrite와 해당 사서함 범위를 권장합니다.
   조직 전체 사서함 권한을 부여한 채 방치하지 않습니다.
6. Vercel aincustoms > Settings > Environment Variables > Production에 다음을 저장합니다.
   OUTLOOK_TENANT_ID = 테넌트 ID
   OUTLOOK_CLIENT_ID = 클라이언트 ID
   OUTLOOK_CLIENT_SECRET = 클라이언트 비밀 값 (Sensitive)
   CRON_SECRET = 별도로 생성한 긴 무작위 비밀 (Sensitive)
7. Redeploy 후 관리자 설정 > Outlook 일정 등록 현황에서 대기 건을 확인하고 재시도합니다.
   실제 등록/변경은 참석자에게 초대/변경 메일을 발송합니다.
- Preview에 운영 Microsoft 비밀을 넣지 않습니다.
- Codex의 Outlook 연결은 홈페이지 런타임에 자동 제공되지 않습니다.

## 검증 및 롤백
- node --test test/cargo-outlook-calendar.test.js
- SQL transaction rollback 테스트: 동시 claim 거부, 오래된 요청 덮어쓰기 거부, 작업 중 변경 보존 확인.
- 배포 전 기준 커밋: 84e79a95fb033a4513addb55380677b861bdeced.
- 코드 롤백은 이번 기능 커밋 revert 또는 이전 Vercel 배포로 가능합니다.
- 롤백 때 cargo_receipt_calendar를 삭제하지 않습니다. 기존 이벤트 ID 보존이 재배포 중복 방지에 필요합니다.
- 이번 검증에서는 추가 실제 메일/일정을 발송하지 않습니다.

