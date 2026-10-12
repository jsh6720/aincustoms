'use strict';
// Naver blog RSS -> "관세 주요 뉴스" (/news) page. Pure functions, no dependencies.
const { NEWS_PAGE_CSS, NEWS_PAGE_SCRIPT } = require('./naver-blog-news-template');

const BLOG_URL = 'https://blog.naver.com/aincustoms_';
const RSS_URL = 'https://rss.blog.naver.com/aincustoms_.xml';
const SITE_URL = 'https://www.aincustoms.com';
const PAGE_URL = SITE_URL + '/news';
const PUBLISHER = '아인합동관세사무소';
const PAGE_TITLE = '관세 주요 뉴스 | 아인합동관세사무소';
const PAGE_DESCRIPTION = "관세사가 판례·유권해석·제도 변경을 카드뉴스로 정리한 관세 주요 뉴스. 아인합동관세사무소 네이버 블로그 '아인관세 인사이트'의 최신 글.";

const CATEGORY_KEYS = {
  '관세 뉴스': 'news',
  '주요 판례': 'case',
  '품목분류': 'hs',
  'FTA·원산지': 'fta',
  '수입요건': 'req',
  '통관 가이드': 'guide',
  '유권해석·질의회신': 'interp',
  '사무소 소식': 'office',
};

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };

function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Text content of an XML element: CDATA sections are taken verbatim, everything else is entity-decoded.
function readTag(block, name) {
  const match = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  if (!match) return '';
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let m;
  while ((m = re.exec(match[1]))) {
    out += decodeEntities(match[1].slice(last, m.index)) + m[1];
    last = re.lastIndex;
  }
  return (out + decodeEntities(match[1].slice(last))).trim();
}

// Title/category/tag text is kept literally (a "<" in a title is text); it is escaped at render time.
function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function plainText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cleanPostUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (!/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) return '';
    url.protocol = 'https:';
    for (const key of [...url.searchParams.keys()]) {
      if (key === 'fromRss' || key === 'trackingCode' || /^utm_/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function coverImage(descriptionHtml) {
  const match = String(descriptionHtml).match(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!match) return '';
  try {
    const url = new URL(decodeEntities(match[1] != null ? match[1] : match[2]).trim());
    if (url.protocol !== 'https:' || !/(^|\.)pstatic\.net$/i.test(url.hostname) || url.username || url.password || url.port) return '';
    url.searchParams.set('type', 'w2');
    return url.toString();
  } catch {
    return '';
  }
}

function summaryOf(descriptionHtml) {
  const text = plainText(descriptionHtml);
  const marker = text.match(/3줄\s*요약\s*·\s*/);
  if (marker) {
    // Bullets are separated by " · " (spaced); unspaced "·" (e.g. "FTA·원산지") belongs to the text.
    return text.slice(marker.index + marker[0].length).split(/\s·\s/)[0].trim();
  }
  const short = text.replace(/\.{3,}\s*$/, '');
  return short.length > 140 ? short.slice(0, 139).trimEnd() + '…' : short;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function dateFields(pubDate) {
  const ms = Date.parse(pubDate);
  if (!Number.isFinite(ms)) return { date: '', dateDay: '', dateLabel: '' };
  const kst = new Date(ms + KST_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  const y = kst.getUTCFullYear();
  const mo = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const dateDay = `${y}-${pad(mo)}-${pad(d)}`;
  return {
    date: `${dateDay}T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`,
    dateDay,
    dateLabel: `${y}. ${mo}. ${d}.`,
  };
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const block = m[1];
    const category = oneLine(readTag(block, 'category'));
    let title = oneLine(readTag(block, 'title'));
    const prefix = title.match(/^\[([^\]]{1,30})\]\s*/);
    if (prefix) title = title.slice(prefix[0].length);
    const url = cleanPostUrl(readTag(block, 'guid')) || cleanPostUrl(readTag(block, 'link'));
    if (!title || !url) continue;
    const description = readTag(block, 'description');
    items.push({
      title,
      category,
      categoryKey: CATEGORY_KEYS[category] || 'etc',
      url,
      summary: summaryOf(description),
      image: coverImage(description),
      ...dateFields(readTag(block, 'pubDate')),
      tags: readTag(block, 'tag').split(',').map(oneLine).filter(Boolean),
    });
  }
  return items;
}

// JSON inside <script>: escape characters that could close the element or confuse the HTML parser.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildJsonLd(items) {
  const publisher = { '@type': 'Organization', name: PUBLISHER, url: SITE_URL, logo: { '@type': 'ImageObject', url: SITE_URL + '/images/logo.png' } };
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: '관세 주요 뉴스',
    url: PAGE_URL,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => {
      const post = { '@type': 'BlogPosting', headline: item.title, url: item.url };
      if (item.date) post.datePublished = item.date;
      if (item.image) post.image = item.image;
      if (item.summary) post.description = item.summary;
      if (item.category) post.articleSection = item.category;
      if (item.tags && item.tags.length) post.keywords = item.tags.join(', ');
      post.publisher = publisher;
      post.author = publisher;
      return { '@type': 'ListItem', position: index + 1, url: item.url, item: post };
    }),
  };
}

const ARROW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const EXTERNAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.2 6.2l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';

