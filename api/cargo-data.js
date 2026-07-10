const { verifySession, supabaseFetch } = require("../lib/cargo-auth");

const STAGE_ORDER = ["입항전", "입항", "반입", "수입신고", "반출"];
const IMPORT_DECLARE_DAYS = 30;
const QUOTA_RELEASE_DAYS = 40;
const WARN_BEFORE_DAYS = 7;

function isoDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function addDays(value, days) {
  const dateText = isoDate(value);
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysLeft(deadline) {
  return Math.floor((deadline.getTime() - todayUtc().getTime()) / 86400000);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function computeQuotaMessages(card) {
  if (!card.is_quota) {
    return {
      ...card,
      quota_permit_date: "",
      import_declare_deadline: null,
      import_declare_message: "",
      import_declare_alert: "",
      quota_release_deadline: null,
      quota_release_message: "",
      quota_release_alert: "",
      quota_alert: "",
    };
  }

  let importDeclareDeadline = null;
  let importDeclareMessage = "";
  let importDeclareAlert = "";
  const arrivalDeadline = addDays(card.warehouse_arrival_date, IMPORT_DECLARE_DAYS);
  if (arrivalDeadline) {
    importDeclareDeadline = formatDate(arrivalDeadline);
    const left = daysLeft(arrivalDeadline);
    if (card.import_declared) {
      importDeclareMessage = `수입신고 완료 (${isoDate(card.import_declared_date) || "-"})`;
    } else if (left < 0) {
      importDeclareAlert = "over";
      importDeclareMessage = `수입신고 가산세 부과 대상: 반입 후 ${IMPORT_DECLARE_DAYS}일 초과 (${-left}일 경과)`;
    } else {
      importDeclareAlert = left <= WARN_BEFORE_DAYS ? "warn" : "";
      importDeclareMessage = `수입신고 기한 ${importDeclareDeadline} (D-${left})`;
    }
  } else {
    importDeclareMessage = "보세구역 반입일 미확정";
  }

  let quotaReleaseDeadline = null;
  let quotaReleaseMessage = "";
  let quotaReleaseAlert = "";
  const permitDeadline = addDays(card.quota_permit_date, QUOTA_RELEASE_DAYS);
  const remaining = Number(card.remaining_weight || 0);
  const unit = card.weight_unit || "KG";
  if (permitDeadline) {
    quotaReleaseDeadline = formatDate(permitDeadline);
    const left = daysLeft(permitDeadline);
    if (card.fully_released || remaining <= 0) {
      quotaReleaseMessage = "전량 반출 완료";
    } else if (left < 0) {
      quotaReleaseAlert = "over";
      quotaReleaseMessage = `할당 취소 대상: 교부일 후 ${QUOTA_RELEASE_DAYS}일 초과, 미반출 잔량 ${remaining.toLocaleString("ko-KR")}${unit} (${-left}일 경과)`;
    } else if (left <= WARN_BEFORE_DAYS) {
      quotaReleaseAlert = "warn";
      quotaReleaseMessage = `할당 취소 기한 D-${left} / 잔량 ${remaining.toLocaleString("ko-KR")}${unit}`;
    } else {
      quotaReleaseMessage = `할당 취소 기한 ${quotaReleaseDeadline} (D-${left})`;
    }
  } else {
    quotaReleaseAlert = "warn";
    quotaReleaseMessage = "추천서 교부일로부터 40일 이내 보세구역 미반출 시 해당연도 할당 물량 전체 취소";
  }

  const alerts = [importDeclareAlert, quotaReleaseAlert];
  const quotaAlert = alerts.includes("over") ? "over" : (alerts.includes("warn") ? "warn" : "");

  return {
    ...card,
    import_declare_deadline: importDeclareDeadline,
    import_declare_message: importDeclareMessage,
    import_declare_alert: importDeclareAlert,
    quota_release_deadline: quotaReleaseDeadline,
    quota_release_message: quotaReleaseMessage,
    quota_release_alert: quotaReleaseAlert,
    quota_alert: quotaAlert,
  };
}

async function fetchUserInputs(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,updated_at&account_id=eq.${accountId}`
      : "/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,updated_at";
    return await supabaseFetch(
      query
    );
  } catch (error) {
    if (["is_hidden", "delivery_terms", "eta_date", "storage_yard", "free_time_days", "free_time_expiry_date", "warehouse_expected_date", "animal_quarantine_override", "food_quarantine_override", "import_declaration_override", "distribution_history_override", "distribution_history_number"].some((name) => String(error.message || "").includes(name))) {
      const fallback = accountId
        ? `/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,updated_at&account_id=eq.${accountId}`
        : "/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,updated_at";
      return await supabaseFetch(fallback);
    }
    if (String(error.message || "").includes("cargo_card_user_inputs")) {
      return [];
    }
    throw error;
  }
}

async function fetchImportRequests(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,memo,created_at&account_id=eq.${accountId}&order=created_at.desc`
      : "/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,memo,created_at&order=created_at.desc";
    return await supabaseFetch(
      query
    );
  } catch (error) {
    if (String(error.message || "").includes("cargo_import_requests")) {
      return [];
    }
    throw error;
  }
}

async function fetchOriginalDocs(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at&account_id=eq.${accountId}`
      : "/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at";
    return await supabaseFetch(query);
  } catch (error) {
    if (String(error.message || "").includes("cargo_original_docs")) {
      return [];
    }
    throw error;
  }
}

async function fetchOriginalDocRequests(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_original_doc_requests?select=id,account_id,bl_number,requester_name,requester_email,requested_receipt_date,memo,status,created_at&account_id=eq.${accountId}&order=created_at.desc`
      : "/rest/v1/cargo_original_doc_requests?select=id,account_id,bl_number,requester_name,requester_email,requested_receipt_date,memo,status,created_at&order=created_at.desc";
    return await supabaseFetch(query);
  } catch (error) {
    if (String(error.message || "").includes("cargo_original_doc_requests")) {
      return [];
    }
    throw error;
  }
}

