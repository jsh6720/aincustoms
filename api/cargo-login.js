const { createSession, supabaseFetch } = require("../lib/cargo-auth");
const { normalizeCalendarPreferences } = require("../lib/cargo-calendar-preferences");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { login_id, password } = req.body || {};
    const loginId = String(login_id || "").trim();
    if (!loginId || !password) {
      return res.status(400).json({ success: false, message: "아이디와 비밀번호를 입력해주세요." });
    }

    const accounts = await supabaseFetch("/rest/v1/rpc/verify_shipper_login", {
      method: "POST",
      body: JSON.stringify({ p_login_id: loginId, p_password: password }),
    });

    if (!accounts || accounts.length === 0) {
      return res.status(401).json({ success: false, message: "로그인 정보가 일치하지 않습니다." });
    }

    const account = accounts[0];
    const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    const token = createSession({
      account_id: account.id,
      login_id: account.login_id,
      display_name: account.display_name,
      consignee_filter: account.consignee_filter,
      role: account.role || "shipper",
      release_request_to: account.release_request_to || "",
      calendar_preferences: normalizeCalendarPreferences(account.calendar_preferences),
      exp: expiresAt,
    });

    res.setHeader(
      "Set-Cookie",
      `cargo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`
    );

    return res.status(200).json({
      success: true,
      user: {
        login_id: account.login_id,
        display_name: account.display_name,
        role: account.role || "shipper",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