function renderFilters(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.categoryKey;
    const group = groups.get(key) || { label: key === 'etc' ? '기타' : item.category, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const chips = [`<button type="button" class="chip" data-category="all" aria-pressed="true">전체 <span class="count">${items.length}</span></button>`];
  for (const [key, group] of groups) {
    chips.push(`<button type="button" class="chip" data-category="${escapeHtml(key)}" aria-pressed="false">${escapeHtml(group.label)} <span class="count">${group.count}</span></button>`);
  }
  return `
        <div class="filters-wrap">
            <div class="container">
                <div class="filters" role="group" aria-label="카테고리 필터">
                    ${chips.join('\n                    ')}
                </div>
            </div>
        </div>`;
}

function renderItem(item) {
  const cover = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title + ' 카드뉴스 표지')}" width="743" height="929" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  const date = item.dateDay ? `<time class="card-date" datetime="${escapeHtml(item.dateDay)}">${escapeHtml(item.dateLabel)}</time>` : '';
  const summary = item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : '';
  return `
                    <a class="card" data-category="${escapeHtml(item.categoryKey)}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                        <div class="card-cover">${cover}</div>
                        <div class="card-body">
                            <div class="card-meta">
                                <span class="card-cat">${escapeHtml(item.category || '기타')}</span>
                                ${date}
                            </div>
                            <h2 class="card-title">${escapeHtml(item.title)}</h2>
                            ${summary}
                            <span class="card-more">카드뉴스 보기 ${ARROW_ICON}</span>
                        </div>
                    </a>`;
}

function renderNewsPage(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const empty = list.length === 0;
  const fetchedAt = options.fetchedAt ? new Date(options.fetchedAt) : null;
  const fetchedIso = fetchedAt && Number.isFinite(fetchedAt.getTime()) ? fetchedAt.toISOString() : '';
  const ogImage = (list.find(item => item.image) || {}).image || SITE_URL + '/images/logo.png';
  const emptyBlock = empty
    ? `<div class="empty">최신 글을 불러오지 못했습니다. <a href="${BLOG_URL}" target="_blank" rel="noopener noreferrer" style="color:var(--blue);font-weight:700;text-decoration:underline">네이버 블로그 &lsquo;아인관세 인사이트&rsquo;</a>에서 전체 글을 확인하세요.</div>`
    : '<div class="empty">해당 카테고리의 글이 아직 없습니다.</div>';

  return `<!DOCTYPE html>
<html lang="ko">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}">
    <link rel="canonical" href="${PAGE_URL}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="${escapeHtml(PUBLISHER)}">
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}">
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}">
    <meta property="og:url" content="${PAGE_URL}">
    <meta property="og:image" content="${escapeHtml(ogImage)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
    <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
    <script type="application/ld+json">${safeJson(buildJsonLd(list))}</script>
    <style>${NEWS_PAGE_CSS}</style>
</head>

<body>
    <nav class="navbar">
        <div class="container">
            <a class="logo" href="/" aria-label="아인합동관세사무소 홈">
                <img src="/images/logo.png" alt="아인합동관세사무소 로고">
            </a>
            <div class="nav-menu">
                <a href="/#home">홈</a>
                <a href="/#about">회사소개</a>
                <a href="/#services">전문서비스</a>
                <a href="/#team">구성원소개</a>
                <a href="/#specialty">AI 통관</a>
                <a href="/news" aria-current="page">관세 주요 뉴스</a>
                <a href="/#contact">연락처</a>
                <a href="/#" class="is-red">과세가격 일괄제출 관리</a>
                <a href="/requirements/" target="_blank" rel="noopener noreferrer" class="is-blue">AIN 요건관리</a>
                <a href="/cargo-dashboard.html" class="is-green">축산물 통관조회</a>
            </div>
            <a class="nav-mobile" href="/">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
                홈
            </a>
        </div>
    </nav>

    <header class="page-header">
        <div class="container">
            <span class="kicker">아인관세 인사이트</span>
            <h1>관세 주요 뉴스</h1>
            <p>관세사가 판례·유권해석·제도 변경을 카드뉴스로 정리합니다.</p>
            <div class="header-actions">
                <a class="btn btn-primary" href="${BLOG_URL}" target="_blank" rel="noopener noreferrer">
                    네이버 블로그에서 전체 보기
                    ${EXTERNAL_ICON}
                </a>
            </div>
        </div>
    </header>

    <main>${empty ? '' : renderFilters(list)}

        <section class="news-section" aria-labelledby="list-title"${fetchedIso ? ` data-fetched-at="${fetchedIso}"` : ''}>
            <div class="container">
                <div class="list-meta">
                    <span id="list-title">최신 글 <strong data-count>${list.length}</strong>건</span>
                    <span>카드를 누르면 네이버 블로그 원문으로 이동합니다</span>
                </div>

                <div class="grid${empty ? ' is-empty' : ''}" id="news-grid">${list.map(renderItem).join('\n')}
                </div>

                ${emptyBlock}
            </div>
        </section>
    </main>

    <section class="cta" aria-label="상담 문의">
        <div class="container">
            <div>
                <h2>상담 문의</h2>
                <p>통관·품목분류·FTA·수입요건, 아인합동관세사무소에 문의하세요.</p>
            </div>
            <div class="cta-contact">
                <a class="tel" href="tel:02-518-5435">
                    ${PHONE_ICON}
                    02-518-5435
                </a>
                <a class="site" href="/">aincustoms.com</a>
            </div>
        </div>
    </section>

    <footer class="site-footer">
        <div class="container">
            <span>© 아인합동관세사무소</span>
            <a href="${BLOG_URL}" target="_blank" rel="noopener noreferrer">아인관세 인사이트 (네이버 블로그) ↗</a>
        </div>
    </footer>

    <script>${NEWS_PAGE_SCRIPT}</script>
</body>

</html>
`;
}

module.exports = { parseRss, renderNewsPage, buildJsonLd, escapeHtml, BLOG_URL, RSS_URL, PAGE_URL, CATEGORY_KEYS };
