(function exposeValuationUi(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ValuationUI = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function buildValuationUi() {
  const FIELD_INDEX = Object.freeze({
    company: 0,
    supplier: 1,
    payment: 2,
    trade: 3,
    delivery: 4,
    declaration: 5,
  });
  const CSV_HEADERS = [
    "화주명",
    "해외거래처명",
    "결제방법",
    "거래구분",
    "인도조건",
    "신고번호",
  ];
  const ACTION_FAILURE_MESSAGES = Object.freeze({
    login: "아이디 또는 비밀번호를 확인해주세요.",
    getDutyData: "신고내역을 불러오지 못했습니다. 다시 시도해주세요.",
    getAccountData: "계정 정보를 불러오지 못했습니다. 다시 시도해주세요.",
    addDutyRecord: "신고내역을 등록하지 못했습니다. DB 새로고침 후 확인해주세요.",
    updateDutyRecord: "신고내역을 저장하지 못했습니다. DB 새로고침 후 확인해주세요.",
    deleteDutyRecord: "신고내역을 삭제하지 못했습니다. DB 새로고침 후 확인해주세요.",
    addAccount: "계정을 추가하지 못했습니다. 다시 시도해주세요.",
    deleteAccount: "계정을 삭제하지 못했습니다. 다시 시도해주세요.",
  });

  function text(value) {
    return String(value ?? "");
  }

  function normalized(value) {
    return text(value).trim().toLocaleLowerCase("ko-KR");
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function filterRecords(records, filters = {}) {
    const keyword = normalized(filters.keyword);
    const fieldFilters = Object.entries(FIELD_INDEX)
      .map(([name, index]) => ({ index, value: normalized(filters[name]) }))
      .filter((filter) => filter.value);

    return (Array.isArray(records) ? records : []).filter((item) => {
      const row = Array.isArray(item?.data) ? item.data : [];
      const keywordMatches = !keyword || row
        .slice(0, CSV_HEADERS.length)
        .some((value) => normalized(value).includes(keyword));
      const fieldsMatch = fieldFilters.every(({ index, value }) => (
        normalized(row[index]).includes(value)
      ));
      return keywordMatches && fieldsMatch;
    });
  }

  function sortRecords(records, column = 0, direction = "asc") {
    const safeColumn = Number.isInteger(Number(column))
      ? Math.min(Math.max(Number(column), 0), CSV_HEADERS.length - 1)
      : 0;
    const multiplier = direction === "desc" ? -1 : 1;

    return (Array.isArray(records) ? records : [])
      .map((item, position) => ({ item, position }))
      .sort((left, right) => {
        const leftValue = text(left.item?.data?.[safeColumn]).trim();
        const rightValue = text(right.item?.data?.[safeColumn]).trim();
        if (!leftValue && rightValue) return 1;
        if (leftValue && !rightValue) return -1;
        if (!leftValue && !rightValue) return left.position - right.position;

        const comparison = leftValue.localeCompare(rightValue, "ko-KR", {
          numeric: true,
          sensitivity: "base",
        });
        return comparison === 0
          ? left.position - right.position
          : comparison * multiplier;
      })
      .map(({ item }) => item);
  }

  function paginateRecords(records, requestedPage = 1, requestedPageSize = 25) {
    const source = Array.isArray(records) ? records : [];
    const pageSize = [25, 50, 100].includes(Number(requestedPageSize))
      ? Number(requestedPageSize)
      : 25;
    const totalPages = Math.max(1, Math.ceil(source.length / pageSize));
    const page = Math.min(Math.max(Number(requestedPage) || 1, 1), totalPages);
    const offset = (page - 1) * pageSize;
    const items = source.slice(offset, offset + pageSize);

    return {
      items,
      page,
      pageSize,
      totalItems: source.length,
      totalPages,
      start: source.length ? offset + 1 : 0,
      end: source.length ? offset + items.length : 0,
    };
  }

  function csvCell(value) {
    let output = text(value);
    if (/^[\u0000-\u0020]*[=+\-@]/.test(output)) {
      output = `'${output}`;
    }
    if (/[",\r\n]/.test(output)) {
      output = `"${output.replace(/"/g, '""')}"`;
    }
    return output;
  }

  function buildCsv(records) {
    const rows = (Array.isArray(records) ? records : []).map((item) => {
      const row = Array.isArray(item?.data) ? item.data : [];
      return CSV_HEADERS.map((_, index) => csvCell(row[index])).join(",");
    });

    return `\ufeff${[CSV_HEADERS.join(","), ...rows].join("\r\n")}`;
  }

  function sanitizeAccountRows(rows) {
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.length < 3)) {
      return null;
    }

    return (Array.isArray(rows) ? rows : []).map((row, originalIndex) => ({
      id: text(row?.[0]),
      company: text(row?.[2]),
      originalIndex,
    }));
  }

  function normalizeDutyRows(rows) {
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.length < CSV_HEADERS.length)) {
      return null;
    }

    return rows.map((row) => CSV_HEADERS.map((_, index) => text(row[index])));
  }

  function normalizeUser(user) {
    if (!user || typeof user !== "object" || Array.isArray(user)) return null;
    if (typeof user.username !== "string" || !user.username.trim()) return null;
    if (typeof user.company !== "string" || !user.company.trim()) return null;
    if (typeof user.isMaster !== "boolean") return null;

    return {
      username: user.username.trim(),
      company: user.company.trim(),
      isMaster: user.isMaster,
    };
  }

  function safeFailureMessage(action) {
    return ACTION_FAILURE_MESSAGES[action]
      || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }

  function parseApiResponse(status, body, action = "") {
    if (Number(status) < 200 || Number(status) >= 300) {
      return {
        success: false,
        message: "서버 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    try {
      const parsed = JSON.parse(text(body));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid payload");
      }
      if (parsed.success === false) {
        return { success: false, message: safeFailureMessage(action) };
      }
      if (parsed.success !== true) {
        throw new Error("invalid payload");
      }
      return parsed;
    } catch {
      return {
        success: false,
        message: "서버 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해주세요.",
      };
    }
  }

  function validateDutyRecord(row, existingRecords = []) {
    const values = Array.from({ length: CSV_HEADERS.length }, (_, index) => (
      text(row?.[index]).trim()
    ));
    if (values.some((value) => !value)) {
      return { valid: false, message: "모든 필드를 입력해주세요." };
    }

    const company = normalized(values[FIELD_INDEX.company]);
    const declaration = normalized(values[FIELD_INDEX.declaration]);
    const duplicate = (Array.isArray(existingRecords) ? existingRecords : [])
      .some((item) => {
        const existing = Array.isArray(item?.data) ? item.data : [];
        return normalized(existing[FIELD_INDEX.company]) === company
          && normalized(existing[FIELD_INDEX.declaration]) === declaration;
      });

    return duplicate
      ? { valid: false, message: "같은 화주와 신고번호가 이미 존재합니다." }
      : { valid: true, message: "" };
  }

  return {
    buildCsv,
    escapeHtml,
    filterRecords,
    normalizeDutyRows,
    normalizeUser,
    paginateRecords,
    parseApiResponse,
    sanitizeAccountRows,
    sortRecords,
    validateDutyRecord,
  };
}));
