# 카드뉴스 포스트 데이터 스키마 (`window.POST`)

`template.html` 은 `window.POST` 객체 하나로 포스트 전체를 렌더한다. 카드는 `cards` 배열 순서대로 그려지고 페이지 번호 `n / N` 은 자동이다. 문자열은 기본적으로 HTML 이스케이프된다. 아래에 "HTML 허용"이라고 표시된 필드만 `<em>`, `<b>`, `<span class="date">`, `<span class="nowrap">` 태그를 쓸 수 있다.

## 최상위

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| category | `"case" \| "hs" \| "fta" \| "news" \| "req" \| "guide"` | 필수 | 강조색 선택. case 주요 판례(법원·조세심판) / hs 품목분류 / fta FTA·원산지 / news 관세 뉴스(제도 변경) / req 수입요건 / guide 통관 가이드(절차 안내) |
| categoryLabel | string | 필수 | 상단 칩 문구. 예: "주요 판례", "품목분류", "FTA·원산지", "관세 뉴스" |
| series | string | 필수 | 시리즈 마크. 항상 "아인관세 인사이트" |
| writtenAt | string | 필수 | 작성월. 출처 카드 면책 뒤에 "(작성 2026. 10.)" 로 표기 |
| cards | Card[] | 필수 | 7~8개. 권장 순서: cover, conclusion, facts, issue, compare, ruling, checklist, source |

공통 보조 타입

```ts
type Ref = { label?: string; value: string };   // 근거 칩: "● label value"  예) {label:"관세법", value:"제42조의2 제1항 제7호"}
```

## 카드 타입

### 1. cover (표지, 남색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| type | "cover" | 필수 | |
| kicker | string | 선택 | 제목 위 한 줄(34px). 예: "2026. 3. 31. 조세심판원 결정" |
| title | string | 필수 | 제목 20~28자, 2~3줄. 질문형 권장 |
| watermark | string | 선택 | 외곽선 워터마크. 조문("제42조의2") 또는 사건번호("2026관0002"). 길면 우측으로 잘려 나가도 됨(의도) |
| refs | Ref[] | 필수 | 1~2개. 사건번호/조문 + 선고일/시행일 |

### 2. conclusion (결론 먼저, 흰색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "결론 먼저" |
| statement | string (HTML 허용) | 필수 | 결론 한 문장 60자 이내. 강조어는 `<em>…</em>` 2개 이내 |
| note | string | 선택 | 보충 한 줄 (34px) |
| impact | {k,v}[] | 필수 | 2개 권장: `{k:"영향 대상", v:…}`, `{k:"기준일", v:…}` |

### 3. facts (사실관계·배경, 흰색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "사실관계" 또는 "배경" |
| lead | string | 선택 | 리드 문장 60자 이내 |
| rows | {k: string, v: string(HTML 허용)}[] | 필수 | 3~5행. 라벨 6자 이내. 값 안 핵심은 `<b>` (강조색) |

### 4. issue (쟁점과 근거, 연청)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "쟁점과 근거" |
| question | string | 필수 | 쟁점 질문 30자 이내 |
| text | string | 선택 | 한 줄 답/배경 60자 이내 |
| statute | object | 필수 | 조문 박스 |
| statute.name | string | 필수 | 조문명. 예: "관세법 제42조의2 제1항 제7호" |
| statute.meta | string[] | 필수 | 메타 칩 1~3개. 시행일은 반드시 포함: "시행 2026. 1. 1.", "법률 제21208호" |
| statute.quote | string | 선택 | 조문 원문 인용 60자 이내, 생략은 "…" |

### 5. compare (비교, 흰색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "변경 전 · 후" 또는 "양측 주장" |
| mode | "change" \| "parties" | 필수 | change: 연결 표시 ↓ (종전→개정). parties: "vs" (세관 vs 수입자) |
| a | Side | 필수 | 위 박스 (회색 테두리): 변경 전 / 처분청·세관 주장 |
| b | Side | 필수 | 아래 박스 (강조색 테두리): 변경 후 / 청구인·수입자 주장 또는 판단이 채택한 쪽 |

```ts
type Side = { label: string; title: string; bullets?: string[] };  // title 20자, bullets 1~3개 각 40자 이내
```

### 6. ruling (판단·결정 요지, 남색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "판단" / "결정 요지" / "요지" |
| seal | string | 필수 | 인장 결과어 2~4자, 결정문 용어 그대로: "기각", "인용", "취소", "시행 중". 3자 이상이면 자동 축소 |
| head | string | 필수 | 헤드라인 20자 이내 (2줄) |
| points | {yes: boolean, text: string}[] | 필수 | 2~4개. yes=true ○ (인정·면제·적용), false × (불인정·제외). 각 30자 이내 |
| foot | Ref | 선택 | 하단 근거 칩. 예: {label:"근거", value:"관세법 제131조, 제128조 제1항 제3호"} |

### 7. checklist (실무 체크리스트, 흰색)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "실무 체크리스트" |
| head | string | 선택 | 헤드라인. 기본 "우리 회사는 이렇게" |
| items | {t: string, d?: string}[] | 필수 | 정확히 3개 권장. t 제목 16자 이내, d 설명 40자 이내 |
| refs | Ref[] | 선택 | 하단 칩. 관련 글 등 |

