const { verifySession, supabaseFetch } = require("./_cargo-auth");

const STAGE_ORDER = ["입항전", "입항", "반입", "수입신고", "반출"];

function sortCards(a, b) {
  const alertRank = { over: 0, warn: 1, "": 2, null: 2, undefined: 2 };
  const ar = alertRank[a.quota_alert] ?? 2;
  const br = alertRank[b.quota_alert] ?? 2;
  if (ar !== br) return ar - br;

  const sr = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
  if (sr !== 0) return sr;

  return String(a.warehouse_arrival_date || "9999").localeCompare(String(b.warehouse_arrival_date || "9999"));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const accountId = encodeURIComponent(session.account_id);
    const cards = await supabaseFetch(
      `/rest/v1/cargo_cards?select=*&account_id=eq.${accountId}&order=synced_at.desc`
    );

    const sorted = (cards || []).sort(sortCards);
    const counts = {};
    STAGE_ORDER.forEach((stage) => {
      counts[stage] = 0;
    });
    sorted.forEach((card) => {
      counts[card.stage] = (counts[card.stage] || 0) + 1;
    });

    return res.status(200).json({
      success: true,
      user: {
        login_id: session.login_id,
        display_name: session.display_name,
      },
      stages: STAGE_ORDER,
      counts,
      total: sorted.length,
      cards: sorted,
      last_update: sorted[0] ? sorted[0].synced_at : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};