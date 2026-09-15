const { escapeHtml, wrapMailHtml, destinationName } = require("./cargo-mail-utils");

function warehouseName(value) {
  // Hide only the trailing customs area code, not company-name parentheses.
  return String(value || "").trim().replace(/\s*\(\d{8}(?:\/[A-Za-z0-9]+)?\)\s*$/, "");
}

function scheduleIdentity(snapshot) {
  return [String(snapshot.consignee || "").trim(), destinationName(snapshot.destination),
    String(snapshot.warehouse_expected_date || "").trim()];
}

function buildWarehouseScheduleMail(eventType, snapshot = {}) {
  const isEve = eventType === "warehouse_arrival_eve";
  if (!isEve && eventType !== "warehouse_arrival_today") throw new Error("지원하지 않는 입고 일정 알림 유형입니다.");
  const input = Array.isArray(snapshot) ? snapshot : [snapshot];
  if (!input.length) throw new Error("입고 안내할 화물이 없습니다.");
  const [consignee, destination, date] = scheduleIdentity(input[0]);
  if (!consignee || destination === "-" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(date)) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("입고 일정 정보가 올바르지 않습니다.");
  const byBl = new Map();
  for (const row of input) {
    if (JSON.stringify(scheduleIdentity(row)) !== JSON.stringify([consignee, destination, date])) throw new Error("다른 입고 일정은 통합할 수 없습니다.");
    const bl = String(row.bl_number || "").trim().toUpperCase();
    const yard = warehouseName(row.planned_storage_yard);
    if (!bl || !yard || /[\r\n]/.test(bl + consignee + destination)) throw new Error("B/L 또는 예정창고를 확인해 주세요.");
    if (byBl.has(bl) && byBl.get(bl) !== yard) throw new Error("동일 B/L의 예정창고가 서로 다릅니다.");
    byBl.set(bl, yard);
  }
  const rows = [...byBl].sort(([a], [b]) => a.localeCompare(b));
  const intro = `아래 화물 ${rows.length}건이 ${isEve ? "내일" : "오늘"}(${date}) 입고 예정되어 안내드립니다.`;
  const footer = ["본 메일은 발신전용 계정이오니,",
    "예정 내용이 실제 계획과 다르거나 수정 및 문의사항이 있으신 경우 아인합동관세사(jsh@aincustoms.com)로 말씀 부탁드리겠습니다.",
    "", "아인합동관세사무소 | 조재호, 정석현 대표 관세사", "TEL: 02-518-5434"];
  const cell = "border:1px solid #d8dde3;padding:7px 10px;text-align:left;";
  const head = ["No", "B/L", "입고예정창고"].map(label => `<th style="${cell}background:#f1f4f6;">${label}</th>`).join("");
  const body = rows.map(([bl, yard], i) => `<tr><td style="${cell}text-align:center;">${i + 1}</td><td style="${cell}">${escapeHtml(bl)}</td><td style="${cell}">${escapeHtml(yard)}</td></tr>`).join("");
  return {
    subject: `[${isEve ? "명일" : "금일"} 입고 예정 안내] ${consignee} / ${destination} / ${date.slice(5)} / ${rows.length}건(${rows.map(([bl]) => bl).join(", ")})`,
    text: ["안녕하세요. 아인합동관세사입니다.", "", intro, "", "No | B/L | 입고예정창고",
      ...rows.map(([bl, yard], i) => `${i + 1} | ${bl} | ${yard}`), "", ...footer].join("\n"),
    html: wrapMailHtml(`<p>안녕하세요. 아인합동관세사입니다.</p><p>${escapeHtml(intro)}</p><table style="border-collapse:collapse;font:inherit;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p>${footer.map(escapeHtml).join("<br>")}</p>`),
  };
}

module.exports = { buildWarehouseScheduleMail, scheduleIdentity, warehouseName };
