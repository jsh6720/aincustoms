// Build-time read-only gate: a homepage release must retain the private workspace.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function verifyNoteRelease(root = path.resolve(__dirname, '..')) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites?.some(r => r.source === '/note' && r.destination === '/internal/index.html'), 'Missing /note route');
  assert.ok(config.rewrites?.some(r => r.source === '/api/internal-share' && r.destination === '/api/cargo-admin?workspace=internal'), 'Missing private API route');
  const manifest = JSON.parse(read('dashboard-mirror-manifest.json'));
  const required = ['internal/index.html', 'internal/app.js', 'internal/style.css', 'internal/tasks.mjs', 'internal/tasks-ui.mjs', 'lib/internal-share-handler.js', 'lib/internal-share-server.js', 'lib/internal-share-images.js', 'api/cargo-admin.js'];
  for (const file of required) {
    const content = read(file).replace(/\r\n?/g, '\n');
    assert.ok(content.length, 'Empty release file: ' + file);
    const entry = manifest.files.find(entry => entry.source === file);
    assert.ok(entry, 'Missing manifest entry: ' + file);
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), entry.sha256, 'Release hash mismatch: ' + file);
  }
  assert.match(read('internal/index.html'), /\/internal\/app\.js/);
  assert.match(read('api/cargo-admin.js'), /require\(["']\.\.\/lib\/internal-share-handler["']\)/);
  return { files: required.length, noteRoute: true, privateApiRoute: true };
}
module.exports = { verifyNoteRelease };
if (require.main === module) {
  try { console.log('NOTE_RELEASE_OK ' + JSON.stringify(verifyNoteRelease())); }
  catch (error) { console.error('NOTE_RELEASE_BLOCKED: ' + error.message); process.exitCode = 1; }
}
