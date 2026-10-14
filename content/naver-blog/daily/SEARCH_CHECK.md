# 검색 노출 확인 (1회 예약 작업)

아인합동관세사무소 홈페이지(https://www.aincustoms.com)가 검색엔진에 노출되는지 확인하고 jsh@aincustoms.com으로 보고한다.

1. Aside(`aside exec --effort medium "<읽기 전용 지시>"`)로 아래 검색어를 **구글(google.com)·네이버(search.naver.com)·빙(bing.com)** 에서 각각 검색하고, 첫 페이지에 aincustoms.com 또는 blog.naver.com/aincustoms_ 가 몇 번째로 나오는지 기록한다(광고 제외, 클릭·로그인·설정 변경 금지):
   - 아인합동관세사무소
   - 아인 관세사
   - 관세사
   - 강남 관세사
   - 관세심사 대응 관세사
2. 웹마스터 도구 상태(읽기 전용):
   - 구글 서치 콘솔(aincustomskr@gmail.com, 속성 aincustoms.com): Sitemaps 상태, '페이지' 색인 생성된 수.
   - 네이버 서치어드바이저(www.aincustoms.com): 수집 현황, 사이트맵 상태.
   - 빙 웹마스터: aincustoms.com 색인 페이지 수.
3. "아인합동관세사무소" 검색에서 홈페이지가 **안 나오는 엔진**이 있으면 그 엔진에서만 색인 요청을 다시 넣는다:
   - 구글: URL 검사 → https://www.aincustoms.com/ → 색인 생성 요청
   - 네이버: 요청 → 웹 페이지 수집 → https://www.aincustoms.com/
   - 빙: URL 제출 → https://www.aincustoms.com/
4. 결과를 `daily/out/search-check-<날짜>/report.html`(1단 세로 구성, 표 금지, 모든 스타일 inline)로 만들고
   `powershell -NoProfile -ExecutionPolicy Bypass -File content/naver-blog/daily/send-report.ps1 -Subject "[홈페이지] 검색 노출 점검 결과 (<날짜>)" -HtmlFile "<절대경로>"` 로 보낸다.
   본문: 검색어×엔진별 순위(없으면 '첫 페이지 없음'), 웹마스터 도구 상태, 다시 넣은 색인 요청, 다음에 할 일 3줄.
5. 끝나면 이 작업을 스케줄러에서 지운다: `schtasks /Delete /TN "AinCustoms-SearchCheck-Once" /F`
