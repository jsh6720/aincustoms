const { createSession, verifySession, supabaseFetch } = require("../lib/cargo-auth");
const {
  normalizeCalendarPreferences,
  validateCalendarPreferences,
} = require("../lib/cargo-calendar-preferences");

module.exports = async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

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
};
