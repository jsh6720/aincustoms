const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationRoot = path.join(__dirname, '..', 'supabase', 'migrations');
const sql = fs.readFileSync(path.join(migrationRoot,
  '20260917110000_internal_share_read_page.sql'), 'utf8');
const statements = sql.replace(/--[^\n]*/g, '');
const normalized = statements.replace(/\s+/g, ' ').trim();
const body = statements.match(/as\s+\$\$([\s\S]*?)\$\$;/i)?.[1];

test('page RPC is a private stable read with a safe cursor and fixed limits', () => {
  assert.match(normalized, /^begin; .* commit;$/i);
  assert.match(normalized, /create function public\.internal_share_read_page\(p_after bigint\) returns jsonb language plpgsql stable security invoker set search_path = ''/i);
  assert.ok(body);
  assert.match(body, /if p_after is null or p_after < 0 or p_after > 9007199254740991 then\s*raise exception using errcode = '22023'/i);
  assert.ok(body.indexOf("errcode = '22023'") < body.indexOf('with metadata'));
  assert.match(normalized, /revoke all on function public\.internal_share_read_page\(bigint\) from public, anon, authenticated, service_role;/i);
  assert.match(normalized, /grant execute on function public\.internal_share_read_page\(bigint\) to service_role;/i);
  const grants = [...statements.matchAll(/\bgrant\s+([^;]+);/gi)].map(match => match[1]);
  assert.deepEqual(grants, ['execute on function public.internal_share_read_page(bigint) to service_role']);
  assert.doesNotMatch(statements, /\b(?:create\s+policy|security\s+definer|set\s+row_security|volatile)\b/i);
});

test('only 257 metadata rows are read before the ordered byte budget selects a prefix', () => {
  assert.match(normalized, /with metadata as materialized \( select u\.seq, u\.update_bytes from public\.internal_share_updates as u where u\.document_id = 'team' and u\.seq > p_after order by u\.seq limit 257 \)/i);
  const metadata = body.slice(body.indexOf('with metadata'), body.indexOf('), budgeted'));
  assert.doesNotMatch(metadata, /\b(?:update_base64|op_id|author|created_at)\b|select\s+\*/i);
  assert.match(normalized, /budgeted as materialized \( select m\.seq, row_number\(\) over \(order by m\.seq\) as row_position, sum\(4 \* \(\(m\.update_bytes \+ 2\) \/ 3\) \+ 256\) over \(order by m\.seq rows between unbounded preceding and current row\) as serialized_bytes from metadata as m \)/i);
  assert.match(normalized, /chosen as materialized \( select b\.seq from budgeted as b where b\.row_position <= 256 and b\.serialized_bytes <= 3 \* 1024 \* 1024 order by b\.seq \)/i);
  assert.doesNotMatch(body, /\b(?:offset|random|decode|encode|octet_length|char_length)\s*\(/i);
});

test('payloads are joined only for chosen sequences and returned in sequence order', () => {
  const selectionEnd = body.indexOf('), page_cursor');
  assert.ok(selectionEnd > 0);
  assert.equal(body.slice(0, selectionEnd).includes('update_base64'), false);
  assert.match(normalized, /select jsonb_agg\(jsonb_build_object\( 'seq', u\.seq, 'op_id', u\.op_id, 'update_base64', u\.update_base64 \) order by u\.seq\) from chosen as c join public\.internal_share_updates as u on u\.document_id = 'team' and u\.seq = c\.seq/i);
  assert.equal([...body.matchAll(/\bpublic\.internal_share_updates\b/g)].length, 2);
  assert.equal([...body.matchAll(/\bupdate_base64\b/g)].length, 2);
  assert.doesNotMatch(body, /\b(?:author|created_at|total_bytes|last_seq)\b/i);
});

test('cursor and continuation use the same metadata snapshot and empty results preserve the input', () => {
  assert.match(normalized, /page_cursor as \( select coalesce\(max\(c\.seq\), p_after\) as cursor from chosen as c \)/i);
  assert.match(normalized, /'updates', coalesce\([\s\S]*?'\[\]'::jsonb\), 'cursor', pc\.cursor, 'has_more', exists \( select 1 from metadata as m where m\.seq > pc\.cursor \) \) from page_cursor as pc/i);
  assert.equal([...body.matchAll(/\breturn\b/gi)].length, 1);
  assert.equal([...body.matchAll(/\bwith\s+metadata\b/gi)].length, 1);
  assert.doesNotMatch(body, /\b(?:perform|execute|into|for\s+update|pg_advisory\w*)\b/i);
  assert.equal(body.slice(body.indexOf('return (')).split(';').filter(part => part.trim()).length, 2);
});

test('the existing maximum update fits a page and metadata cost bounds serialized rows', () => {
  const original = fs.readFileSync(path.join(migrationRoot,
    '20260916090000_internal_share.sql'), 'utf8');
  const maxUpdate = Number(original.match(/update_bytes between 1 and (\d+)/)?.[1]);
  assert.equal(maxUpdate, 512 * 1024);
  const estimate = bytes => 4 * Math.ceil(bytes / 3) + 256;
  const budget = 3 * 1024 * 1024;
  assert.ok(estimate(maxUpdate) < budget, 'a nonempty page always advances');
  assert.ok(estimate(maxUpdate) * 4 < budget);
  assert.ok(estimate(maxUpdate) * 5 > budget);
  assert.ok(estimate(1) * 256 < budget, 'the row cap bounds small updates');
  for (const bytes of [1, 2, 3, 4, maxUpdate - 2, maxUpdate - 1, maxUpdate]) {
    const row = { seq: Number.MAX_SAFE_INTEGER, op_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      update_base64: Buffer.alloc(bytes, 255).toString('base64') };
    const wireBytes = Buffer.byteLength(JSON.stringify(row));
    assert.ok(wireBytes + 1 < estimate(bytes), `row JSON and separator fit for ${bytes} bytes`);
  }
  assert.match(original, /grant select on table public\.internal_share_updates to service_role;/i);
  assert.match(original, /before update or delete on public\.internal_share_updates/i);
});

test('migration adds only the page RPC and preserves existing storage and authentication behavior', () => {
  assert.equal([...statements.matchAll(/\bcreate\s+function\b/gi)].length, 1);
  assert.doesNotMatch(statements, /\b(?:create\s+or\s+replace|create\s+table|alter\s+table|insert\s+into|update\s+public\.|delete\s+from|truncate|drop)\b/i);
  assert.doesNotMatch(statements, /\binternal_share_(?:heads|credentials|append|keep_history|login_guard|login_complete|password_change|auth_state)\b/i);
  assert.doesNotMatch(statements, /\b(?:grant|revoke)\s+[^;]*\bon\s+table\b/i);
  assert.doesNotMatch(statements, /\b(?:checkpoint|snapshot|prune|compact)\s*\(/i);
});
