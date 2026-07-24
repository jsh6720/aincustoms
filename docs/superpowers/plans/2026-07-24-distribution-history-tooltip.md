# 유통이력 번호 호버 및 양도증 캘린더 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 양도증 수령을 캘린더에서 제외하고, 유통이력 O 배지에서 본인·본레스 신고번호를 선택·복사할 수 있게 한다.

**Architecture:** 기존 `cargo-dashboard.html`의 캘린더 이벤트 생성과 진행현황 상태 렌더링만 수정한다. 데이터는 기존 `distribution_history_override`와 `distribution_history_number`를 사용하며 API와 Supabase 스키마는 변경하지 않는다.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js `node:test`, Python `unittest`, Vercel

## Global Constraints

- 양도증 파일 감지, O/X 상태, 관리자·모바일 관리 기능과 진행현황 열은 유지한다.
- OBL·H/C 수령 이벤트와 다른 캘린더 일정은 유지한다.
- 번호 형식은 `본인:<번호> / 본레스:<번호>`를 유지한다.
- 팝업 텍스트는 마우스로 선택하여 복사할 수 있어야 한다.
- API와 Supabase 스키마는 변경하지 않는다.

---

### Task 1: 양도증 캘린더 이벤트 제거

**Files:**
- Modify: `test/dashboard-source.test.js`
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: `buildProgressCalendarEvents(cards)`의 카드 목록
- Produces: 양도증 이벤트를 포함하지 않는 일정 배열

- [ ] **Step 1: 기존 캘린더 테스트를 변경해 실패를 만든다**

`test/dashboard-source.test.js`에서 양도증 수령 이벤트를 기대하는 검증을 다음과 같이 바꾼다.

```js
assert.ok(events.some((event) => event.text.includes("(OBL, H/C)")));
assert.ok(!events.some((event) => event.type === "transfer"));
assert.ok(!events.some((event) => event.text.includes("(양도증)")));
```

- [ ] **Step 2: 변경한 테스트가 실패하는지 확인한다**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: 양도증 이벤트가 현재 배열에 남아 있어 FAIL.

- [ ] **Step 3: 양도증 이벤트 생성 블록만 제거한다**

`cargo-dashboard.html`의 `buildProgressCalendarEvents`에서 아래 동작을 제거한다.

```js
const transferReceiptDate = actualDate
  || (card.doc_transfer_received ? koreaCalendarDate(card.original_docs_updated_at) : "");
if (transferReceiptDate && card.doc_transfer_received) {
  events.push({ date: transferReceiptDate, type: "transfer", text: `서류수령 ${label} (양도증)` });
}
```

OBL·H/C의 `originalReceiptTypes`와 `type: "actual"` 이벤트 생성은 그대로 둔다.

- [ ] **Step 4: 캘린더 테스트를 다시 실행한다**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: PASS.

### Task 2: 유통이력 번호 검증과 복사 가능한 팝업

**Files:**
- Modify: `test/dashboard-source.test.js`
- Modify: `cargo-dashboard.html`

**Interfaces:**
- Consumes: `card.distribution_history_override`, `card.distribution_history_number`
- Produces: `progressManualStatusToggle(card, "distribution")`의 O/X 배지와 선택 가능한 상세 팝업

- [ ] **Step 1: 렌더링과 입력 검증 테스트를 추가한다**

`test/dashboard-source.test.js`에 다음 동작을 검증한다.

```js
const html = vm.runInContext(
  `progressManualStatusToggle({
    bl_number: "BL001",
    distribution_history_override: "O",
    distribution_history_number: "본인:OWN-123 / 본레스:BONE-456"
  }, "distribution")`,
  context
);
assert.match(html, /distribution-number-wrap/);
assert.match(html, /distribution-number-popover/);
assert.match(html, /본인/);
assert.match(html, /OWN-123/);
assert.match(html, /본레스/);
assert.match(html, /BONE-456/);
assert.match(dashboard, /user-select:\s*text/);
assert.match(dashboard, /유통이력 신고번호를 하나 이상 입력해 주세요/);
```

- [ ] **Step 2: 새 테스트가 실패하는지 확인한다**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: 팝업 클래스와 빈 번호 검증이 없어 FAIL.

- [ ] **Step 3: 신고번호를 표시 행으로 변환하는 헬퍼를 추가한다**

`cargo-dashboard.html`에 기존 저장 문자열을 안전하게 표시하는 함수를 추가한다.

```js
function distributionNumberPopover(number) {
  const text = String(number || "").trim();
  if (!text) return "";
  const rows = text.split(/\s*\/\s*/).filter(Boolean).map((item) => {
    const separator = item.indexOf(":");
    const label = separator >= 0 ? item.slice(0, separator).trim() : "신고번호";
    const value = separator >= 0 ? item.slice(separator + 1).trim() : item;
    return `<span><b>${esc(label)}</b><span>${esc(value)}</span></span>`;
  }).join("");
  return `<span class="distribution-number-popover" role="tooltip">${rows}</span>`;
}
```

