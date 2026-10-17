// Render every section.asset in an HTML file to out/<id>.png.
// Usage: PLAYWRIGHT_DIR=<dir with node_modules/playwright> node render.mjs [profile.html|activity.html]
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page.goto(pathToFileURL(path.join(here, process.argv[2] || "profile.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
for (const el of await page.locator("section.asset").all()) {
  const id = await el.getAttribute("id");
  await el.screenshot({ path: path.join(here, "out", `${id}.png`) });
  console.log(id);
}
await browser.close();
