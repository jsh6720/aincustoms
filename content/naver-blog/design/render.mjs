// Render template.html cards to preview/card-0N.png (1080x1350, device scale 1).
// Usage: npm i playwright@1.64.0 --prefix <dir> && npx playwright@1.64.0 install chromium (once),
//        then: PLAYWRIGHT_DIR=<dir> node render.mjs [template.html] [outDir]
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// playwright is resolved from PLAYWRIGHT_DIR (a folder that has node_modules/playwright) or next to this file
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright");
const html = path.resolve(process.argv[2] || path.join(here, "template.html"));
const out = path.resolve(process.argv[3] || path.join(here, "preview"));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1160, height: 1430 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const cards = page.locator("section.card");
const n = await cards.count();
for (let i = 0; i < n; i++) {
  const card = cards.nth(i);
  const file = path.join(out, `card-${String(i + 1).padStart(2, "0")}.png`);
  await card.screenshot({ path: file });
  // overflow check: any descendant extending past the card box
  const over = await card.evaluate(el => {
    const r = el.getBoundingClientRect(); const bad = [];
    for (const d of el.querySelectorAll("*")) {
      const b = d.getBoundingClientRect(); if ((!b.width && !b.height) || d.hasAttribute("data-bleed")) continue;
      if (b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1 || b.top < r.top - 1)
        bad.push(`${d.className || d.tagName} (${Math.round(b.right - r.right)}, ${Math.round(b.bottom - r.bottom)})`);
    }
    const body = el.querySelector(".body"); const bb = body.getBoundingClientRect();
    return { bad: bad.slice(0, 5), bodyOverflow: body.scrollHeight - Math.round(bb.height) };
  });
  console.log(path.basename(file), over.bad.length ? "OVERFLOW " + over.bad.join("; ") : "ok", over.bodyOverflow > 0 ? `body +${over.bodyOverflow}px` : "");
}
await browser.close();
