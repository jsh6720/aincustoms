const { verifySession, supabaseFetch } = require("../lib/cargo-auth");

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
    if ((session.role || "shipper") !== "admin") {
      return res.status(403).json({ success: false, message: "관리자만 변경할 수 있습니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const accountId = String(body.account_id || "").trim();
    const blNumber = String(body.bl_number || "").trim();
    const hidden = !!body.hidden;
    const action = String(body.action || "toggle_hidden").trim();

    if (!accountId || !blNumber) {
      return res.status(400).json({ success: false, message: "화주 계정과 BL 번호가 필요합니다." });
    }

    const account = encodeURIComponent(accountId);
    const bl = encodeURIComponent(blNumber);
    const owned = await supabaseFetch(
      `/rest/v1/cargo_cards?select=id&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
    );
    if (!owned || !owned.length) {
      return res.status(404).json({ success: false, message: "대상 카드를 찾을 수 없습니다." });
    }

    if (action === "permanent_exclude" || action === "restore_exclusion") {
      const excluded = action === "permanent_exclude";
      const now = new Date().toISOString();
      const lifecycleRows = await supabaseFetch(
        "/rest/v1/cargo_card_lifecycle?on_conflict=account_id,bl_number",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            account_id: accountId,
            bl_number: blNumber,
            source_missing: false,
            source_missing_at: null,
            permanently_excluded: excluded,
            permanently_excluded_at: excluded ? now : null,
            permanently_excluded_by: excluded ? (session.login_id || "admin") : null,
            restored_at: excluded ? null : now,
            restored_by: excluded ? null : (session.login_id || "admin"),
          }),
        }
      );
      await supabaseFetch(
        "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            account_id: accountId,
            bl_number: blNumber,
            is_hidden: excluded,
            hidden_at: excluded ? now : null,
            hidden_by: excluded ? (session.login_id || "admin") : null,
          }),
        }
      );
      return res.status(200).json({
        success: true,
        lifecycle: lifecycleRows && lifecycleRows[0] ? lifecycleRows[0] : null,
      });
    }

    if (action !== "toggle_hidden") {
      return res.status(400).json({ success: false, message: "지원하지 않는 관리 작업입니다." });
    }

    const rows = await supabaseFetch(
      "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          account_id: accountId,
          bl_number: blNumber,
          is_hidden: hidden,
          hidden_at: hidden ? new Date().toISOString() : null,
          hidden_by: hidden ? (session.login_id || "admin") : null,
        }),
      }
    );

    return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
  } catch (error) {
    if (String(error.message || "").includes("cargo_card_lifecycle")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 20260724_add_progress_operations.sql을 먼저 실행해 주세요.",
      });
    }
    if (String(error.message || "").includes("is_hidden")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 add_cargo_card_visibility.sql을 먼저 실행해 주세요.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
