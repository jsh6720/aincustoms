# /note 404 복구 및 main 통합

## 원인과 승인

- 2026-09-29 14:13 운영 배포 dpl_38j8Mech11x2aLkZS7erdYrydE8J는 최신 main f942eb1 기반이며 노트 파일이 없었다.
- 기존 정상 노트 배포 dpl_Fn6rdWZnpwoaZt7w16qy3T5PPU8J는 별도 브랜치 직접 배포였고 main 원본 반영은 미완료였다.
- 사용자가 최신 통관 변경 보존 + 노트·할 일 main 통합 + 테스트 후 재배포를 승인했다.

## 보존과 검증

- 작업 전 소스 백업 브랜치 codex/note-pre-main-integration-20260929 = 21c7c23.
- f942eb1을 충돌 없이 병합. cargo-data/cargo-quota/cargo-dashboard 및 cargo-card-merge/cargo-mail-utils/cargo-progress-utils는 최신 main과 동일.
- DB 마이그레이션, 문서/업무 데이터 변경, 메일 발송, 환경변수 수정 없음.
- Vercel buildCommand에 scripts/verify-note-release.cjs 추가. /note·내부 API 라우팅과 필수 9개 파일·해시를 읽기 전용으로 검증. 누락/불일치 시 빌드 실패.
- 전체 Node 검사 767개 중 763개 통과. 나머지 4개는 기존 요건관리 UI/정적 패키지 검사이며 이전 기준 e8ce23b에서도 재현됐고 requirements 파일은 변경하지 않았다.
- 노트/할 일/이미지 브라우저 합성 서버 검사 통과. 드래그 배정, 반복업무, 모바일, 공유 편집, 로그인/로그아웃, 이미지 붙여넣기 포함.
- 운영 비공개 문서를 읽거나 합성 데이터를 운영에 저장하지 않는다.

## 복구 기준

- 단순 운영 롤백은 통관의 최신 수정 또는 노트 페이지를 잃을 수 있으므로 통합본의 검증된 배포를 우선 복구 기준으로 사용한다.
- 새 배포 전 후보 파일/인증 차단 검증, GitHub main fast-forward push, main 자동 배포 및 운영 파일 일치 확인을 순서대로 수행한다.
