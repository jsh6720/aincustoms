import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeImageUrl, createNoteImageElement } from './images.mjs';

const rendered = new WeakMap();
export function clearPreview(host) {
  rendered.delete(host);
  host.replaceChildren();
}

export function renderPreview(host, source) {
  const previous = rendered.get(host);
  if (previous?.source === source && previous.nodes.length === host.childNodes.length
      && previous.nodes.every((node, index) => host.childNodes[index] === node)) return;
  const reusable = new Map();
  for (const wrapper of host.querySelectorAll('.note-image')) {
    const url = normalizeImageUrl(wrapper.querySelector('img')?.getAttribute('src'));
    if (!url) continue;
    if (!reusable.has(url)) reusable.set(url, []);
    reusable.get(url).push(wrapper);
  }
  const document = host.ownerDocument;
  // Template contents are inert: a pasted external <img> cannot make a request
  // while we decide whether it is allowed. Never put untrusted HTML in host.
  const template = document.createElement('template');
  template.innerHTML = marked.parse(source, { gfm: true, breaks: true, async: false });
  for (const image of template.content.querySelectorAll('img')) {
    const url = normalizeImageUrl(image.getAttribute('src'));
    if (!url) { image.replaceWith(document.createTextNode(image.getAttribute('alt') || '[외부 이미지 표시 안 함]')); continue; }
    image.setAttribute('data-note-image', url);
  }
  // Remove all fetching/event/style attributes before sanitizer cloning. The
  // trusted URL stays a non-fetching marker until the sanitized tree is checked.
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'title' || (element.tagName === 'A' && attribute.name === 'href')
          || (element.tagName === 'IMG' && ['alt', 'data-note-image'].includes(attribute.name))) continue;
      element.removeAttribute(attribute.name);
    }
  }
  const fragment = DOMPurify.sanitize(template.content, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'data-note-image'], ALLOW_DATA_ATTR: false,
  });
  for (const image of fragment.querySelectorAll('img')) {
    const url = normalizeImageUrl(image.getAttribute('data-note-image'));
    if (!url) { image.replaceWith(document.createTextNode('[이미지 표시 안 함]')); continue; }
    const existing = reusable.get(url)?.shift();
    if (existing) existing.querySelector('img').alt = image.getAttribute('alt') || '노트 이미지';
    image.replaceWith(existing || createNoteImageElement(document, url, image.getAttribute('alt')));
  }
  for (const link of fragment.querySelectorAll('a')) {
    try {
      const url = new URL(link.getAttribute('href'));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    } catch { link.replaceWith(document.createTextNode(link.textContent)); }
  }
  host.replaceChildren(fragment);
  rendered.set(host, { source, nodes: [...host.childNodes] });
}
