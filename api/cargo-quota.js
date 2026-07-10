const { verifySession, supabaseFetch } = require("./_cargo-auth");

function isValidDate(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function assertOwnedCard(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const owned = await supabaseFetch(
    `/rest/v1/cargo_cards?select=id&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  return !!(owned && owned.length);
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
    const action = String(body.action || "").trim();
    const blNumber = String(body.bl_number || "").trim();
    const targetAccountId = String(body.account_id || session.account_id || "").trim();
    const isAdmin = (session.role || "shipper") === "admin";

    if (!blNumber) {
      return res.status(400).json({ success: false, message: "BL 번호가 없습니다." });
    }
    if (!targetAccountId) {
      return res.status(400).json({ success: false, message: "화주 계정이 필요합니다." });
    }
    if (!isAdmin && targetAccountId !== session.account_id) {
      return res.status(403).json({ success: false, message: "조회 권한이 없는 BL입니다." });
    }
    if (!(await assertOwnedCard(targetAccountId, blNumber))) {
      return res.status(404).json({ success: false, message: "대상 카드를 찾을 수 없습니다." });
    }

    if (action === "manual_fields") {
      const deliveryTerms = String(body.delivery_terms || "").trim();
      const etaDate = String(body.eta_date || "").trim();
      const freeTimeExpiryDate = String(body.free_time_expiry_date || "").trim();
      const warehouseExpectedDate = String(body.warehouse_expected_date || "").trim();

      for (const value of [etaDate, freeTimeExpiryDate, warehouseExpectedDate]) {
        if (!isValidDate(value)) {
          return res.status(400).json({ success: false, message: "날짜 형식이 올바르지 않습니다." });
        }
      }

      const rows = await supabaseFetch(
        "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            account_id: targetAccountId,
            bl_number: blNumber,
            delivery_terms: deliveryTerms || null,
            eta_date: etaDate || null,
            free_time_expiry_date: freeTimeExpiryDate || null,
            warehouse_expected_date: warehouseExpectedDate || null,
          }),
        }
      );

      return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
    }

    const isQuota = !!body.is_quota;
    const quotaPermitDate = String(body.quota_permit_date || "").trim();

    if (!isValidDate(quotaPermitDate)) {
      return res.status(400).json({ success: false, message: "추천서 교부일 형식이 올바르지 않습니다." });
    }

    const rows = await supabaseFetch(
      "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          account_id: targetAccountId,
          bl_number: blNumber,
          is_quota: isQuota,
          quota_permit_date: isQuota && quotaPermitDate ? quotaPermitDate : null,
        }),
      }
    );

    return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
  } catch (error) {
    if (["delivery_terms", "eta_date", "free_time_expiry_date", "warehouse_expected_date"].some((name) => String(error.message || "").includes(name))) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 add_cargo_manual_fields.sql을 먼저 실행해 주세요.",
      });
    }
    if (String(error.message || "").includes("cargo_card_user_inputs")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_card_user_inputs 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
