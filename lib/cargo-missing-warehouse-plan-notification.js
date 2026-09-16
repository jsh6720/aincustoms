const { escapeHtml, wrapMailHtml, destinationName } = require("./cargo-mail-utils");
const MISSING_FIELDS = ["반입예정구역", "반입예정일"];
const clean = value => String(value || "").trim();

function missingPlanIdentity(snapshot) {
  return [clean(snapshot.consignee) || "-", destinationName(snapshot.destination), clean(snapshot.notice_date)];
}
function buildMissingWarehousePlanMail(snapshot = {}) {
  const input = Array.isArray(snapshot) ? snapshot : [snapshot];
  if (!input.length) throw new Error("반입예정정보 확인 대상이 없습니다.");
  const [consignee, destination, date] = missingPlanIdentity(input[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("확인 기준일이 올바르지 않습니다.");
  const byBl = new Map();
  for (const row of input) {
    if (JSON.stringify(missingPlanIdentity(row)) !== JSON.stringify([consignee, destination, date])) {
      throw new Error("다른 확인 기준일 또는 화주·납품처는 통합할 수 없습니다.");
    }
    const bl = clean(row.bl_number).replace(/\s+/g, "").toUpperCase();
    const oblDate = clean(row.obl_carrier_submitted_date);
    const fields = MISSING_FIELDS.filter(field => row.missing_warehouse_plan_fields?.includes(field));
    if (!bl || !oblDate || !fields.length || /[\r\n]/.test(clean(row.bl_number) + consignee + destination)) {
      throw new Error("B/L, OBL 접수일 또는 미입력 항목을 확인해 주세요.");
    }
    const values = [oblDate, fields.join(", ")];
    if (byBl.has(bl) && JSON.stringify(byBl.get(bl)) !== JSON.stringify(values)) {
      throw new Error("동일 B/L의 미입력 정보가 서로 다릅니다.");
    }
    byBl.set(bl, values);
  }
  const rows = [...byBl].sort(([a], [b]) => a.localeCompare(b));
  const intro = "OBL 접수가 확인된 아래 " + rows.length + "건의 반입예정정보가 입력되지 않았습니다.";
  const footer = ["대시보드에서 미입력 항목을 확인 후 입력해 주시기 바랍니다.", "", "감사합니다.", "아인합동관세사무소"];
  const cells = ["No", "B/L", "OBL 접수일", "미입력 항목"];
  const data = rows.map(([bl, values], index) => [String(index + 1), bl, ...values]);
  const style = "border:1px solid #d8dde3;padding:7px 10px;text-align:left;";
  const head = cells.map(v => '<th style="' + style + 'background:#f1f4f6;">' + escapeHtml(v) + "</th>").join("");
  const body = data.map(row => "<tr>" + row.map(v => '<td style="' + style + '">' + escapeHtml(v) + "</td>").join("") + "</tr>").join("");
  const context = ["화주명: " + consignee, "납품처: " + destination, "확인 기준일: " + date];
  return {
    subject: "[반입예정정보 입력 확인] " + consignee + " / " + destination + " / " + date.slice(5)
      + " / " + rows.length + "건(" + rows.map(([bl]) => bl).join(", ") + ")",
    text: ["안녕하세요. 아인합동관세사입니다.", "", intro, "", ...context, "",
      cells.join(" | "), ...data.map(row => row.join(" | ")), "", ...footer].join("\n"),
    html: wrapMailHtml("<p>안녕하세요. 아인합동관세사입니다.</p><p>" + escapeHtml(intro) + "</p><p>"
      + context.map(escapeHtml).join("<br>") + '</p><table style="border-collapse:collapse;font:inherit;"><thead><tr>'
      + head + "</tr></thead><tbody>" + body + "</tbody></table><p>" + footer.map(escapeHtml).join("<br>") + "</p>"),
  };
}

module.exports = { buildMissingWarehousePlanMail, missingPlanIdentity };
