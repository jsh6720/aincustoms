const { verifySession, supabaseFetch } = require("./_cargo-auth");

function boolValue(value) {
  return value === true || value === "true" || value === "O" || value === "1" || value === 1;
}

function dateOrNull(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function findCard(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const cards = await supabaseFetch(
    `/rest/v1/cargo_cards?select=account_id,bl_number&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const isAdmin = (session.role || "shipper") === "admin";
    const accountId = isAdmin ? String(body.account_id || "").trim() : String(session.account_id || "").trim();
    const blNumber = String(body.bl_number || "").trim();
    const actualReceivedDate = dateOrNull(body.actual_received_date);
    const approvePending = body.approve_pending === true || body.approve_pending === "true";

    if (!accountId || !blNumber) {
      return res.status(400).json({ success: false, message: "account_id와 B/L 번호가 필요합니다." });
    }

    const card = await findCard(accountId, blNumber);
    if (!card) {
      return res.status(404).json({ success: false, message: "해당 B/L 카드를 찾을 수 없습니다." });
    }

    let payload;
    if (isAdmin) {
      const existing = approvePending ? await findOriginalDoc(accountId, blNumber) : null;
      const approvedDate = approvePending
        ? dateOrNull(existing?.pending_actual_received_date)
        : actualReceivedDate;

      payload = {
        account_id: accountId,
        bl_number: blNumber,
        obl_received: boolValue(body.obl_received),
        hc_received: boolValue(body.hc_received),
        actual_received_date: approvedDate,
        updated_by: session.login_id || "admin",
      };

      if (approvePending) {
        payload.pending_actual_received_date = null;
        payload.pending_actual_received_date_by = null;
        payload.pending_actual_received_date_at = null;
        payload.approved_actual_received_date_by = session.login_id || "admin";
        payload.approved_actual_received_date_at = new Date().toISOString();
      }
    } else {
      if (!actualReceivedDate) {
        return res.status(400).json({ success: false, message: "실제수령일을 입력해 주세요." });
      }
      payload = {
        account_id: accountId,
        bl_number: blNumber,
        pending_actual_received_date: actualReceivedDate,
        pending_actual_received_date_by: session.login_id || "shipper",
        pending_actual_received_date_at: new Date().toISOString(),
        updated_by: session.login_id || "shipper",
      };
    }

    const rows = await supabaseFetch("/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({
      success: true,
      item: rows && rows[0] ? rows[0] : payload,
      pending: !isAdmin,
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
