const { requireWritableSession, supabaseFetch } = require("../lib/cargo-auth");
const {
  isMissingTransferOverrideColumn,
  normalizeTransferOverride,
  receiptDateForSave,
} = require("../lib/cargo-original-doc-utils");
const {
  linkedAccountIds,
  mergeOriginalDocRows,
} = require("../lib/cargo-linked-records");

function boolValue(value) {
  return value === true || value === "true" || value === "O" || value === "1" || value === 1;
}

function dateOrNull(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function findCard(accountId, blNumber, full = false) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const select = full ? "*" : "account_id,bl_number";
  const cards = await supabaseFetch(
    `/rest/v1/cargo_cards?select=${select}&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  return cards && cards[0] ? cards[0] : null;
}

async function findOriginalDoc(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_original_docs?select=*&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

async function findLinkedCards(card) {
  const bl = encodeURIComponent(card.bl_number);
  const folderName = String(card.folder_name || "").trim();
  if (!folderName) return [card];
  const folder = encodeURIComponent(folderName);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_cards?select=account_id,bl_number,folder_name&bl_number=eq.${bl}&folder_name=eq.${folder}`
  );
  return rows && rows.length ? rows : [card];
}

async function findLinkedOriginalDocs(card, linkedCards) {
  const accountIds = linkedAccountIds(card, linkedCards);
  const rows = [];
  for (const accountId of accountIds) {
    const item = await findOriginalDoc(accountId, card.bl_number);
    if (item) rows.push(item);
  }
  return rows;
}

async function upsertLinkedOriginalDocs(card, linkedCards, payload) {
  const accountIds = linkedAccountIds(card, linkedCards);
  const results = [];
  let transferOverrideSaved = true;
  for (const accountId of accountIds) {
    const saved = await upsertOriginalDoc({
      ...payload,
      account_id: accountId,
      bl_number: card.bl_number,
    });
    transferOverrideSaved = transferOverrideSaved && saved.transferOverrideSaved;
    if (saved.rows && saved.rows[0]) results.push(saved.rows[0]);
  }
  return { rows: results, transferOverrideSaved };
}

async function upsertOriginalDoc(payload) {
  const options = {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  };
  try {
    return {
      rows: await supabaseFetch(
        "/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number",
        options
      ),
      transferOverrideSaved: true,
    };
  } catch (error) {
    if (!Object.prototype.hasOwnProperty.call(payload, "transfer_received_override")
        || !isMissingTransferOverrideColumn(error)) {
      throw error;
    }
    const fallbackPayload = { ...payload };
    delete fallbackPayload.transfer_received_override;
    return {
      rows: await supabaseFetch(
        "/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number",
        {
          ...options,
          body: JSON.stringify(fallbackPayload),
        }
      ),
      transferOverrideSaved: false,
    };
  }
}

