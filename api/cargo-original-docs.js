const { verifySession, supabaseFetch } = require("./_cargo-auth");

function boolValue(value) {
  return value === true || value === "true" || value === "O" || value === "1" || value === 1;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session || session.role !== "admin") {
      return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const accountId = String(body.account_id || "").trim();
    const blNumber = String(body.bl_number || "").trim();
    if (!accountId || !blNumber) {
      return res.status(400).json({ success: false, message: "account_id와 B/L 번호가 필요합니다." });
    }

    const account = encodeURIComponent(accountId);
    const bl = encodeURIComponent(blNumber);
    const cards = await supabaseFetch(
      `/rest/v1/cargo_cards?select=account_id,bl_number&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
    );
    if (!cards || !cards.length) {
      return res.status(404).json({ success: false, message: "해당 B/L 카드를 찾을 수 없습니다." });
    }

    const payload = {
      account_id: accountId,
      bl_number: blNumber,
      obl_received: boolValue(body.obl_received),
      hc_received: boolValue(body.hc_received),
      updated_by: session.login_id || "admin",
    };

    const rows = await supabaseFetch("/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({
      success: true,
      item: rows && rows[0] ? rows[0] : payload,
    });
  } catch (error) {
    if (String(error.message || "").includes("cargo_original_docs")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_original_docs 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
