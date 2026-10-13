// Render skin.html sections to out/<id>.png at exact pixel size.
// Usage: PLAYWRIGHT_DIR=<dir with node_modules/playwright> node render.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "skin.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
for (const el of await page.locator("section.asset").all()) {
  const id = await el.getAttribute("id");
  await el.screenshot({ path: path.join(out, `${id}.png`) });
  console.log(id, await el.evaluate(e => `${e.offsetWidth}x${e.offsetHeight}`));
}
await browser.close();
