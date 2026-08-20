const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const appRoot = path.join(root, "requirements");

function localAssetPaths(html, expression) {
  return Array.from(html.matchAll(expression), ([, asset]) => asset.split("?")[0]);
}

function packageFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? packageFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

test("requirements page resolves every shipped local asset in dependency order", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const styles = localAssetPaths(html, /<link[^>]+href="(css\/[^"]+)"/g);
  const scripts = localAssetPaths(html, /<script[^>]+src="(js\/[^"]+)"/g);

  assert.deepEqual(styles, [
    "css/style.css",
    "css/unified-search.css",
    "css/review-needed.css",
  ]);
  assert.deepEqual(scripts, [
    "js/runtime-config.js",
    "js/google-sheets-api.js",
    "js/date-formatter.js",
    "js/auth.js",
    "js/parser.js",
    "js/file-handler.js",
    "js/unified-search.js",
    "js/review-needed.js",
    "js/selection-delete.js",
    "js/duplicate-checker.js",
    "js/edit-request.js",
    "js/app.js",
  ]);

  for (const asset of [...styles, ...scripts, "data/msds.csv"]) {
    assert.equal(fs.existsSync(path.join(appRoot, asset)), true, `${asset} is shipped`);
  }
});

test("root navigation opens the local requirements application", () => {
  const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(
    homepage,
    /<a\s+href="\/requirements\/"\s+target="_blank"\s+rel="noopener noreferrer"[\s\S]*?>AIN 요건관리<\/a>/
  );
});

test("requirements package excludes source, runtime, and secret-bearing artifacts", () => {
  const allowed = new Set([
    "index.html",
    "css/style.css",
    "css/unified-search.css",
    "css/review-needed.css",
    "data/msds.csv",
    "js/runtime-config.js",
    "js/google-sheets-api.js",
    "js/date-formatter.js",
    "js/auth.js",
    "js/parser.js",
    "js/file-handler.js",
    "js/unified-search.js",
    "js/review-needed.js",
    "js/selection-delete.js",
    "js/duplicate-checker.js",
    "js/edit-request.js",
    "js/app.js",
  ]);
  const files = packageFiles(appRoot);
  assert.deepEqual(new Set(files), allowed);

  for (const file of files) {
    const content = fs.readFileSync(path.join(appRoot, file), "utf8");
    assert.doesNotMatch(content, /https?:\/\/(?:www\.)?genspark(?:space\.com|\.ai)\//i, file);
    assert.doesNotMatch(content, /(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i, file);
  }
});
