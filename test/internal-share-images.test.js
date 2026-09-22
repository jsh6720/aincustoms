const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../internal/images.mjs'), import('@codemirror/state'), import('@codemirror/view')]);
const id = '0123456789abcdef'.repeat(4);
const url = '/api/internal-share?action=image&id=' + id;

test('only canonical authenticated image URLs are accepted', async () => {
  const [{ normalizeImageUrl, imageMarkdown, parseImageLine }] = await modules;
  assert.equal(normalizeImageUrl(url), url);
  assert.equal(normalizeImageUrl(url.replace('&', '&amp;')), url);
  for (const invalid of [null, '', ' ' + url, url + ' ', url + '\n', url + '\r\n', url + '&x=1', url + '#x', url.replace('image&id', 'sync&id'),
    url.replace(id, id.toUpperCase()), url.replace(id, '../secret'), url.replace('&', '%26'),
    'https://aincustoms.com' + url, 'https://tracker.test/x.png', '//tracker.test/x.png', 'data:image/png;base64,abc', 'blob:https://aincustoms.com/x']) {
    assert.equal(normalizeImageUrl(invalid), null, String(invalid));
  }
  assert.equal(imageMarkdown(id), `![캡처 이미지](${url})`);
  assert.deepEqual(parseImageLine(imageMarkdown(id)), { url, alt: '캡처 이미지' });
  assert.equal(parseImageLine('before ' + imageMarkdown(id)), null);
  assert.equal(parseImageLine('    ' + imageMarkdown(id)), null, 'indented code is not an image');
  assert.equal(parseImageLine('![unsafe](https://tracker.test/x)'), null);
  assert.throws(() => imageMarkdown('abc'));
  assert.throws(() => imageMarkdown(id.toUpperCase()));
  assert.throws(() => imageMarkdown(id + '\n'));
  assert.equal(parseImageLine(imageMarkdown(id) + '\n'), null);
});

function pngHeader(width = 160, height = 90) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
test('dimension inspection rejects MIME spoofing before browser decode', async () => {
  const [{ imageDimensions }] = await modules;
  assert.deepEqual(imageDimensions(pngHeader(), 'image/png'), { width: 160, height: 90 });
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 8, 8, 0, 90, 0, 160, 0]);
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 160, height: 90 });
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12);
  webp[24] = 159; webp[27] = 89;
  assert.deepEqual(imageDimensions(webp, 'image/webp'), { width: 160, height: 90 });
  assert.throws(() => imageDimensions(pngHeader(), 'image/jpeg'));
  assert.throws(() => imageDimensions(Buffer.from('<svg><script>evil</script></svg>'), 'image/png'));
  assert.throws(() => imageDimensions(Buffer.from([255, 216, 255, 192, 255, 255]), 'image/jpeg'));
});

test('image decoration is read-only safe and does not modify text, selection or code blocks', async () => {
  const [{ noteImageExtension, imageMarkdown }, { EditorState }, { EditorView }] = await modules;
  const marker = imageMarkdown(id);
  const text = `한글 본문\n${marker}\n\`\`\`markdown\n${marker}\n\`\`\`\n    ${marker}\n뒷문장`;
  let state = EditorState.create({ doc: text, selection: { anchor: 2 }, extensions: [noteImageExtension, EditorState.readOnly.of(true)] });
  const entries = () => {
    const widgets = [];
    for (const decorations of state.facet(EditorView.decorations)) decorations.between(0, state.doc.length, (from, to, value) => widgets.push({ from, to, value }));
    return widgets;
  };
  assert.equal(entries().length, 1);
  assert.equal(entries()[0].from, state.doc.line(2).to);
  assert.equal(entries()[0].value.spec.block, true);
  assert.equal(state.doc.toString(), text);
  assert.equal(state.selection.main.anchor, 2);
  assert.equal(state.readOnly, true);
  state = state.update({ changes: { from: 0, to: 0, insert: marker + '\n' } }).state;
  assert.equal(entries().length, 2);
  state = state.update({ changes: { from: 0, to: marker.length + 1, insert: '' } }).state;
  assert.equal(entries().length, 1);
});

test('upload preparation validates type, bytes and compressed dimensions before decode', async () => {
  const [{ preparePastedImage, IMAGE_INPUT_BYTES }] = await modules;
  const file = { type: 'image/png', size: 33, arrayBuffer: async () => pngHeader(100000, 100000) };
  await assert.rejects(preparePastedImage({ ...file, type: 'image/svg+xml' }), /PNG/);
  await assert.rejects(preparePastedImage({ ...file, size: IMAGE_INPUT_BYTES + 1 }), /10MB/);
  await assert.rejects(preparePastedImage({ ...file, size: 0 }), /10MB/);
  await assert.rejects(preparePastedImage(file), /화소/);
});

test('PNG preparation scales locally, emits canonical base64 and closes its bitmap', async () => {
  const [{ preparePastedImage }] = await modules;
  const previous = { document: global.document, createImageBitmap: global.createImageBitmap };
  const draws = []; let closed = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args.slice(-2)) }),
    toBlob: callback => callback(new Blob([pngHeader()], { type: 'image/png' })) };
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return canvas; } };
  global.createImageBitmap = async (file, options) => {
    assert.deepEqual(options, { imageOrientation: 'from-image' });
    return { width: 5120, height: 2880, close: () => closed++ };
  };
  try {
    const result = await preparePastedImage(new Blob([pngHeader(5120, 2880)], { type: 'image/png' }));
    assert.deepEqual(result, { data: pngHeader().toString('base64') });
    assert.deepEqual(draws, [[2560, 1440]]);
    assert.equal(closed, 1); assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  } finally {
    if (previous.document === undefined) delete global.document; else global.document = previous.document;
    if (previous.createImageBitmap === undefined) delete global.createImageBitmap; else global.createImageBitmap = previous.createImageBitmap;
  }
});

test('failed image conversion is bounded and closes decoded resources', async () => {
  const [{ preparePastedImage }] = await modules;
  const previous = { document: global.document, createImageBitmap: global.createImageBitmap };
  let closed = 0, attempts = 0;
  global.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => { attempts++; callback({ size: 8 * 1024 * 1024 }); } }) };
  global.createImageBitmap = async () => ({ width: 2560, height: 1440, close: () => closed++ });
  try {
    await assert.rejects(preparePastedImage(new Blob([pngHeader(2560, 1440)], { type: 'image/png' })), /용량/);
    assert.ok(attempts <= 8); assert.equal(closed, 1);
  } finally {
    if (previous.document === undefined) delete global.document; else global.document = previous.document;
    if (previous.createImageBitmap === undefined) delete global.createImageBitmap; else global.createImageBitmap = previous.createImageBitmap;
  }
});