### 7b. steps (절차·동선, 흰색) — 실무 안내 글에서 checklist 대신 또는 함께 사용
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| type | "steps" | 필수 | |
| tag | string | 필수 | 예: "입국 동선", "신청 절차" |
| head | string | 선택 | 헤드라인 20자 이내 |
| steps | {t: string, d?: string}[] | 필수 | 3~5개, 순서대로 1·2·3… 원형 번호와 연결선이 붙음. t 16자 이내, d 28자 이내(1~2줄) |
| refs | Ref[] | 선택 | 하단 칩 |

### 8. source (출처 + CTA, 연청)
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| tag | string | 필수 | "출처" |
| sources | {kind: string, text: string(HTML 허용)}[] | 필수 | 2~4행. kind: "판례" / "심판례" / "법령" / "원문". 사건·결정번호와 결정일, 법령명·법률번호·시행일(`<span class="date">시행 2026. 1. 1.</span>`)을 포함. 마지막 행은 kind "원문" 으로 "원문: law.go.kr 등" (회색으로 표시) |
| caveat | string (HTML 허용) | 선택 | 면책 문구. 줄바꿈 위치는 `<br>`. 뒤에 "(작성 writtenAt)" 자동 추가 |
| cta | object | 필수 | |
| cta.title | string | 필수 | 질문형 한 줄 24자 이내 |
| cta.sub | string | 필수 | "아인합동관세사무소에 문의하세요" |
| cta.site | string | 필수 | "aincustoms.com" |
| cta.tel | string | 필수 | "02-518-5435" |

## 최소 예시 (판례 토픽, 7장: facts 를 issue 에 흡수)

```js
window.POST = {
  category: "hs", categoryLabel: "품목분류", series: "아인관세 인사이트", writtenAt: "2026. 10.",
  cards: [
    { type: "cover", kicker: "2026. 3. 31. 조세심판원 결정", title: "합판 vs LVL, 가로결 23%가 관세를 갈랐다",
      watermark: "2026관0002", refs: [ { label: "조심", value: "2026관0002" }, { label: "결정", value: "2026. 3. 31. 인용" } ] },
    { type: "conclusion", tag: "결론 먼저",
      statement: "가로결 단판이 일부 섞여도 <em>LVL</em>로 보아 합판 분류에 따른 덤핑방지관세 처분이 <em>취소</em>됐습니다.",
      impact: [ { k: "영향 대상", v: "적층 목재(문틀·건축재) 수입자" }, { k: "기준", v: "개별 사건 판단, 일반화 금지" } ] },
    { type: "issue", tag: "쟁점과 근거", question: "직교단판이 섞이면 무조건 합판일까?",
      text: "문틀용 적층목재 17장 중 가로결 4장, 직교비율 약 23.5%였습니다.",
      statute: { name: "HSK 4412.39-9000 (합판) vs 4412.4x (LVL)", meta: [ "관세법 제131조", "제128조 제1항 제3호" ], quote: "…" } },
    { type: "compare", tag: "양측 주장", mode: "parties",
      a: { label: "세관", title: "단판 하나라도 교차하면 합판", bullets: [ "기존 분류사례도 같은 취지" ] },
      b: { label: "조세심판원", title: "직교단판이 약간 있어도 LVL", bullets: [ "HS 해설서, KS·일본 규격 근거" ] } },
    { type: "ruling", tag: "결정 요지", seal: "인용", head: "합판 분류에 따른 처분은 취소",
      points: [ { yes: true, text: "직교비율 약 23.5%는 LVL" }, { yes: false, text: "'교차 단판 1장 = 합판' 논리" } ],
      foot: { label: "근거", value: "관세법 제131조, 제128조 제1항 제3호" } },
    { type: "checklist", tag: "실무 체크리스트", items: [ { t: "직교비율 자료를 건별로 확보" }, { t: "애매하면 품목분류 사전심사" }, { t: "동종 사건(2025관0097) 결과 확인" } ] },
    { type: "source", tag: "출처",
      sources: [ { kind: "심판례", text: "<b>조세심판원 조심 2026관0002</b> · <span class='date'>2026. 3. 31.</span> 인용" },
                 { kind: "법령", text: "<b>관세법 제131조, 제128조 제1항 제3호</b>" },
                 { kind: "원문", text: "원문: 조세심판원 결정례 검색(tt.go.kr), law.go.kr 등" } ],
      caveat: "개별 사건 판단이며 '30% 이하면 LVL' 식 일반화는 불가. 법률 자문이 아닙니다.",
      cta: { title: "우리 목재도 LVL일까?", sub: "아인합동관세사무소에 문의하세요", site: "aincustoms.com", tel: "02-518-5435" } }
  ]
};
```

## 검증 규칙 (렌더 전 체크)
- 카드 수 7~8, 첫 카드 cover, 마지막 카드 source.
- 모든 카드에 tag(표지 제외) 존재. source.sources 에 시행일 또는 결정일이 하나 이상, "원문:" 행 존재.
- 본문 문자열 60자, 헤드라인 20자, cover.title 28자 초과 시 글을 줄인다(크기 축소 금지).
- `node render.mjs` 출력이 전부 `ok` (overflow 없음).