async function findLatestOriginalDocRequest(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_original_doc_requests?select=id,account_id,bl_number,requested_receipt_date,created_at&account_id=eq.${account}&bl_number=eq.${bl}&order=created_at.desc&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

async function findLatestLinkedOriginalDocRequest(card, linkedCards) {
  const requests = [];
  for (const accountId of linkedAccountIds(card, linkedCards)) {
    const item = await findLatestOriginalDocRequest(accountId, card.bl_number);
    if (item) requests.push(item);
  }
  requests.sort((left, right) => (
    String(right.created_at || "").localeCompare(String(left.created_at || ""))
  ));
  return requests[0] || null;
}

async function saveRequestedReceiptDate(
  accountId,
  blNumber,
  requestedReceiptDate,
  card,
  linkedCards
) {
  if (requestedReceiptDate === undefined) return null;
  const nextDate = dateOrNull(requestedReceiptDate);
  const latest = await findLatestLinkedOriginalDocRequest(card, linkedCards);
  if (latest) {
    const id = encodeURIComponent(latest.id);
    const rows = await supabaseFetch(`/rest/v1/cargo_original_doc_requests?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ requested_receipt_date: nextDate }),
    });
    return rows && rows[0] ? rows[0] : null;
  }
  if (!nextDate) return null;
  const rows = await supabaseFetch("/rest/v1/cargo_original_doc_requests", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      account_id: accountId,
      bl_number: blNumber,
      requester_name: "관리자",
      requested_receipt_date: nextDate,
      memo: "관리자 수령요청일 조정",
      status: "admin_adjusted",
      card_snapshot: card || {},
    }),
  });
  return rows && rows[0] ? rows[0] : null;
}

async function saveAdminItem(session, item) {
  const accountId = String(item.account_id || "").trim();
  const blNumber = String(item.bl_number || "").trim();
  if (!accountId || !blNumber) {
    throw new Error("account_id와 B/L 번호가 필요합니다.");
  }

  const card = await findCard(accountId, blNumber, true);
  if (!card) {
    throw new Error(`해당 B/L 카드를 찾을 수 없습니다: ${blNumber}`);
  }

  const approvePending = item.approve_pending === true || item.approve_pending === "true";
  const linkedCards = await findLinkedCards(card);
  const existing = mergeOriginalDocRows(
    await findLinkedOriginalDocs(card, linkedCards)
  );
  const oblReceived = boolValue(item.obl_received);
  const hcReceived = boolValue(item.hc_received);
  const existingHadReceipt = !!existing?.obl_received || !!existing?.hc_received;
  const todayKorea = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const actualReceivedDate = approvePending
    ? dateOrNull(existing?.pending_actual_received_date)
    : receiptDateForSave({
        obl_received: oblReceived,
        hc_received: hcReceived,
        previous_obl_received: !!existing?.obl_received,
        previous_hc_received: !!existing?.hc_received,
        previous_date: existing?.actual_received_date || (existingHadReceipt ? existing?.updated_at : ""),
        submitted_date: item.actual_received_date || existing?.actual_received_date,
        today: todayKorea,
      });

  const payload = {
    account_id: accountId,
    bl_number: blNumber,
    obl_received: oblReceived,
    hc_received: hcReceived,
    actual_received_date: actualReceivedDate,
    updated_by: session.login_id || "admin",
  };
  if (Object.prototype.hasOwnProperty.call(item, "transfer_received_override")) {
    payload.transfer_received_override = normalizeTransferOverride(item.transfer_received_override);
  }

  if (approvePending) {
    payload.pending_actual_received_date = null;
    payload.pending_actual_received_date_by = null;
    payload.pending_actual_received_date_at = null;
    payload.approved_actual_received_date_by = session.login_id || "admin";
    payload.approved_actual_received_date_at = new Date().toISOString();
  }

  const transferChanged = Object.prototype.hasOwnProperty.call(payload, "transfer_received_override")
    && payload.transfer_received_override !== (existing?.transfer_received_override ?? null);
  const originalChanged = !existing
    || approvePending
    || oblReceived !== !!existing.obl_received
    || hcReceived !== !!existing.hc_received
    || actualReceivedDate !== dateOrNull(existing.actual_received_date)
    || transferChanged;
  const saved = originalChanged
    ? await upsertLinkedOriginalDocs(card, linkedCards, payload)
    : { rows: [existing], transferOverrideSaved: true };
  const { rows, transferOverrideSaved } = saved;
  const request = await saveRequestedReceiptDate(
    accountId,
    blNumber,
    item.requested_receipt_date,
    card,
    linkedCards
  );

  return {
    item: rows && rows[0] ? rows[0] : payload,
    request,
    transfer_override_saved: transferOverrideSaved,
  };
}

async function saveShipperPending(session, body) {
  const accountId = String(session.account_id || "").trim();
  const blNumber = String(body.bl_number || "").trim();
  const actualReceivedDate = dateOrNull(body.actual_received_date);
  if (!accountId || !blNumber) {
    throw new Error("account_id와 B/L 번호가 필요합니다.");
  }
  if (!actualReceivedDate) {
    throw new Error("실제수령일을 입력해 주세요.");
  }
  const card = await findCard(accountId, blNumber, true);
  if (!card) {
    throw new Error("해당 B/L 카드를 찾을 수 없습니다.");
  }
  const linkedCards = await findLinkedCards(card);
  const payload = {
    pending_actual_received_date: actualReceivedDate,
    pending_actual_received_date_by: session.login_id || "shipper",
    pending_actual_received_date_at: new Date().toISOString(),
    updated_by: session.login_id || "shipper",
  };
  const { rows } = await upsertLinkedOriginalDocs(card, linkedCards, payload);
  return rows && rows[0] ? rows[0] : payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = requireWritableSession(req, res);
    if (!session) return;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const isAdmin = (session.role || "shipper") === "admin";
    if (isAdmin) {
      const items = Array.isArray(body.items) ? body.items : [body];
      if (!items.length) {
        return res.status(400).json({ success: false, message: "저장할 항목이 없습니다." });
      }
      const saved = [];
      for (const item of items) {
        saved.push(await saveAdminItem(session, item));
      }
      return res.status(200).json({
        success: true,
        items: saved.map((row) => row.item),
        requests: saved.map((row) => row.request).filter(Boolean),
        item: saved[0]?.item || null,
        transfer_override_saved: saved.every((row) => row.transfer_override_saved !== false),
        warning: saved.some((row) => row.transfer_override_saved === false)
          ? "양도증 수동 상태 컬럼이 아직 없어 OBL/H/C와 날짜만 저장했습니다. Supabase SQL 마이그레이션을 실행해 주세요."
          : "",
      });
    }

    const item = await saveShipperPending(session, body);
    return res.status(200).json({
      success: true,
      item,
      pending: true,
    });
  } catch (error) {
    if (String(error.message || "").includes("cargo_original_docs")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_original_docs 테이블 컬럼을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
