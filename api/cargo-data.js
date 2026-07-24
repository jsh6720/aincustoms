const { createSession, verifySession, canReadAllCargo, supabaseFetch } = require("../lib/cargo-auth");
const { hasTransferDocument } = require("../lib/cargo-doc-status");
const {
  normalizeCalendarPreferences,
  validateCalendarPreferences,
} = require("../lib/cargo-calendar-preferences");
const { mergeDuplicateCargoCards } = require("../lib/cargo-card-merge");
const {
  latestLinkedRequest,
  mergeLinkedDeliveryStatus,
  mergeLinkedOriginalDocs,
} = require("../lib/cargo-linked-records");

const STAGE_ORDER = ["입항전", "입항", "반입", "수입신고", "반출"];
const IMPORT_DECLARE_DAYS = 30;
const QUOTA_RELEASE_DAYS = 40;
const WARN_BEFORE_DAYS = 7;

function isoDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function koreaDateFromTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
      ? `/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,free_time_expiry_override,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,sticker_requested,obl_carrier_submitted,obl_carrier_submitted_date,obl_carrier_submitted_by,obl_carrier_submitted_at,docs_delivered_samhyeon,docs_delivered_warehouse,transport_updated_by_role,transport_updated_by_login,transport_updated_at,updated_at&account_id=eq.${accountId}`
      : "/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,free_time_expiry_override,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,sticker_requested,obl_carrier_submitted,obl_carrier_submitted_date,obl_carrier_submitted_by,obl_carrier_submitted_at,docs_delivered_samhyeon,docs_delivered_warehouse,transport_updated_by_role,transport_updated_by_login,transport_updated_at,updated_at";
    return await supabaseFetch(
      query
    );
  } catch (error) {
    if (["is_hidden", "delivery_terms", "eta_date", "storage_yard", "free_time_days", "free_time_expiry_date", "free_time_expiry_override", "warehouse_expected_date", "animal_quarantine_override", "food_quarantine_override", "import_declaration_override", "distribution_history_override", "distribution_history_number", "sticker_requested", "obl_carrier_submitted", "docs_delivered_samhyeon", "docs_delivered_warehouse", "transport_updated_by_role", "transport_updated_by_login", "transport_updated_at"].some((name) => String(error.message || "").includes(name))) {
      const fallback = accountId
        ? `/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,free_time_expiry_override,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,sticker_requested,obl_carrier_submitted,obl_carrier_submitted_date,obl_carrier_submitted_by,obl_carrier_submitted_at,transport_updated_by_role,transport_updated_by_login,transport_updated_at,updated_at&account_id=eq.${accountId}`
        : "/rest/v1/cargo_card_user_inputs?select=account_id,bl_number,is_quota,quota_permit_date,is_hidden,hidden_at,hidden_by,delivery_terms,eta_date,storage_yard,free_time_days,free_time_expiry_date,free_time_expiry_override,warehouse_expected_date,animal_quarantine_override,food_quarantine_override,import_declaration_override,distribution_history_override,distribution_history_number,sticker_requested,obl_carrier_submitted,obl_carrier_submitted_date,obl_carrier_submitted_by,obl_carrier_submitted_at,transport_updated_by_role,transport_updated_by_login,transport_updated_at,updated_at";
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
      ? `/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,requested_import_date,memo,created_at&account_id=eq.${accountId}&order=created_at.desc`
      : "/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,requested_import_date,memo,created_at&order=created_at.desc";
    return await supabaseFetch(
      query
    );
  } catch (error) {
    if (String(error.message || "").includes("requested_import_date")) {
      const fallback = accountId
        ? `/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,memo,created_at&account_id=eq.${accountId}&order=created_at.desc`
        : "/rest/v1/cargo_import_requests?select=account_id,bl_number,requester_name,requester_email,delivery_address,requested_release_date,memo,created_at&order=created_at.desc";
      return await supabaseFetch(fallback);
    }
    if (String(error.message || "").includes("cargo_import_requests")) {
      return [];
    }
    throw error;
  }
}

