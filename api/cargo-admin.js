const { verifySession, supabaseFetch } = require("../lib/cargo-auth");
const {
  MAIL_SETTING_KEYS,
  normalizeMailSettings,
} = require("../lib/cargo-mail-settings");
const { parseRecipientList } = require("../lib/cargo-mail-utils");

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

function normalizeRecipientText(value) {
  return parseRecipientList(cleanText(value, 4000)).join(",");
}

module.exports = async function handler(req, res) {
  try {
    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method === "GET") {
      let accounts;
      try {
        accounts = await supabaseFetch(
          "/rest/v1/shipper_accounts?select=id,login_id,display_name,consignee_filter,release_request_to,role,account_category,is_active,updated_at&order=role.asc,login_id.asc"
        );
      } catch (error) {
        if (!String(error.message || "").includes("account_category")) throw error;
        accounts = await supabaseFetch(
          "/rest/v1/shipper_accounts?select=id,login_id,display_name,consignee_filter,release_request_to,role,is_active,updated_at&order=role.asc,login_id.asc"
        );
      }
      let mailSettingRows = [];
      try {
        mailSettingRows = await supabaseFetch(
          "/rest/v1/cargo_mail_settings?select=setting_key,to_recipients,cc_recipients,updated_at,updated_by&order=setting_key.asc"
        );
      } catch {
        mailSettingRows = [];
      }
      return res.status(200).json({
        success: true,
        accounts: accounts || [],
        mail_settings: normalizeMailSettings(mailSettingRows),
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.action === "mail_settings") {
        const rawSettings = body.settings && typeof body.settings === "object" ? body.settings : {};
        const now = new Date().toISOString();
        const rows = MAIL_SETTING_KEYS.map((settingKey) => ({
          setting_key: settingKey,
          to_recipients: normalizeRecipientText(rawSettings[settingKey]?.to),
          cc_recipients: normalizeRecipientText(rawSettings[settingKey]?.cc),
          updated_at: now,
          updated_by: session.login_id || "admin",
        }));
        const saved = await supabaseFetch(
          "/rest/v1/cargo_mail_settings?on_conflict=setting_key",
          {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(rows),
          }
        );
        return res.status(200).json({
          success: true,
          mail_settings: normalizeMailSettings(saved || rows),
        });
      }

      const payload = {
        p_id: body.id || null,
        p_login_id: cleanText(body.login_id, 80),
        p_password: String(body.password || ""),
        p_display_name: cleanText(body.display_name, 120),
        p_consignee_filter: cleanText(body.consignee_filter, 200),
        p_release_request_to: cleanText(body.release_request_to, 1000),
        p_is_active: body.is_active !== false,
        p_role: body.role === "admin" || body.role === "viewer" ? body.role : "shipper",
        p_account_category: body.account_category === "destination"
          ? "destination"
          : body.account_category === "samhyeon"
            ? "samhyeon"
            : "shipper",
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
    if (String(error.message || "").includes("cargo_mail_settings")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 20260726_add_cargo_mail_settings.sql을 먼저 실행해 주세요.",
      });
    }
    if (String(error.message || "").includes("admin_upsert_shipper_account")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 20260724_add_document_delivery_status.sql을 먼저 실행해 주세요.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
