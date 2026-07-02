const { verifySession, supabaseFetch } = require("./_cargo-auth");

function isValidDate(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    const blNumber = String(body.bl_number || "").trim();
    const isQuota = !!body.is_quota;
    const quotaPermitDate = String(body.quota_permit_date || "").trim();

    if (!blNumber) {
      return res.status(400).json({ success: false, message: "BL 번호가 없습니다." });
    }
    if (!isValidDate(quotaPermitDate)) {
      return res.status(400).json({ success: false, message: "추천서 교부일 형식이 올바르지 않습니다." });
    }

    const accountId = encodeURIComponent(session.account_id);
    const bl = encodeURIComponent(blNumber);
    const owned = await supabaseFetch(
      `/rest/v1/cargo_cards?select=id&account_id=eq.${accountId}&bl_number=eq.${bl}&limit=1`
    );
    if (!owned || !owned.length) {
      return res.status(404).json({ success: false, message: "조회 권한이 없는 BL입니다." });
    }

    const rows = await supabaseFetch(
      "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          account_id: session.account_id,
          bl_number: blNumber,
          is_quota: isQuota,
          quota_permit_date: isQuota && quotaPermitDate ? quotaPermitDate : null,
        }),
      }
    );

    return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
  } catch (error) {
    if (String(error.message || "").includes("cargo_card_user_inputs")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_card_user_inputs 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};