function applyUserInputs(cards, inputs) {
  const byBl = new Map((inputs || []).map((item) => [`${item.account_id || ""}|${item.bl_number}`, item]));
  return (cards || []).map((card) => {
    const input = byBl.get(`${card.account_id || ""}|${card.bl_number}`) || byBl.get(`|${card.bl_number}`);
    if (!input) return card;
    return computeQuotaMessages({
      ...card,
      is_quota: !!input.is_quota,
      quota_permit_date: input.quota_permit_date || "",
      is_hidden: !!input.is_hidden,
      hidden_at: input.hidden_at || null,
      hidden_by: input.hidden_by || "",
      delivery_terms: input.delivery_terms || card.delivery_terms || "",
      eta_date: input.eta_date || card.eta_date || "",
      storage_yard: input.storage_yard || card.storage_yard || "",
      free_time_days: input.free_time_days || card.free_time_days || "",
      free_time_expiry_date: input.free_time_expiry_date || card.free_time_expiry_date || "",
      warehouse_expected_date: input.warehouse_expected_date || card.warehouse_expected_date || "",
      animal_quarantine_override: input.animal_quarantine_override || "",
      food_quarantine_override: input.food_quarantine_override || "",
      import_declaration_override: input.import_declaration_override || "",
      distribution_history_override: input.distribution_history_override || "",
      distribution_history_number: input.distribution_history_number || "",
      animal_quarantine: input.animal_quarantine_override || card.animal_quarantine || "",
      food_quarantine: input.food_quarantine_override || card.food_quarantine || "",
      import_declared: input.import_declaration_override === "O" ? true : (input.import_declaration_override === "X" ? false : card.import_declared),
      quota_input_updated_at: input.updated_at || null,
    });
  });
}

function applyOriginalDocs(cards, docs) {
  const byBl = new Map();
  (docs || []).forEach((item) => {
    const key = `${item.account_id || ""}|${item.bl_number}`;
    if (item.bl_number) byBl.set(key, item);
  });

  return (cards || []).map((card) => {
    const item = byBl.get(`${card.account_id || ""}|${card.bl_number}`) || byBl.get(`|${card.bl_number}`);
    return {
      ...card,
      obl_received: !!item?.obl_received,
      hc_received: !!item?.hc_received,
      actual_received_date: item?.actual_received_date || "",
      pending_actual_received_date: item?.pending_actual_received_date || "",
      pending_actual_received_date_by: item?.pending_actual_received_date_by || "",
      pending_actual_received_date_at: item?.pending_actual_received_date_at || null,
      approved_actual_received_date_by: item?.approved_actual_received_date_by || "",
      approved_actual_received_date_at: item?.approved_actual_received_date_at || null,
      original_docs_updated_at: item?.updated_at || null,
      original_docs_updated_by: item?.updated_by || "",
    };
  });
}

