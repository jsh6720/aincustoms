# 요건관리 백엔드 (Google Apps Script)

`requirements/` 화면이 호출하는 API 다. Google Sheets `Ain_compliance_db` 를 읽고 쓴다.

## 어느 프로젝트인가

프런트엔드가 부르는 주소는 `requirements/js/runtime-config.js` 의 `apiUrl` 이다.
그 주소의 배포 ID 앞부분으로 프로젝트를 찾는다.

| | |
|---|---|
| 프로젝트 | `1PPUc1g44ZVAcNoD96uvYw3lcwn3TKclQziy0CiQ9XF_7550hSO0jSJAm` |
| 편집기 | https://script.google.com/home/projects/1PPUc1g44ZVAcNoD96uvYw3lcwn3TKclQziy0CiQ9XF_7550hSO0jSJAm/edit |
| 활성 배포 | `AIN Requirements API v3 - transient auth fix` |
| 배포 ID | `AKfycbx93MaI-DXXpJv4LladXM__An5FLBNCMxOJZShISHnKWrUc60e3P3Z0BzDdiQImQQdOWg` |
| 스프레드시트 | `1pSbe4A8xOgUDPqTtZCYip4gSCgSp-RzDWuEfS5CxSy4` |

**스프레드시트 메뉴(확장 프로그램 → Apps Script)로 열리는 프로젝트는 이것이 아니다.**
그쪽은 배포 ID 가 `AKfycby3hhpd…` 로 시작하는 옛 프로젝트이며, 화면과 연결돼 있지 않다.
2026-08-31 에 그 옛 프로젝트를 고치다가 한나절을 버렸다. 반드시 배포 ID 로 확인할 것.

## 고치는 순서

1. 위 편집기 링크를 연다
2. `Code.gs` 를 고친다 (이 폴더의 파일과 같은 내용이어야 한다)
3. `Ctrl+S` — 상단 "저장되지 않은 변경사항" 이 사라지는지 확인
4. **배포 → 배포 관리 → ✏️ 수정 → 버전: 새 버전 → 배포**
   - 「새 배포」로 만들면 URL 이 바뀌어 화면이 끊긴다. 반드시 기존 배포를 수정한다
5. 고친 내용을 이 폴더의 `Code.gs` 에도 반영해 커밋한다

## 새 시트를 화면에 붙일 때

`getSheetName()` 의 매핑에 한 줄 추가한다.

```javascript
'radio_exemption': 'AIN_Radio_Exemption',
```

프런트엔드에서는 `fetch('tables/<테이블명>')` 으로 부른다.
`js/google-sheets-api.js` 가 이를 가로채 `action: 'getData'` 로 바꿔 보낸다.

## 권한 처리

`role === 'master'` 가 아니면 `importer` · `company` · `consignee` 중 하나가
로그인 회사명을 포함하는 행만 돌려준다.
영인 계열사(`YOUNGIN_SN_KEYWORDS`)끼리는 서로의 자료를 볼 수 있다.
