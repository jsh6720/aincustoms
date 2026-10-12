// Build posts/<id>/cards.html from template.html + posts/<id>/post.json, then render to cards/<id>/card-0N.png.
// Usage: PLAYWRIGHT_DIR=<dir> node design/render-posts.mjs [01 02 ...]   (no args = every folder in posts/)
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const design = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(design);
const template = fs.readFileSync(path.join(design, "template.html"), "utf8");
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(root, "posts")).filter(d => fs.existsSync(path.join(root, "posts", d, "post.json")));

for (const id of ids) {
  const post = JSON.parse(fs.readFileSync(path.join(root, "posts", id, "post.json"), "utf8"));
  // Law-verification gate (PROCESS.md step 4): every statute must be checked against current law first.
  const checked = Date.parse(post.lawCheck?.checkedOn ?? "");
  if (!(Date.now() - checked <= 30 * 864e5)) throw new Error(`post ${id}: lawCheck.checkedOn missing or older than 30 days — run the statute check (PROCESS.md step 4)`);
  const html = template
    .replace("<head>", `<head>\n<base href="../../design/">`)
    .replace(/window\.POST = \{[\s\S]*?\n\};\n/, () => `window.POST = ${JSON.stringify(post, null, 2)};\n`);
  if (!html.includes(JSON.stringify(post, null, 2))) throw new Error("template POST block not found");
  const page = path.join(root, "posts", id, "cards.html");
  fs.writeFileSync(page, html);
  console.log(`# post ${id}`);
  execFileSync(process.execPath, [path.join(design, "render.mjs"), page, path.join(root, "cards", id)], { stdio: "inherit" });
}