function applyOriginalDocRequests(cards, requests) {
  const byBl = new Map();
  (requests || []).forEach((item) => {
    const key = `${item.account_id || ""}|${item.bl_number}`;
    if (item.bl_number && !byBl.has(key)) {
      byBl.set(key, item);
    }
  });

  return (cards || []).map((card) => {
    const item = byBl.get(`${card.account_id || ""}|${card.bl_number}`) || byBl.get(`|${card.bl_number}`);
    if (!item) return card;
    return {
      ...card,
      last_original_doc_request: item,
      last_original_doc_request_id: item.id || "",
      last_original_doc_requester_name: item.requester_name || "",
      last_original_doc_requester_email: item.requester_email || "",
      last_original_doc_requested_receipt_date: item.requested_receipt_date || "",
      last_original_doc_request_created_at: item.created_at || null,
    };
  });
}

function applyImportRequests(cards, requests) {
  const byBl = new Map();
  (requests || []).forEach((item) => {
    const key = `${item.account_id || ""}|${item.bl_number}`;
    if (item.bl_number && !byBl.has(key)) {
      byBl.set(key, item);
    }
  });

  return (cards || []).map((card) => {
    const item = byBl.get(`${card.account_id || ""}|${card.bl_number}`) || byBl.get(`|${card.bl_number}`);
    if (!item) return card;
    return {
      ...card,
      last_import_request: item,
      last_import_requester_name: item.requester_name || "",
      last_import_requester_email: item.requester_email || "",
      last_import_delivery_address: item.delivery_address || "",
      last_import_requested_release_date: item.requested_release_date || "",
    };
  });
}

function sortCards(a, b) {
  const alertRank = { over: 0, warn: 1, "": 2, null: 2, undefined: 2 };
  const ar = alertRank[a.quota_alert] ?? 2;
  const br = alertRank[b.quota_alert] ?? 2;
  if (ar !== br) return ar - br;

  const sr = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
  if (sr !== 0) return sr;

  const ap = a.stage === "수입신고" && a.import_permitted ? 1 : 0;
  const bp = b.stage === "수입신고" && b.import_permitted ? 1 : 0;
  if (ap !== bp) return ap - bp;

  return String(a.warehouse_arrival_date || "9999").localeCompare(String(b.warehouse_arrival_date || "9999"));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const isAdmin = (session.role || "shipper") === "admin";
    const accountId = encodeURIComponent(session.account_id);
    const cards = await supabaseFetch(
      isAdmin
        ? "/rest/v1/cargo_cards?select=*&order=synced_at.desc"
        : `/rest/v1/cargo_cards?select=*&account_id=eq.${accountId}&order=synced_at.desc`
    );
    const userInputs = await fetchUserInputs(isAdmin ? null : accountId);
    const importRequests = await fetchImportRequests(isAdmin ? null : accountId);
    const originalDocs = await fetchOriginalDocs(isAdmin ? null : accountId);
    const originalDocRequests = await fetchOriginalDocRequests(isAdmin ? null : accountId);

    const sorted = applyOriginalDocs(
      applyOriginalDocRequests(
        applyImportRequests(applyUserInputs(cards || [], userInputs), importRequests),
        originalDocRequests
      ),
      originalDocs
    ).sort(sortCards);
    const counts = {};
    STAGE_ORDER.forEach((stage) => {
      counts[stage] = 0;
    });
    sorted.forEach((card) => {
      counts[card.stage] = (counts[card.stage] || 0) + 1;
    });

    return res.status(200).json({
      success: true,
      user: {
        login_id: session.login_id,
        display_name: session.display_name,
        role: session.role || "shipper",
      },
      stages: STAGE_ORDER,
      counts,
      total: sorted.length,
      cards: sorted,
      last_update: sorted[0] ? sorted[0].synced_at : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
