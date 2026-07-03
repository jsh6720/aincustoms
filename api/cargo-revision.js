const { verifySession, supabaseFetch } = require("./_cargo-auth");

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function cleanText(value) {
  return String(value || "").trim();
}

async function findCard(session, body) {
  const isAdmin = (session.role || "shipper") === "admin";
  const accountId = isAdmin
    ? cleanText(body.account_id || session.account_id)
    : cleanText(session.account_id);
  const blNumber = cleanText(body.bl_number);

  if (!accountId || !blNumber) {
    throw new Error("account_id와 B/L 번호가 필요합니다.");
  }

  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_cards?select=account_id,bl_number,revisions&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  const card = rows && rows[0] ? rows[0] : null;
  if (!card) {
    throw new Error("조회 권한이 없거나 해당 B/L 카드를 찾을 수 없습니다.");
  }
  return {
    accountId,
    blNumber,
    revisions: Array.isArray(card.revisions) ? card.revisions : [],
  };
}

async function saveRevisions(accountId, blNumber, revisions) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(`/rest/v1/cargo_cards?account_id=eq.${account}&bl_number=eq.${bl}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ revisions }),
  });
  return rows && rows[0] ? rows[0].revisions : revisions;
}

module.exports = async function handler(req, res) {
  if (!["POST", "PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "POST, PUT, DELETE");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = verifySession(req);
    if (!session) {
      return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const card = await findCard(session, body);
    let revisions = [...card.revisions];

    if (req.method === "POST") {
      const text = cleanText(body.text);
      if (!text) {
        return res.status(400).json({ success: false, message: "확인사항을 입력해 주세요." });
      }
      revisions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        created_at: nowIso(),
        created_by: session.login_id || "",
      });
    }

    if (req.method === "PUT") {
      const id = cleanText(body.id);
      const text = cleanText(body.text);
      if (!id || !text) {
        return res.status(400).json({ success: false, message: "수정할 확인사항이 올바르지 않습니다." });
      }
      revisions = revisions.map((item) =>
        String(item.id || "") === id
          ? { ...item, text, updated_at: nowIso(), updated_by: session.login_id || "" }
          : item
      );
    }

    if (req.method === "DELETE") {
      const id = cleanText(body.id);
      if (!id) {
        return res.status(400).json({ success: false, message: "삭제할 확인사항이 올바르지 않습니다." });
      }
      revisions = revisions.filter((item) => String(item.id || "") !== id);
    }

    const saved = await saveRevisions(card.accountId, card.blNumber, revisions);
    return res.status(200).json({ success: true, revisions: saved });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