- [ ] **Step 4: O 배지를 팝업과 같은 호버 영역으로 감싼다**

유통이력 분기에서 번호가 있는 O 배지를 다음 구조로 렌더링한다.

```js
return `<span class="distribution-number-wrap" tabindex="0">
  <button type="button" class="doc-toggle doc-o"
    onclick="toggleProgressManualStatus(${idx}, 'distribution')">O</button>
  ${distributionNumberPopover(card.distribution_history_number)}
</span>`;
```

번호가 없으면 기존 O/X 버튼만 반환한다. 관리자가 아닌 사용자의 유통이력 열은 기존 역할 규칙에 따라 표시하지 않는다.

- [ ] **Step 5: 팝업을 선택 가능하게 스타일링한다**

`cargo-dashboard.html` CSS에 다음 규칙을 추가한다.

```css
.distribution-number-wrap { position:relative; display:inline-flex; align-items:center; }
.distribution-number-popover {
  display:none;
  position:absolute;
  left:50%;
  bottom:calc(100% + 6px);
  transform:translateX(-50%);
  z-index:90;
  min-width:190px;
  padding:8px 10px;
  border:1px solid #b8c7bd;
  border-radius:6px;
  background:#fff;
  color:#1f2933;
  box-shadow:0 8px 20px rgba(15,23,42,.18);
  text-align:left;
  user-select:text;
}
.distribution-number-wrap:hover .distribution-number-popover,
.distribution-number-wrap:focus-within .distribution-number-popover { display:grid; gap:5px; }
.distribution-number-popover span { display:grid; grid-template-columns:52px minmax(0,1fr); gap:6px; white-space:nowrap; }
```

- [ ] **Step 6: 번호가 하나도 없으면 O 저장을 막는다**

`distributionNumberFromPrompts`의 확인 처리에서 `parts.length === 0`이면 모달을 유지하고 안내한다.

```js
if (!parts.length) {
  alert("유통이력 신고번호를 하나 이상 입력해 주세요.");
  return;
}
bg.remove();
resolve(parts.join(" / "));
```

- [ ] **Step 7: 렌더링 테스트를 다시 실행한다**

Run:

```powershell
node --test test/dashboard-source.test.js
```

Expected: PASS.

### Task 3: 전체 검증, 로컬 미러, 배포

**Files:**
- Modify: `hyundai_dashboard/website_integration/vercel_package/cargo-dashboard.html`
- Modify: `hyundai_dashboard/templates/index.html`

**Interfaces:**
- Consumes: 검증된 홈페이지 `cargo-dashboard.html`
- Produces: 홈페이지와 동일한 로컬 배포 패키지 및 로컬 대시보드 화면

- [ ] **Step 1: 홈페이지 파일을 로컬 미러에 복사한다**

Run:

```powershell
Copy-Item -LiteralPath "Y:\3. Automation\homepage_aincustoms\cargo-dashboard.html" `
  -Destination "Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\website_integration\vercel_package\cargo-dashboard.html" -Force
Copy-Item -LiteralPath "Y:\3. Automation\homepage_aincustoms\cargo-dashboard.html" `
  -Destination "Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard\templates\index.html" -Force
```

- [ ] **Step 2: 홈페이지 전체 테스트를 실행한다**

Run:

```powershell
$tests = Get-ChildItem -LiteralPath "test" -Filter "*.test.js" | ForEach-Object { $_.FullName }
node --test $tests
```

Expected: 모든 Node 테스트 PASS.

- [ ] **Step 3: 로컬 미러 테스트를 실행한다**

Run from `Y:\3. Automation\15. Hyundai corp dashboard`:

```powershell
python -m unittest discover -s hyundai_dashboard\tests -v
```

Expected: 29개 Python 테스트 PASS.

- [ ] **Step 4: 홈페이지 변경을 커밋하고 푸시한다**

Run:

```powershell
git add cargo-dashboard.html test/dashboard-source.test.js
git commit -m "Improve distribution history status details"
git push origin main
```

- [ ] **Step 5: Vercel과 실제 페이지를 확인한다**

GitHub 커밋 상태에서 Vercel `success`를 확인한다. 로그인된 `https://www.aincustoms.com/cargo-dashboard.html`에서 다음을 확인한다.

```text
1. BL별 진행현황 캘린더에 양도증 수령 이벤트가 없음
2. 유통이력 O 배지 호버 시 본인·본레스 번호가 보임
3. 팝업으로 마우스를 이동해 텍스트를 선택할 수 있음
```
