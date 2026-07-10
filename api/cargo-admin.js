const { verifySession, supabaseFetch } = require("../lib/cargo-auth");

function requireAdmin(req, res) {
  const session = verifySession(req);
  if (!session) {
    res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    return null;
  }
  if (session.role !== "admin") {
    res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    return null;
  }
  return session;
}

function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  try {
    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method === "GET") {
      const accounts = await supabaseFetch(
        "/rest/v1/shipper_accounts?select=id,login_id,display_name,consignee_filter,release_request_to,role,is_active,updated_at&order=role.asc,login_id.asc"
      );
      return res.status(200).json({ success: true, accounts: accounts || [] });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const payload = {
        p_id: body.id || null,
        p_login_id: cleanText(body.login_id, 80),
        p_password: String(body.password || ""),
        p_display_name: cleanText(body.display_name, 120),
        p_consignee_filter: cleanText(body.consignee_filter, 200),
        p_release_request_to: cleanText(body.release_request_to, 1000),
        p_is_active: body.is_active !== false,
        p_role: body.role === "admin" ? "admin" : "shipper",
      };

      if (!payload.p_login_id) {
        return res.status(400).json({ success: false, message: "아이디를 입력해 주세요." });
      }
      if (!payload.p_id && !payload.p_password) {
        return res.status(400).json({ success: false, message: "신규 계정은 비밀번호가 필요합니다." });
      }
      if (payload.p_role === "shipper" && !payload.p_consignee_filter) {
        return res.status(400).json({ success: false, message: "화주 계정은 필터텍스트가 필요합니다." });
      }

      const rows = await supabaseFetch("/rest/v1/rpc/admin_upsert_shipper_account", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.status(200).json({ success: true, account: rows && rows[0] ? rows[0] : null });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    if (String(error.message || "").includes("admin_upsert_shipper_account")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 add_admin_management.sql을 먼저 실행해 주세요.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};