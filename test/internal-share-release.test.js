const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyNoteRelease } = require('../scripts/verify-note-release.cjs');
const root = path.resolve(__dirname, '..');
test('release gate verifies workspace assets and is wired into Vercel build', () => {
  assert.equal(verifyNoteRelease(root).files, 9);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'))).buildCommand, 'node scripts/verify-note-release.cjs');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'))).outputDirectory, '.');
});
test('release gate rejects omitted page and API routes before deployment', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ain-release-gate-'));
  try {
    fs.writeFileSync(path.join(temp, 'vercel.json'), JSON.stringify({ rewrites: [] }));
    assert.throws(() => verifyNoteRelease(temp), /Missing \/note route/);
    fs.writeFileSync(path.join(temp, 'vercel.json'), JSON.stringify({ rewrites: [{ source: '/note', destination: '/internal/index.html' }] }));
    assert.throws(() => verifyNoteRelease(temp), /Missing private API route/);
  } finally {
    fs.rmSync(path.join(temp, 'vercel.json')); fs.rmdirSync(temp);
  }
});
