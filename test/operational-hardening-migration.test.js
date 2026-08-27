const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260828090000_add_operational_hardening.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("migration defines the complete mail delivery state machine", () => {
  for (const status of [
    "pending",
    "sending",
    "sent",
    "failed",
    "delivery_uncertain",
  ]) {
    assert.match(sql, new RegExp(String.raw`['"]${status}['"]`, "i"));
  }
  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+claim_token\s+uuid/i);
  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+claimed_at\s+timestamptz/i);
  assert.match(
    sql,
    /create\s+index[\s\S]+where\s+status\s+in\s*\(\s*'pending'\s*,\s*'failed'\s*\)/i,
  );
});

test("migration defines atomic automatic, manual, and settlement RPCs", () => {
  assert.match(
    sql,
    /public\.claim_cargo_automatic_mail\s*\(\s*p_event_id\s+uuid\s*,\s*p_allowed_event_types\s+text\[\]/i,
  );
  assert.match(
    sql,
    /public\.claim_cargo_manual_mail\s*\([\s\S]*p_event_key\s+text[\s\S]*p_card_snapshot\s+jsonb/i,
  );
  assert.match(
    sql,
    /public\.settle_cargo_mail\s*\([\s\S]*p_event_id\s+uuid[\s\S]*p_claim_token\s+uuid[\s\S]*p_status\s+text/i,
  );
  assert.match(sql, /for\s+update/i);
  assert.match(sql, /status\s*=\s*'sending'/i);
  assert.match(sql, /status\s*=\s*'delivery_uncertain'/i);
  assert.match(sql, /n\.claim_token\s*=\s*p_claim_token/i);
});

test("every privileged RPC has an empty search path and service-role-only execute", () => {
  const normalized = sql.replace(/\s+/g, " ");
  for (const name of [
    "claim_cargo_automatic_mail",
    "claim_cargo_manual_mail",
    "settle_cargo_mail",
  ]) {
    const functionStart = normalized.indexOf("create function public." + name + "(");
    assert.notEqual(functionStart, -1);
    const functionEnd = normalized.indexOf("$$;", functionStart);
    assert.notEqual(functionEnd, -1);
    const definition = normalized.slice(functionStart, functionEnd + 3);
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path = ''/i);
    assert.match(definition, /public\.cargo_status_notifications/i);

    const revokeStart = normalized.indexOf(
      "revoke all on function public." + name + "(",
      functionEnd,
    );
    const revokeEnd = normalized.indexOf(";", revokeStart);
    assert.notEqual(revokeStart, -1);
    assert.match(
      normalized.slice(revokeStart, revokeEnd + 1),
      /from public, anon, authenticated;/i,
    );

    const grantStart = normalized.indexOf(
      "grant execute on function public." + name + "(",
      revokeEnd,
    );
    const grantEnd = normalized.indexOf(";", grantStart);
    assert.notEqual(grantStart, -1);
    assert.match(
      normalized.slice(grantStart, grantEnd + 1),
      /to service_role;/i,
    );
  }
});

test("schema metadata is protected and records the exact version", () => {
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.cargo_system_metadata/i);
  assert.match(
    sql,
    /alter\s+table\s+public\.cargo_system_metadata\s+enable\s+row\s+level\s+security/i,
  );
  assert.match(
    sql,
    /revoke\s+all\s+on\s+table\s+public\.cargo_system_metadata\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(sql, /'cargo_dashboard'/i);
  assert.match(sql, /'20260828090000'/i);
  assert.match(sql, /'20260828090000_add_operational_hardening\.sql'/i);
});

test("migration is additive and contains no production password literal", () => {
  assert.doesNotMatch(sql, /\bdrop\s+(?:table|column)\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\b(?:password_hash|p_password)\b/i);
  assert.doesNotMatch(sql, /\bcrypt\s*\(/i);
});
