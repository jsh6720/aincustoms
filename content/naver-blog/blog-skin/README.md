# 아인관세 인사이트 — 네이버 블로그 꾸미기

카드뉴스(`../design/design-spec.md`)와 같은 디자인 언어를 블로그 외관에 적용한다:
남색 #0f172a 바탕, 모서리 등록 마크, 카테고리별 강조색 점, Pretendard, 로고 흰색 반전.

| 에셋 | 크기 | 쓰는 곳 |
|---|---|---|
| `out/title.png` | 966 x 300 | PC 타이틀 이미지 (블로그 제목 텍스트는 숨김; 이미지에 포함) |
| `out/profile.png` | 600 x 600 | 프로필 이미지 (원형 크롭에도 중앙 마크가 남음) |
| `out/banner-home.png` | 170 x 210 | 사이드바 위젯 → https://www.aincustoms.com/ |
| `out/banner-contact.png` | 170 x 210 | 사이드바 위젯 → https://www.aincustoms.com/#contact |
| `out/mcover.png` | 1080 x 720 | 모바일 홈 커버 |

다시 만들기: `PLAYWRIGHT_DIR=C:/Users/jsh/AppData/Local/aincustoms-cardnews/pw node render.mjs`

## 적용 원칙
- 스킨은 흰 바탕 기본형, 포인트 색은 남색/브랜드 블루만. 장식 위젯(달력·카운터·방문자 그래프·지원 종료 위젯)은 끈다.
- 사이드바 순서: 프로필 → 상담 배너 → 카테고리 → 검색 → 인기글 → 태그 → 홈페이지 배너.
- 글 목록은 카드뉴스 표지가 보이도록 앨범형(썸네일) 우선.