async function fetchOriginalDocs(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,transfer_received_override,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at&account_id=eq.${accountId}`
      : "/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,transfer_received_override,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at";
    return await supabaseFetch(query);
  } catch (error) {
    if (String(error.message || "").includes("transfer_received_override")) {
      const fallback = accountId
        ? `/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at&account_id=eq.${accountId}`
        : "/rest/v1/cargo_original_docs?select=account_id,bl_number,obl_received,hc_received,actual_received_date,pending_actual_received_date,pending_actual_received_date_by,pending_actual_received_date_at,approved_actual_received_date_by,approved_actual_received_date_at,updated_by,updated_at";
      return await supabaseFetch(fallback);
    }
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

async function fetchLifecycle(accountId) {
  try {
    const query = accountId
      ? `/rest/v1/cargo_card_lifecycle?select=account_id,bl_number,source_missing,source_missing_at,permanently_excluded,permanently_excluded_at,permanently_excluded_by,restored_at,restored_by,updated_at&account_id=eq.${accountId}`
      : "/rest/v1/cargo_card_lifecycle?select=account_id,bl_number,source_missing,source_missing_at,permanently_excluded,permanently_excluded_at,permanently_excluded_by,restored_at,restored_by,updated_at";
    return await supabaseFetch(query);
  } catch (error) {
    if (String(error.message || "").includes("cargo_card_lifecycle")) return [];
    throw error;
  }
}

function applyUserInputs(cards, inputs, cardRefs = cards) {
  const byBl = new Map((inputs || []).map((item) => [`${item.account_id || ""}|${item.bl_number}`, item]));
  return (cards || []).map((card) => {
    const input = byBl.get(`${card.account_id || ""}|${card.bl_number}`) || byBl.get(`|${card.bl_number}`);
    const delivery = mergeLinkedDeliveryStatus(card, cardRefs, inputs);
    if (!input) return { ...card, ...delivery, free_time_days: 3 };
    return computeQuotaMessages({
      ...card,
      ...delivery,
      is_quota: !!input.is_quota,
      quota_permit_date: input.quota_permit_date || "",
      is_hidden: !!input.is_hidden,
      hidden_at: input.hidden_at || null,
      hidden_by: input.hidden_by || "",
      delivery_terms: input.delivery_terms || card.delivery_terms || "",
      eta_date: input.eta_date || card.eta_date || "",
      storage_yard: input.storage_yard || card.storage_yard || "",
      free_time_days: Number(input.free_time_days || 3),
      free_time_expiry_date: input.free_time_expiry_date || card.free_time_expiry_date || "",
      free_time_expiry_override: input.free_time_expiry_override || "",
      warehouse_expected_date: input.warehouse_expected_date || card.warehouse_expected_date || "",
      animal_quarantine_override: input.animal_quarantine_override || "",
      food_quarantine_override: input.food_quarantine_override || "",
      import_declaration_override: input.import_declaration_override || "",
      distribution_history_override: input.distribution_history_override || "",
      distribution_history_number: input.distribution_history_number || "",
      sticker_requested: input.sticker_requested === true,
      obl_carrier_submitted: input.obl_carrier_submitted === true,
      obl_carrier_submitted_date: input.obl_carrier_submitted_date || "",
      obl_carrier_submitted_by: input.obl_carrier_submitted_by || "",
      obl_carrier_submitted_at: input.obl_carrier_submitted_at || null,
      transport_updated_by_role: input.transport_updated_by_role || "",
      transport_updated_by_login: input.transport_updated_by_login || "",
      transport_updated_at: input.transport_updated_at || null,
      animal_quarantine: input.animal_quarantine_override || card.animal_quarantine || "",
      food_quarantine: input.food_quarantine_override || card.food_quarantine || "",
      import_declared: input.import_declaration_override === "O" ? true : (input.import_declaration_override === "X" ? false : card.import_declared),
      quota_input_updated_at: input.updated_at || null,
    });
  });
}

function applyLifecycle(cards, lifecycleRows) {
  const byBl = new Map(
    (lifecycleRows || []).map((item) => [`${item.account_id || ""}|${item.bl_number}`, item])
  );
  return (cards || []).map((card) => {
    const lifecycle =
      byBl.get(`${card.account_id || ""}|${card.bl_number}`) ||
      byBl.get(`|${card.bl_number}`) ||
      {};
    const sourceMissing = lifecycle.source_missing === true;
    const permanentlyExcluded = lifecycle.permanently_excluded === true;
    return {
      ...card,
      source_missing: sourceMissing,
      source_missing_at: lifecycle.source_missing_at || null,
      permanently_excluded: permanentlyExcluded,
      permanently_excluded_at: lifecycle.permanently_excluded_at || null,
      permanently_excluded_by: lifecycle.permanently_excluded_by || "",
      lifecycle_restored_at: lifecycle.restored_at || null,
      lifecycle_restored_by: lifecycle.restored_by || "",
      is_hidden: card.is_hidden === true || sourceMissing || permanentlyExcluded,
      hidden_reason: permanentlyExcluded
        ? "영구 제외"
        : (sourceMissing ? "로컬 폴더 없음" : (card.is_hidden ? "관리자 숨김" : "")),
    };
  });
}

function applyOriginalDocs(cards, docs, cardRefs = cards) {
  return (cards || []).map((card) => {
    const item = mergeLinkedOriginalDocs(card, cardRefs, docs);
    return {
      ...card,
      obl_received: !!item?.obl_received,
      hc_received: !!item?.hc_received,
      transfer_received_override: item?.transfer_received_override ?? null,
      doc_transfer_received: item?.transfer_received_override === true
        ? true
        : (item?.transfer_received_override === false ? false : !!card.doc_transfer_received),
      actual_received_date: item?.actual_received_date || "",
      pending_actual_received_date: item?.pending_actual_received_date || "",
      pending_actual_received_date_by: item?.pending_actual_received_date_by || "",
      pending_actual_received_date_at: item?.pending_actual_received_date_at || null,
      approved_actual_received_date_by: item?.approved_actual_received_date_by || "",
      approved_actual_received_date_at: item?.approved_actual_received_date_at || null,
      original_docs_updated_at: item?.receipt_updated_at || item?.updated_at || null,
      original_docs_updated_by: item?.updated_by || "",
    };
  });
}

function applyOriginalDocRequests(cards, requests, cardRefs = cards) {
  return (cards || []).map((card) => {
    const item = latestLinkedRequest(card, cardRefs, requests);
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
      last_import_requested_import_date:
        item.requested_import_date || koreaDateFromTimestamp(item.created_at),
      last_import_request_created_at: item.created_at || null,
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

async function fetchCalendarPreferences(accountId, fallback) {
  const rows = await supabaseFetch(
    `/rest/v1/shipper_accounts?select=calendar_preferences&id=eq.${accountId}&limit=1`
  );
  if (!rows || !rows[0]) {
    return normalizeCalendarPreferences(fallback);
  }
  return normalizeCalendarPreferences(rows[0].calendar_preferences);
}

async function saveCalendarPreferences(req, res) {
  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "Login is required" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let preferences;
    try {
      preferences = validateCalendarPreferences(body);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const accountId = encodeURIComponent(session.account_id);
    const rows = await supabaseFetch(
      `/rest/v1/shipper_accounts?id=eq.${accountId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ calendar_preferences: preferences }),
      }
    );
    const savedPreferences = rows && rows[0]
      ? normalizeCalendarPreferences(rows[0].calendar_preferences)
      : preferences;
    const token = createSession({
      ...session,
      calendar_preferences: savedPreferences,
    });
    const maxAge = Math.max(0, Math.floor(session.exp) - Math.floor(Date.now() / 1000));

    res.setHeader(
      "Set-Cookie",
      `cargo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
    );

    return res.status(200).json({
      success: true,
      calendar_preferences: savedPreferences,
    });
  } catch (error) {
    if (String(error.message || "").includes("calendar_preferences")) {
      return res.status(500).json({
        success: false,
        message: "Run 20260724_add_calendar_preferences_and_ctf.sql in Supabase first.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "PATCH") {
    return saveCalendarPreferences(req, res);
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const readsAllCargo = canReadAllCargo(session.role);
    const accountId = encodeURIComponent(session.account_id);
    const currentCalendarPreferences = await fetchCalendarPreferences(
      accountId,
      session.calendar_preferences
    );
    const cards = await supabaseFetch(
      readsAllCargo
        ? "/rest/v1/cargo_cards?select=*&order=synced_at.desc"
        : `/rest/v1/cargo_cards?select=*&account_id=eq.${accountId}&order=synced_at.desc`
    );
    const cardRefs = readsAllCargo
      ? cards
      : await supabaseFetch(
          "/rest/v1/cargo_cards?select=account_id,bl_number,folder_name"
        );
    const userInputs = await fetchUserInputs(readsAllCargo ? null : accountId);
    const lifecycleRows = await fetchLifecycle(readsAllCargo ? null : accountId);
    const importRequests = await fetchImportRequests(readsAllCargo ? null : accountId);
    const originalDocs = await fetchOriginalDocs(null);
    const originalDocRequests = await fetchOriginalDocRequests(null);
    const cardsWithDocStatus = (cards || []).map((card) => ({
      ...card,
      doc_transfer_received: hasTransferDocument(card.doc_files_status),
    }));

    const enrichedCards = applyLifecycle(
      applyOriginalDocs(
        applyOriginalDocRequests(
          applyImportRequests(applyUserInputs(cardsWithDocStatus, userInputs, cardRefs), importRequests),
          originalDocRequests,
          cardRefs
        ),
        originalDocs,
        cardRefs
      ),
      lifecycleRows
    );
    const sorted = (readsAllCargo
      ? mergeDuplicateCargoCards(enrichedCards)
      : enrichedCards
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
        account_category: session.account_category || "shipper",
        calendar_preferences: currentCalendarPreferences,
      },
      stages: STAGE_ORDER,
      counts,
      total: sorted.length,
      cards: sorted,
      last_update: sorted[0] ? sorted[0].synced_at : null,
    });
  } catch (error) {
    if (String(error.message || "").includes("calendar_preferences")) {
      return res.status(500).json({
        success: false,
        message: "Run 20260724_add_calendar_preferences_and_ctf.sql in Supabase first.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
