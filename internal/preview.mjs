import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderPreview(host, source) {
  host.innerHTML = DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true, async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title'], ALLOW_DATA_ATTR: false,
  });
  for (const link of host.querySelectorAll('a')) {
    try {
      const url = new URL(link.getAttribute('href'));
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    } catch { link.replaceWith(document.createTextNode(link.textContent)); }
  }
}
