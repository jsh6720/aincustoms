const { linkedAccountIds } = require("./cargo-linked-records");

function koreaDate(now = new Date()) {
  return new Date(now.getTime() + (9 * 60 * 60 * 1000))
    .toISOString()
    .slice(0, 10);
}

async function linkedCardsForReceipt(supabaseFetch, card) {
  const folderName = String(card?.folder_name || "").trim();
  if (!folderName) return [card];
  const bl = encodeURIComponent(String(card.bl_number || "").trim());
  const folder = encodeURIComponent(folderName);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_cards?select=account_id,bl_number,folder_name&bl_number=eq.${bl}&folder_name=eq.${folder}`
  );
  return rows && rows.length ? rows : [card];
}

async function markLinkedOriginalDocsReceived({
  supabaseFetch,
  card,
  receivedDate,
  updatedBy,
}) {
  const linkedCards = await linkedCardsForReceipt(supabaseFetch, card);
  const accountIds = linkedAccountIds(card, linkedCards).sort();
  for (const accountId of accountIds) {
    const payload = {
      account_id: accountId,
      bl_number: card.bl_number,
      obl_received: true,
      hc_received: true,
      actual_received_date: receivedDate,
      updated_by: updatedBy,
    };
    await supabaseFetch(
      "/rest/v1/cargo_original_docs?on_conflict=account_id,bl_number",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload),
      }
    );
  }
  return { accountIds, receivedDate };
}

module.exports = {
  koreaDate,
  markLinkedOriginalDocsReceived,
};
