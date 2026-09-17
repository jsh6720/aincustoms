const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('internal security headers cover the canonical directory URL and its assets',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  for(const source of ['/note','/internal','/internal/:path*']){
    const rule=config.headers.find(item=>item.source===source);
    assert.ok(rule,source);
    const headers=Object.fromEntries(rule.headers.map(h=>[h.key.toLowerCase(),h.value]));
    assert.match(headers['x-robots-tag'],/noindex/);
    assert.match(headers['cache-control'],/no-store/);
    assert.match(headers['content-security-policy'],/frame-ancestors 'none'/);
    assert.equal(headers['referrer-policy'],'no-referrer');
  }
});

test('note is the new entry and legacy redirects do not capture static assets',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.ok(config.rewrites.some(rule=>rule.source==='/note'&&rule.destination==='/internal/index.html'));
  for(const source of ['/internal','/internal/','/note/']) {
    const rule=config.redirects.find(rule=>rule.source===source);
    assert.equal(rule?.destination,'/note');
    assert.equal(rule?.permanent,false);
  }
  assert.equal(config.redirects.some(rule=>rule.source.includes(':path')),false);
});
test('deployment excludes private local setup artifacts and keeps the existing API count',()=>{
  const ignores=fs.readFileSync(path.join(root,'.vercelignore'),'utf8').split(/\r?\n/);
  for(const value of ['.artifacts','.env','.env.*','supabase/.temp'])assert.ok(ignores.includes(value));
  assert.equal(fs.readdirSync(path.join(root,'api')).filter(name=>name.endsWith('.js')).length,12);
});
