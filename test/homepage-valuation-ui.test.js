const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homepage = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const valuationHelperPath = path.join(__dirname, "..", "lib", "valuation-ui.js");

test("homepage shows the approved valuation-management name everywhere", () => {
  const matches = homepage.match(/과세가격 일괄제출 관리/g) || [];

  assert.equal(matches.length, 3);
  assert.doesNotMatch(homepage, /관세성실신고 조회/);
});

test("homepage team section contains only the three retained customs brokers", () => {
  const teamSection = homepage.match(/<section id="team"[\s\S]*?<\/section>/)?.[0] || "";
  const cards = teamSection.match(/class="team-member/g) || [];

  assert.equal(cards.length, 3);
  assert.doesNotMatch(teamSection, /김로언 관세사|kim-roeun\.jpg/);
});

test("homepage loads the isolated valuation-management helper", () => {
  assert.equal(fs.existsSync(valuationHelperPath), true);
  assert.match(homepage, /<script src="\.\/lib\/valuation-ui\.js"><\/script>/);
});

const valuationUi = require(valuationHelperPath);

function valuationFunction(name) {
  assert.equal(typeof valuationUi[name], "function", `${name} must be exported`);
  return valuationUi[name];
}

const records = [
  { data: ["영인에이티", "ACME", "T/T", "일반", "FOB", "12345"], originalIndex: 0 },
  { data: ["다른화주", "Beta HMT", "L/C", "특수", "CIF", "67890"], originalIndex: 1 },
  { data: ["영인에이티", "Gamma", "T/T", "일반", "EXW", "=2+3"], originalIndex: 2 },
];

test("valuation filters combine the global keyword and field filters without mutating source rows", () => {
  const filterRecords = valuationFunction("filterRecords");
  const before = JSON.stringify(records);

  const filtered = filterRecords(records, {
    keyword: "hmt",
    payment: "l/c",
  });

  assert.deepEqual(filtered.map((item) => item.originalIndex), [1]);
  assert.equal(JSON.stringify(records), before);
});

test("valuation company search treats corporate-form variants as the same company", () => {
  const filterRecords = valuationFunction("filterRecords");
  const companySearchKey = valuationFunction("companySearchKey");
  const source = [
    { data: ["영인에스티(주)", "A", "T/T", "일반", "FOB", "1"], originalIndex: 10 },
    { data: ["(주) 영인 에스티", "B", "T/T", "일반", "FOB", "2"], originalIndex: 11 },
    { data: ["영인에이티", "C", "T/T", "일반", "FOB", "3"], originalIndex: 12 },
  ];
  const before = JSON.stringify(source);

  assert.equal(companySearchKey("㈜ 영인 에스티"), "영인에스티");
  assert.equal(companySearchKey("영인에스티 (주)"), "영인에스티");
  assert.notEqual(companySearchKey("A-B"), companySearchKey("AB"));
  assert.notEqual(companySearchKey("A&B"), companySearchKey("AB"));
  assert.notEqual(companySearchKey("영인에스티 유한회사"), companySearchKey("영인에스티 주식회사"));
  assert.deepEqual(
    filterRecords(source, { company: "주식회사 영인에스티" }).map((item) => item.originalIndex),
    [10, 11]
  );
  assert.deepEqual(
    filterRecords(source, { keyword: "(주)영인에스티" }).map((item) => item.originalIndex),
    [10, 11]
  );
  assert.deepEqual(
    filterRecords(source, { company: "(주)" }).map((item) => item.originalIndex),
    [10, 11]
  );
  assert.equal(JSON.stringify(source), before);
});

test("valuation company autocomplete collapses equivalent corporate-form labels", () => {
  const dedupeCompanyNames = valuationFunction("dedupeCompanyNames");

  assert.deepEqual(
    dedupeCompanyNames(["영인에스티(주)", "(주) 영인 에스티", "영인에스티", "다른화주"]),
    ["영인에스티", "다른화주"]
  );
});

test("valuation sorting is stable and keeps blank values at the end", () => {
  const sortRecords = valuationFunction("sortRecords");
  const source = [
    { data: ["B", "", "", "", "", "2"], originalIndex: 0 },
    { data: ["A", "", "", "", "", "1"], originalIndex: 1 },
    { data: ["", "", "", "", "", "3"], originalIndex: 2 },
    { data: ["A", "", "", "", "", "4"], originalIndex: 3 },
  ];

  const sorted = sortRecords(source, 0, "asc");

  assert.deepEqual(sorted.map((item) => item.originalIndex), [1, 3, 0, 2]);
  assert.deepEqual(source.map((item) => item.originalIndex), [0, 1, 2, 3]);
});

test("valuation pagination clamps an out-of-range page and reports its visible range", () => {
  const paginateRecords = valuationFunction("paginateRecords");
  const source = Array.from({ length: 53 }, (_, index) => ({
    data: [String(index)],
    originalIndex: index,
  }));

  const page = paginateRecords(source, 99, 25);

  assert.equal(page.page, 3);
  assert.equal(page.totalPages, 3);
  assert.equal(page.start, 51);
  assert.equal(page.end, 53);
  assert.deepEqual(page.items.map((item) => item.originalIndex), [50, 51, 52]);
});

test("valuation HTML escaping keeps spreadsheet content inert", () => {
  const escapeHtml = valuationFunction("escapeHtml");

  assert.equal(
    escapeHtml(`<img src=x onerror="boom()">'&`),
    "&lt;img src=x onerror=&quot;boom()&quot;&gt;&#39;&amp;"
  );
});

test("valuation CSV preserves Korean and commas while neutralizing spreadsheet formulas", () => {
  const buildCsv = valuationFunction("buildCsv");
  const csv = buildCsv(records);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /화주명,해외거래처명,결제방법,거래구분,인도조건,신고번호/);
  assert.match(csv, /영인에이티,Gamma,T\/T,일반,EXW,'=2\+3/);
  assert.match(buildCsv([{ data: ["화주,주식회사", "", "", "", "", "1"] }]), /"화주,주식회사"/);
  assert.match(buildCsv([{ data: ["\t=2+3", "", "", "", "", "1"] }]), /'\t=2\+3/);
  assert.match(buildCsv([{ data: [" \r\n@SUM(A1:A2)", "", "", "", "", "1"] }]), /' @SUM|"' \r\n@SUM/);
});

test("account rows accept only a password-free server contract", () => {
  const sanitizeAccountRows = valuationFunction("sanitizeAccountRows");
  const sanitized = sanitizeAccountRows([
    { id: "client", company: "화주사", rowIndex: 7 },
  ]);

  assert.deepEqual(sanitized, [
    { id: "client", company: "화주사", originalIndex: 7 },
  ]);
  assert.equal(sanitizeAccountRows([["client", "plain-secret", "화주사"]]), null);
  assert.equal(sanitizeAccountRows([{ id: "client", company: "화주사" }]), null);
});

test("account update payload keeps the id fixed and includes only an entered replacement password", () => {
  const buildAccountUpdatePayload = valuationFunction("buildAccountUpdatePayload");
  const isProtectedAccountId = valuationFunction("isProtectedAccountId");
  const account = { id: "client", company: "기존화주", originalIndex: 7 };

  assert.deepEqual(buildAccountUpdatePayload(account, " 변경 화주 ", ""), {
    rowIndex: 7,
    id: "client",
    company: "변경 화주",
  });
  assert.deepEqual(buildAccountUpdatePayload(account, "변경 화주", " new-secret "), {
    rowIndex: 7,
    id: "client",
    company: "변경 화주",
    password: " new-secret ",
  });
  assert.equal(buildAccountUpdatePayload(account, "변경 화주", "   "), null);
  assert.equal(buildAccountUpdatePayload({ ...account, id: "aincustoms" }, "AIN", "x"), null);
  assert.equal(isProtectedAccountId(" AINCUSTOMS "), true);
  assert.equal(isProtectedAccountId("client"), false);
});

test("new valuation records reject duplicate company and declaration pairs", () => {
  const validateDutyRecord = valuationFunction("validateDutyRecord");

  assert.deepEqual(
    validateDutyRecord(["영인에이티", "신규", "T/T", "일반", "FOB", "12345"], records),
    { valid: false, message: "같은 화주와 신고번호가 이미 존재합니다." }
  );
  assert.deepEqual(
    validateDutyRecord(["(주) 영인에이티", "신규", "T/T", "일반", "FOB", "12345"], records),
    { valid: false, message: "같은 화주와 신고번호가 이미 존재합니다." }
  );
  assert.deepEqual(
    validateDutyRecord(["영인에이티", "신규", "T/T", "일반", "FOB", "NEW-1"], records),
    { valid: true, message: "" }
  );
});

test("valuation API responses reject HTML and HTTP failures without leaking upstream content", () => {
  const parseApiResponse = valuationFunction("parseApiResponse");

  assert.deepEqual(parseApiResponse(200, '{"success":true,"data":[]}'), {
    success: true,
    data: [],
  });
  assert.deepEqual(parseApiResponse(200, "<!DOCTYPE html><title>blocked</title>"), {
    success: false,
    message: "서버 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해주세요.",
  });
  assert.deepEqual(parseApiResponse(503, "internal-secret"), {
    success: false,
    message: "서버 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.",
  });
  assert.deepEqual(
    parseApiResponse(200, '{"success":false,"message":"database/internal-secret"}', "login"),
    { success: false, message: "아이디 또는 비밀번호를 확인해주세요." }
  );
});

test("valuation response normalizers reject malformed rows and strip unexpected user fields", () => {
  const normalizeDutyRows = valuationFunction("normalizeDutyRows");
  const normalizeUser = valuationFunction("normalizeUser");
  const sanitizeAccountRows = valuationFunction("sanitizeAccountRows");

  assert.deepEqual(normalizeDutyRows([["A", "B", "C", "D", "E", 123]]), [
    ["A", "B", "C", "D", "E", "123"],
  ]);
  assert.equal(normalizeDutyRows([["A", "B"], null]), null);
  assert.deepEqual(
    normalizeUser({ username: "master", company: "AIN", isMaster: true, password: "secret", token: "signed.token", expiresAt: 12345 }),
    { username: "master", company: "AIN", isMaster: true, token: "signed.token", expiresAt: 12345 }
  );
  assert.equal(normalizeUser({ username: "master", company: "AIN", isMaster: "yes" }), null);
  assert.equal(sanitizeAccountRows([{ id: "client", company: "화주", rowIndex: 1 }, null]), null);
});

test("valuation API calls use bounded requests and the safe response parser", () => {
  assert.match(homepage, /new AbortController\(\)/);
  assert.match(homepage, /ValuationUI\.parseApiResponse\(response\.status, responseBody, action\)/);
  assert.doesNotMatch(homepage, /return await response\.json\(\)/);
});

test("valuation async responses and mutations are scoped to the active login session", () => {
  assert.match(homepage, /let loginAttemptGeneration = 0/);
  assert.match(homepage, /let valuationSessionGeneration = 0/);
  assert.match(homepage, /let accountLoadGeneration = 0/);
  assert.match(homepage, /function isValuationSessionCurrent\(/);
  assert.match(homepage, /const loginAttempt = \+\+loginAttemptGeneration/);
  assert.match(homepage, /loginAttempt !== loginAttemptGeneration/);
  assert.match(homepage, /function beginValuationMutation\(/);
  assert.match(homepage, /function isValuationMutationCurrent\(/);
  assert.match(homepage, /let dutyMutationInFlight = false/);
  assert.match(homepage, /let accountMutationInFlight = false/);
});

test("valuation reload and edits reapply visible filters", () => {
  assert.match(homepage, /allDutyData = normalizedRows\.map[\s\S]*?applyFilters\(\);/);
  assert.match(homepage, /updatedItem\) updatedItem\.data = newData;[\s\S]*?applyFilters\(\);/);
});

test("valuation screen exposes practical search, sorting, export, selection, and pagination controls", () => {
  for (const id of [
    "filterKeyword",
    "valuationRefreshButton",
    "valuationCsvButton",
    "copySelectedButton",
    "sortColumn",
    "sortDirection",
    "pageSize",
    "selectVisibleRows",
    "previousPageButton",
    "nextPageButton",
    "pageIndicator",
  ]) {
    assert.match(homepage, new RegExp(`id="${id}"`), `${id} should exist`);
  }

  assert.match(homepage, /ValuationUI\.filterRecords/);
  assert.match(homepage, /ValuationUI\.sortRecords/);
  assert.match(homepage, /ValuationUI\.paginateRecords/);
  assert.match(homepage, /ValuationUI\.buildCsv/);
});

test("valuation screen does not render returned passwords or interpolate raw sheet values into handlers", () => {
  assert.match(homepage, /ValuationUI\.sanitizeAccountRows/);
  assert.doesNotMatch(homepage, /function togglePassword|allAccountData\[index\]\[1\]/);
  assert.doesNotMatch(homepage, /new RegExp\(searchValue/);
  assert.doesNotMatch(homepage, /onclick="copyToClipboard\('\$\{row\[5\]/);
  assert.match(homepage, /ValuationUI\.escapeHtml/);
});

test("valuation account edit uses a protected modal and an optional new password", () => {
  assert.match(homepage, /id="accountEditModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(homepage, /id="editAccountId"[^>]*readonly/);
  assert.match(homepage, /id="editAccountCompany"/);
  assert.match(homepage, /id="editAccountPassword"[^>]*type="password"[^>]*autocomplete="new-password"/);
  assert.match(homepage, /function saveAccountEdit\(/);
  assert.match(homepage, /callAPI\('updateAccount', accountPayload\)/);
  assert.doesNotMatch(homepage, /editAccountPassword[^\n]*value="\$\{/);
  assert.match(homepage, /function handleAccountEditKeydown\(/);
  assert.match(homepage, /event\.key === 'Escape'/);
  assert.match(homepage, /accountEditReturnFocus/);
  assert.match(homepage, /dutyModalContent\.inert = isOpen/);
  assert.match(homepage, /closeAccountEditModal\(true, false\)/);
  assert.match(homepage, /account-row-\$\{updatedAccountIndex\}[\s\S]*?\.edit-button/);
  assert.match(homepage, /id="accountRefreshButton"/);
  assert.match(homepage, /refreshedEditButton\s*\|\|\s*document\.getElementById\('accountRefreshButton'\)/);
  assert.match(homepage, /\.account-edit-modal-content\s*\{[\s\S]*?max-height:\s*calc\(100vh - 32px\)/);
  assert.match(homepage, /\.account-edit-modal-content\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("valuation popup expands for desktop and keeps result columns on one line", () => {
  assert.match(homepage, /\.duty-modal-content\s*\{[\s\S]*?width:\s*calc\(100vw - 24px\)/);
  assert.match(homepage, /\.duty-modal-content\s*\{[\s\S]*?max-width:\s*1680px/);
  assert.match(homepage, /\.duty-modal-content\s*\{[\s\S]*?min-height:\s*min\(600px,\s*calc\(100vh - 24px\)\)/);
  assert.match(homepage, /\.valuation-results-table\s+th,[\s\S]*?white-space:\s*nowrap/);
  assert.match(homepage, /\.valuation-results-table\s+th,[\s\S]*?word-break:\s*keep-all/);
  assert.match(homepage, /class="valuation-table-shell"/);
  assert.match(homepage, /class="results-table valuation-results-table"/);
});

test("valuation copy supports browsers without the asynchronous Clipboard API", () => {
  assert.match(homepage, /navigator\.clipboard && typeof navigator\.clipboard\.writeText === 'function'/);
  assert.match(homepage, /function fallbackCopyToClipboard\(/);
});

test("valuation dialogs and status messages expose basic accessible semantics", () => {
  assert.match(homepage, /id="loginModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(homepage, /id="dutyModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(homepage, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
});
