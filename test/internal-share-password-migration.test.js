const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20260917090000_internal_share_password.sql'), 'utf8');
const statements = sql.replace(/--[^\n]*/g, '');
const normalized = statements.replace(/\s+/g, ' ').trim();

function functionBody(name) {
  const match = statements.match(new RegExp(
    String.raw`create\s+function\s+public\.${name}\s*\([\s\S]*?\$\$([\s\S]*?)\$\$;`, 'i'));
  assert.ok(match, `${name} exists`);
  return match[0];
}

test('password storage is a bounded singleton with an explicit environment bootstrap state', () => {
  assert.match(normalized, /^begin; .* commit;$/i);
  assert.match(statements, /id\s+text\s+primary\s+key\s+check\s*\(id\s*=\s*'team'\)/i);
  assert.match(statements, /password_hash\s+text\s*,/i);
  assert.match(statements, /revision\s+bigint\s+not\s+null\s+default\s+0\s+check\s*\(revision\s+between\s+0\s+and\s+9007199254740991\)/i);
  assert.match(statements, /updated_at\s+timestamptz\s+not\s+null\s+default\s+clock_timestamp\(\)/i);
  assert.match(normalized, /\(revision = 0 and password_hash is null\) or \(revision > 0 and password_hash is not null and password_hash ~/i);
  assert.match(normalized, /insert into public\.internal_share_credentials \(id\) values \('team'\);/i);
});

test('both the table and change RPC require the agreed scrypt hash format', () => {
  const checks = [...statements.matchAll(/(?:password_hash\s+~|p_password_hash\s+!~)\s+'([^']+)'/g)];
  assert.equal(checks.length, 2);
  for (const [, pattern] of checks) {
    assert.equal(pattern, '^scrypt:[A-Za-z0-9_-]{22,86}:[A-Za-z0-9_-]{86}$');
    const accepts = new RegExp(pattern);
    const hash = (salt, key) => `scrypt:${salt}:${key}`;
    for (const saltLength of [22, 43, 86]) {
      assert.ok(accepts.test(hash('a'.repeat(saltLength), 'b'.repeat(86))));
    }
    for (const candidate of [
      '', 'plaintext', hash('a'.repeat(21), 'b'.repeat(86)),
      hash('a'.repeat(87), 'b'.repeat(86)), hash('a'.repeat(22), 'b'.repeat(85)),
      hash('a'.repeat(22), 'b'.repeat(87)), hash('a'.repeat(21) + '/', 'b'.repeat(86)),
      hash('a'.repeat(22), 'b'.repeat(85) + '='),
    ]) assert.equal(accepts.test(candidate), false);
  }
});

test('all direct table privileges are revoked and both RPCs are service-role only', () => {
  assert.match(normalized, /alter table public\.internal_share_credentials enable row level security;/i);
  assert.match(normalized, /revoke all on table public\.internal_share_credentials from public, anon, authenticated, service_role;/i);
  assert.doesNotMatch(statements, /\bgrant\s+[^;]*\bon\s+table\b/i);
  assert.doesNotMatch(statements, /\bcreate\s+policy\b/i);
  for (const [name, args] of [
    ['internal_share_auth_state', ''], ['internal_share_password_change', 'bigint, text'],
  ]) {
    const body = functionBody(name);
    assert.match(body, /returns\s+jsonb/i);
    assert.match(body, /security\s+definer/i);
    assert.match(body, /set\s+search_path\s*=\s*''/i);
    assert.ok(normalized.includes(`revoke all on function public.${name}(${args}) from public, anon, authenticated, service_role;`));
    assert.ok(normalized.includes(`grant execute on function public.${name}(${args}) to service_role;`));
  }
  const grants = [...statements.matchAll(/\bgrant\s+([^;]+);/gi)].map(match => match[1]);
  assert.equal(grants.length, 2);
  for (const grant of grants) assert.match(grant, /^execute on function public\.internal_share_(?:auth_state\(\)|password_change\(bigint, text\)) to service_role$/i);
});

test('authentication state reads only the singleton and fails closed if it is missing', () => {
  const body = functionBody('internal_share_auth_state');
  assert.match(body, /select\s+\*\s+into\s+strict\s+v_state\s+from\s+public\.internal_share_credentials\s+where\s+id\s*=\s*'team'/i);
  assert.match(body, /return\s+jsonb_build_object\('revision',\s*v_state\.revision,\s*'password_hash',\s*v_state\.password_hash\)/i);
  assert.doesNotMatch(body, /\b(?:insert|update|delete|execute)\b/i);
});

test('password changes validate parameters before locking and atomically compare the revision', () => {
  const body = functionBody('internal_share_password_change');
  assert.match(body, /p_expected_revision is null or p_expected_revision < 0[\s\S]*?p_expected_revision > 9007199254740991[\s\S]*?p_password_hash is null[\s\S]*?errcode = '22023'/i);
  const lock = body.indexOf("where id = 'team' for update;");
  const conflict = body.indexOf('if v_state.revision <> p_expected_revision then');
  const limit = body.indexOf('if v_state.revision >= 9007199254740991 then');
  const increment = body.indexOf('v_revision := v_state.revision + 1;');
  const update = body.indexOf('update public.internal_share_credentials');
  assert.ok(lock > body.indexOf("errcode = '22023'"));
  assert.ok(conflict > lock && limit > conflict && increment > limit && update > increment);
  assert.match(body.slice(conflict, limit), /return jsonb_build_object\('changed', false\);\s*end if;/i);
  assert.match(body.slice(limit, increment), /raise exception using errcode = '54000'/i);
  assert.match(body.slice(update), /set password_hash = p_password_hash,\s*revision = v_revision,\s*updated_at = clock_timestamp\(\)\s*where id = 'team';/i);
  assert.match(body.slice(update), /return jsonb_build_object\('changed', true, 'revision', v_revision\);/i);
});

test('migration writes only its new credential singleton and contains no embedded hash or password', () => {
  assert.doesNotMatch(statements, /\b(?:drop|truncate|delete)\b/i);
  assert.doesNotMatch(statements, /\bcreate\s+or\s+replace\b/i);
  const relations = [...statements.matchAll(/\b(?:create\s+table|alter\s+table|insert\s+into|update)\s+(public\.[a-z_]+)/gi)]
    .map(match => match[1]);
  assert.equal(relations.length, 4);
  assert.deepEqual([...new Set(relations)], ['public.internal_share_credentials']);
  assert.doesNotMatch(statements, /\binternal_share_(?:updates|heads|login_attempts)\b/i);
  assert.doesNotMatch(statements, /'scrypt:[A-Za-z0-9_-]{22,86}:[A-Za-z0-9_-]{86}'/);
  assert.doesNotMatch(statements, /\b(?:password|password_hash)\s*=\s*'/i);
});
