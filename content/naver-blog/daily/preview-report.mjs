// Preview report.html at phone/desktop widths, light + dark. cid: images are swapped for file paths.
// Usage: PLAYWRIGHT_DIR=<pw dir> node preview-report.mjs <reportDir>
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR, "x.js"));
const { chromium } = require("playwright");
const dir = path.resolve(process.argv[2]);
const data = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
let html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
for (const p of data.posts || []) html = html.replaceAll(`cid:cover-${p.no}`, pathToFileURL(p.cover).href);
// Dark simulation (Outlook mobile dark mode recolours text/background; email has no dark CSS of its own)
const darkCss = `<style>html,body{background:#121212!important}*{color:#e8e8e8!important}[style*="color:#6b7280"]{color:#a0a6b0!important}</style>`;
const tmp = path.join(dir, "preview-tmp.html");
const browser = await chromium.launch();
const shots = [
  ["preview-390-light.png", 390, false],
  ["preview-390-dark.png", 390, true],
  ["preview-600-light.png", 600, false],
];
for (const [name, width, dark] of shots) {
  fs.writeFileSync(tmp, dark ? html.replace("</head>", darkCss + "</head>") : html, "utf8");
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
  console.log(name, `scrollWidth=${m.sw} clientWidth=${m.cw} height=${m.h}`, m.sw > m.cw ? "HORIZONTAL SCROLL" : "ok");
  await page.close();
}
fs.unlinkSync(tmp);
await browser.close();
