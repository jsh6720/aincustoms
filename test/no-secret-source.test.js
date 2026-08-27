const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
}

function trackedText() {
  return trackedFiles()
    .filter((file) => !/\.(?:png|jpe?g|gif|ico|woff2?|pdf)$/i.test(file))
    .map((file) => ({
      file,
      text: fs.readFileSync(path.join(ROOT, file), "utf8"),
    }));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("tracked source contains no known bootstrap credential or key value", () => {
  const forbidden = [
    ["dkd", "ls123!"].join(""),
    ["ctf", "1234"].join(""),
    ["dwr", "1234"].join(""),
    ["shyun", "11"].join(""),
  ];
  const findings = [];

  for (const { file, text } of trackedText()) {
    for (const value of forbidden) {
      if (text.includes(value)) findings.push(file + ": known bootstrap credential");
    }
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) {
      findings.push(file + ": Supabase secret key");
    }
    if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text)) {
      findings.push(file + ": JWT-like service key");
    }
    if (/\bapi_key\b\s*[:=]\s*["'][^"']{12,}["']/i.test(text)) {
      findings.push(file + ": hardcoded API key");
    }
  }

  assert.deepEqual(findings, []);
});

test("historical account migrations never embed or overwrite bootstrap passwords", () => {
  const migrations = [
    "20260724_add_calendar_preferences_and_ctf.sql",
    "20260806_add_dawoorin_account.sql",
  ].map((name) => fs.readFileSync(
    path.join(ROOT, "supabase", "migrations", name),
    "utf8",
  ));

  for (const sql of migrations) {
    assert.match(sql, /gen_random_uuid\(\)::text/i);
    assert.doesNotMatch(sql, /extensions\.crypt\s*\(\s*'[^']+'/i);
    assert.doesNotMatch(
      sql,
      /on\s+conflict[\s\S]{0,600}password_hash\s*=/i,
    );
  }
});

test("Node dependency is exact and reproducible", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lockPath = path.join(ROOT, "package-lock.json");

  assert.equal(packageJson.dependencies.nodemailer, "9.0.6");
  assert.ok(fs.existsSync(lockPath), "package-lock.json is required");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.packages[""].dependencies.nodemailer, "9.0.6");
});

test("homepage mirror manifest hashes every authoritative source", () => {
  const manifestPath = path.join(ROOT, "dashboard-mirror-manifest.json");
  assert.ok(fs.existsSync(manifestPath), "dashboard-mirror-manifest.json is required");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 20);
  for (const item of manifest.files) {
    assert.equal(sha256(path.join(ROOT, item.source)), item.sha256, item.source);
    assert.ok(item.target.startsWith("website_integration/"));
  }
});
