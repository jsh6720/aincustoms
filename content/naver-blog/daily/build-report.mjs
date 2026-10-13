// Build the daily card-news report email (mobile-first, single column) from report.json.
// Usage: node content/naver-blog/daily/build-report.mjs <YYYY-MM-DD>
//   reads  daily/out/<date>/report.json
//   writes daily/out/<date>/report.html
// No dependencies. Deterministic: same JSON -> same HTML.
//
// report.json schema
// {
//   "date": "2026-10-13",                 // run date (YYYY-MM-DD)
//   "rangeFrom": "2026-09-30",            // candidate search range start
//   "rangeTo": "2026-10-13",              // candidate search range end
//   "status": "drafts" | "none",         // drafts = N posts saved to Naver 임시저장; none = no-update day
//   "summary": "한 줄 요약 (optional)",   // one sentence under the header; omitted if empty
//   "posts": [                            // one entry per draft (empty when status = none)
//     {
//       "no": "09",                       // post number (posts/NN)
//       "category": "FTA·원산지",         // category label
//       "title": "...",                   // post title
//       "source": "...",                  // 원문 근거 (law/notice/case id + date)
//       "points": ["...", "...", "..."],  // 핵심 3줄 (exactly 3 strings)
//       "lawCheck": "...",                // 법령검증 result
//       "review": "...",                  // 독립 검토 verdict
//       "naver": "...",                   // 네이버 임시저장 status
//       "publishCategory": "...",         // category to pick when publishing
//       "tags": ["...", "..."],           // tags to enter when publishing (no #)
//       "cover": "C:/abs/path/card-01.png" // cover PNG; embedded inline as cid:cover-<no>
//     }
//   ],
//   "noneReport": ["...", "..."],        // status = none: up to 5 lines (sources checked, exclusions)
//   "footerNote": "..."                   // optional note (excluded items, next candidates); "\n" = line break
// }
//
// Email rules (fixed): single column, max-width 600px, every style inline, table layout only for
// stacking (never a multi-column data table), no background colour carries meaning, body text >= 15px.
// Cover images are referenced as <img src="cid:cover-<no>">; send-report.ps1 -InlineImages
// "cover-<no>=<path>" attaches them with that Content-ID. The builder prints the -InlineImages list.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: node build-report.mjs <YYYY-MM-DD>");
  process.exit(1);
}
const outDir = path.join(here, "out", date);
const jsonFile = path.join(outDir, "report.json");
const htmlFile = path.join(outDir, "report.html");
const data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const nl2br = (s) => esc(s).replace(/\r?\n/g, "<br>");
const md = (d) => {
  // "2026-10-13" -> "10/13", "2026. 10. 13."
  const [y, m, dd] = d.split("-").map(Number);
  return { short: `${m}/${dd}`, long: `${y}. ${m}. ${dd}.` };
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

// ---------- fixed style tokens (inline only) ----------
const FONT = "font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;";
const TEXT = "color:#1f2933;";
const MUTED = "color:#6b7280;";
const BODY = `${FONT}${TEXT}font-size:16px;line-height:1.7;word-break:keep-all;overflow-wrap:break-word;`;
const LABEL = `${FONT}${MUTED}font-size:13px;line-height:1.4;letter-spacing:0.02em;padding:14px 0 2px 0;`;
const VALUE = `${FONT}${TEXT}font-size:16px;line-height:1.7;padding:0;word-break:keep-all;overflow-wrap:break-word;`;
const RULE = "border-top:1px solid #d9dde3;font-size:0;line-height:0;height:1px;";

const row = (label, valueHtml) => `
<tr><td style="${LABEL}">${esc(label)}</td></tr>
<tr><td style="${VALUE}">${valueHtml}</td></tr>`;

const olPoints = (points) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
  points
    .map(
      (p, i) => `
<tr>
<td valign="top" width="24" style="${FONT}${TEXT}font-size:16px;line-height:1.7;padding:0 4px 4px 0;width:24px;white-space:nowrap;">${i + 1}.</td>
<td valign="top" style="${VALUE}padding:0 0 4px 0;">${nl2br(p)}</td>
</tr>`
    )
    .join("") +
  `</table>`;

// ---------- blocks ----------
const d = md(data.date);
const from = md(data.rangeFrom);
const to = md(data.rangeTo);
const posts = Array.isArray(data.posts) ? data.posts : [];
const n = posts.length;
const isNone = data.status === "none" || n === 0;

const headerLine = isNone
  ? `${d.short} 업데이트 없음`
  : `${d.short} 카드뉴스 초안 ${n}건 검수 요청`;
const rangeLine = `확인 범위 ${from.long}~${to.long} (${daysBetween(data.rangeFrom, data.rangeTo)}일)`;

const header = `
<tr><td style="${FONT}${TEXT}font-size:20px;line-height:1.4;font-weight:bold;padding:0 0 6px 0;">Ain 관세 인사이트 · ${esc(headerLine)}</td></tr>
<tr><td style="${FONT}${MUTED}font-size:14px;line-height:1.6;padding:0 0 12px 0;">${esc(rangeLine)}</td></tr>
${data.summary ? `<tr><td style="${BODY}padding:0 0 16px 0;">${nl2br(data.summary)}</td></tr>` : ""}`;

const card = (p) => {
  const cid = `cover-${p.no}`;
  const tags = (p.tags || []).map((t) => `<span style="white-space:nowrap;">#${esc(t)}</span>`).join(" ");
  return `
<tr><td style="padding:0 0 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border:1px solid #c9ced6;border-radius:10px;">
<tr><td style="padding:18px 18px 20px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
<tr><td align="center" style="padding:0 0 16px 0;">
<img src="cid:${cid}" width="280" height="350" alt="${esc(p.no)}번 표지" style="display:block;width:280px;max-width:100%;height:auto;border:1px solid #d9dde3;border-radius:8px;">
</td></tr>
<tr><td style="${FONT}${TEXT}font-size:13px;line-height:1.4;font-weight:bold;padding:0 0 6px 0;">${esc(p.no)}번 · ${esc(p.category)}</td></tr>
<tr><td style="${FONT}${TEXT}font-size:18px;line-height:1.5;font-weight:bold;padding:0 0 6px 0;word-break:keep-all;overflow-wrap:break-word;">${esc(p.title)}</td></tr>
<tr><td style="${RULE}padding:0;">&nbsp;</td></tr>
${row("원문 근거", nl2br(p.source))}
${row("핵심 3줄", olPoints(p.points || []))}
${row("법령검증", nl2br(p.lawCheck))}
${row("검토", nl2br(p.review))}
${row("네이버 상태", nl2br(p.naver))}
${row("발행 시 카테고리", esc(p.publishCategory))}
${row("태그", `<span style="${FONT}${TEXT}font-size:15px;line-height:1.8;">${tags}</span>`)}
</table>
</td></tr>
</table>
</td></tr>`;
};

const howTo = `
<tr><td style="padding:4px 0 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
<tr><td style="${FONT}${TEXT}font-size:17px;line-height:1.5;font-weight:bold;padding:0 0 8px 0;">어떻게 발행하나요</td></tr>
<tr><td style="${BODY}">
${posts.some(p => String(p.naver || "").includes("임시저장 완료")) ? `1. 네이버 블로그 앱 또는 PC에서 <b>글쓰기 → 임시저장 목록</b>을 엽니다.<br>
2. 위 번호의 글을 열어 본문과 카드 8장을 확인합니다.<br>
3. 발행 창에서 위의 <b>카테고리와 태그</b>를 넣고 발행합니다.<br>
4. 수정이 필요하면 Claude에게 "<b>${esc(posts[0]?.no ?? "NN")}번 이렇게 고쳐줘</b>"라고 말씀해 주세요.` : `1. 위 표지와 핵심 내용을 확인합니다.<br>
2. 올릴 글은 Claude에게 "<b>${esc(posts.map(p => p.no).join("·"))} 발행해</b>"처럼 번호로 말씀해 주세요. 네이버 발행과 홈페이지 반영까지 확인합니다.<br>
3. 수정이 필요하면 "<b>${esc(posts[0]?.no ?? "NN")}번 이렇게 고쳐줘</b>", 빼려면 "<b>${esc(posts[0]?.no ?? "NN")}번 제외</b>"라고 말씀해 주세요.`}
</td></tr>
</table>
</td></tr>`;

const noneBlock = `
<tr><td style="${BODY}padding:0 0 20px 0;">
${(data.noneReport || []).slice(0, 5).map((l) => nl2br(l)).join("<br>")}
</td></tr>`;

const footer = `
<tr><td style="${RULE}padding:0;">&nbsp;</td></tr>
${data.footerNote ? `<tr><td style="${FONT}${MUTED}font-size:14px;line-height:1.7;padding:14px 0 10px 0;word-break:keep-all;overflow-wrap:break-word;">${nl2br(data.footerNote)}</td></tr>` : ""}
<tr><td style="${FONT}${MUTED}font-size:13px;line-height:1.6;padding:6px 0 0 0;">아인합동관세사무소 · Ain 관세 인사이트 자동 보고 (${esc(d.long)}) · 발행 전 검수용</td></tr>`;

const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="ko">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(headerLine)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;${BODY}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
<tr><td align="center" style="padding:16px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;">
${header}
${isNone ? noneBlock : posts.map(card).join("")}
${isNone ? "" : howTo}
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;

fs.writeFileSync(htmlFile, html, "utf8");
const inline = posts.filter((p) => p.cover).map((p) => `cover-${p.no}=${p.cover}`);
console.log(`WROTE ${htmlFile} (${isNone ? "none" : n + " posts"})`);
if (inline.length) console.log(`INLINE ${inline.join(" ")}`);
