import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

const IMAGE_ID = /^[a-f0-9]{64}$/;
const IMAGE_URL = /^\/api\/internal-share\?action=image&id=([a-f0-9]{64})$/;
export const IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const IMAGE_PIXELS = 32 * 1024 * 1024;

/** Only the authenticated, same-origin image proxy may render note images. */
export function normalizeImageUrl(value) {
  if (typeof value !== 'string') return null;
  const decoded = value.replace(/&amp;/g, '&');
  const match = IMAGE_URL.exec(decoded);
  return match && match[0] === decoded ? `/api/internal-share?action=image&id=${match[1]}` : null;
}

export function imageMarkdown(id) {
  if (typeof id !== 'string' || id.length !== 64 || !IMAGE_ID.test(id)) throw new Error('이미지 식별자가 올바르지 않습니다.');
  return `![캡처 이미지](/api/internal-share?action=image&id=${id})`;
}

export function parseImageLine(line) {
  if (typeof line !== 'string' || /[\r\n]/.test(line)) return null;
  const match = /^ {0,3}!\[([^\]\r\n]*)\]\(([^\s()]+)\)[ \t]*$/.exec(line);
  const url = match && normalizeImageUrl(match[2]);
  return url ? { url, alt: match[1] || '노트 이미지' } : null;
}

/** Read dimensions before decoding, rejecting compressed oversized images. */
export function imageDimensions(bytes, type) {
  const u16 = at => bytes[at] * 256 + bytes[at + 1];
  const u24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  const u32 = at => bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
  const ascii = (at, value) => [...value].every((letter, i) => bytes[at + i] === letter.charCodeAt(0));
  if (type === 'image/png' && bytes.length >= 33
      && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
      && u32(8) === 13 && ascii(12, 'IHDR')) return { width: u32(16), height: u32(20) };
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = u16(at);
      if (length < 2 || at + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        return { width: u16(at + 5), height: u16(at + 3) };
      }
      at += length;
    }
  }
  if (type === 'image/webp' && bytes.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return { width: u24(24) + 1, height: u24(27) + 1 };
    if (ascii(12, 'VP8 ') && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { width: (bytes[26] + bytes[27] * 256) & 16383, height: (bytes[28] + bytes[29] * 256) & 16383 };
    }
    if (ascii(12, 'VP8L') && bytes[20] === 47) {
      return { width: 1 + (bytes[21] | ((bytes[22] & 63) << 8)),
        height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)) };
    }
  }
  throw new Error('올바른 PNG, JPG 또는 WebP 이미지를 선택해 주세요.');
}

function checkDimensions({ width, height }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > IMAGE_PIXELS) {
    throw new Error('이미지가 너무 큽니다. 3,200만 화소 이하로 줄여 다시 붙여넣어 주세요.');
  }
}

/** Convert locally to static PNG. No source image or URL is sent elsewhere. */
export async function preparePastedImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('PNG, JPG 또는 WebP 이미지만 붙여넣을 수 있습니다.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > IMAGE_INPUT_BYTES) {
    throw new Error('10MB 이하의 이미지를 붙여넣어 주세요.');
  }
  checkDimensions(imageDimensions(new Uint8Array(await file.arrayBuffer()), file.type));
  let bitmap, canvas;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    checkDimensions(bitmap);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서는 이미지 변환을 할 수 없습니다.');
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = width; canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('이미지를 변환하지 못했습니다. 다시 캡처해 주세요.');
      if (blob.size > 0 && blob.size <= IMAGE_UPLOAD_BYTES) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
        return { data: btoa(binary) };
      }
      const ratio = Math.min(0.8, Math.sqrt(IMAGE_UPLOAD_BYTES / blob.size) * 0.95);
      if (Math.max(width * ratio, height * ratio) < 320) break;
      width = Math.max(1, Math.floor(width * ratio)); height = Math.max(1, Math.floor(height * ratio));
    }
    throw new Error('이미지 용량을 줄이지 못했습니다. 필요한 영역만 나누어 캡처해 주세요.');
  } catch (error) {
    if (error instanceof Error && /이미지|브라우저/.test(error.message)) throw error;
    throw new Error('이미지를 읽지 못했습니다. PNG 또는 JPG로 다시 붙여넣어 주세요.');
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

export function createNoteImageElement(document, url, alt = '', onMeasure = () => {}) {
  const safe = normalizeImageUrl(url);
  if (!safe) throw new Error('허용되지 않은 이미지 주소입니다.');
  const wrapper = document.createElement('span');
  wrapper.className = 'note-image'; wrapper.contentEditable = 'false';
  const image = document.createElement('img');
  image.className = 'note-image-content'; image.alt = alt || '노트 이미지';
  image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
  image.onload = () => onMeasure();
  image.onerror = () => {
    image.hidden = true;
    if (!wrapper.querySelector('.note-image-error')) {
      const message = document.createElement('span'); message.className = 'note-image-error';
      message.textContent = '이미지를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.';
      wrapper.append(message);
    }
    onMeasure();
  };
  image.src = safe; wrapper.append(image);
  return wrapper;
}

class NoteImageWidget extends WidgetType {
  constructor(url, alt) { super(); this.url = url; this.alt = alt; }
  eq(other) { return this.url === other.url && this.alt === other.alt; }
  get estimatedHeight() { return 260; }
  toDOM(view) { return createNoteImageElement(view.dom.ownerDocument, this.url, this.alt, () => view.requestMeasure()); }
  destroy(dom) {
    const image = dom.querySelector('img');
    if (image) { image.onload = null; image.onerror = null; }
  }
}

function imageDecorations(state) {
  const ranges = [];
  let fence = null;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i), delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const image = parseImageLine(line.text);
    if (image) ranges.push(Decoration.widget({ widget: new NoteImageWidget(image.url, image.alt), block: true, side: 1 }).range(line.to));
  }
  return Decoration.set(ranges);
}

const noteImages = StateField.define({
  create: imageDecorations,
  update: (value, transaction) => transaction.docChanged ? imageDecorations(transaction.state) : value,
  provide: field => EditorView.decorations.from(field),
});

/** Images are decorations only; Yjs text, undo, search and read-only stay intact. */
export const noteImageExtension = [noteImages];
