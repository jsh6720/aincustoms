// Builds the self-hosted article pages for the Naver blog posts so search and AI
// crawlers (blocked by blog.naver.com/robots.txt) can read and cite them.
//   node scripts/build-news-pages.cjs
// Inputs:  content/naver-blog/posts/{id}/body.md + posts/index.json, live Naver RSS
//          (only posts already published on Naver get a page).
// Outputs: news/{id}.html, lib/news-local-posts.json, sitemap.xml, feed.xml, llms.txt
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const { parseRss, escapeHtml, RSS_URL, BLOG_URL } = require('../lib/naver-blog-news');
const { NEWS_PAGE_CSS } = require('../lib/naver-blog-news-template');

const ROOT = path.resolve(__dirname, '..');
const POSTS = path.join(ROOT, 'content/naver-blog/posts');
const SITE = 'https://www.aincustoms.com';
const ORG = { '@type': 'LegalService', '@id': SITE + '/#organization', name: '아인합동관세사무소', url: SITE + '/' };
const AUTHOR = { '@type': 'Person', '@id': SITE + '/#jung-seokhyeon', name: '정석현', jobTitle: '대표관세사', worksFor: { '@id': ORG['@id'] } };

const norm = s => String(s).replace(/^\[[^\]]+\]\s*/, '').replace(/[\s'"‘’“”]/g, '');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function parseBody(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let tags = [];
  const kept = lines.filter((line, i) => {
    if (i === 0 && line.startsWith('# ')) return false;
    if (/^카테고리:/.test(line)) return false;
    if (/^\s*\[\[IMG [^\]]+\]\]\s*$/.test(line)) return false;
    if (/^#\S/.test(line) && /(\s#\S+)+\s*$/.test(line)) { tags = line.match(/#(\S+)/g).map(t => t.slice(1)); return false; }
    return true;
  });
  return { markdown: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tags };
}

// Bare URLs in 출처 lines often end with Korean text or " ," — let marked's autolinker handle them, then open externally.
function renderMarkdown(md) {
  return marked.parse(md, { gfm: true })
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
}

const ARTICLE_CSS = `
.article{max-width:760px;margin:var(--nav-h) auto 0;padding:40px 20px 64px;line-height:1.85;font-size:17px;color:#1f2937;word-break:keep-all;overflow-wrap:anywhere}
.article .crumbs{font-size:14px;color:#6b7280;margin-bottom:16px}.article .crumbs a{color:#2563eb}
.article h1{font-size:30px;line-height:1.4;margin:6px 0 14px;letter-spacing:-.02em}
.article .byline{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;color:#6b7280;padding-bottom:20px;border-bottom:1px solid #e5e7eb;margin-bottom:28px}
.article .cover{width:100%;max-width:420px;height:auto;border-radius:12px;display:block;margin:0 auto 28px;box-shadow:0 6px 24px rgba(15,23,42,.12)}
.article h2{font-size:22px;margin:40px 0 12px;padding-top:4px}
.article ul{padding-left:22px}.article li{margin:4px 0}
.article a{color:#2563eb;text-decoration:underline;text-underline-offset:3px}
.article blockquote{margin:16px 0;padding:10px 16px;border-left:4px solid #93c5fd;background:#f1f5ff}
.article table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;font-size:15px}.article th,.article td{border:1px solid #e5e7eb;padding:8px 10px}
.article .original{margin-top:36px;padding:16px 18px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;font-size:15px}
.article .tags{margin-top:20px;font-size:14px;color:#6b7280}
@media (max-width:640px){.article{padding:28px 16px 48px;font-size:16px}.article h1{font-size:24px}}`;

function renderPage(post) {
  const url = `${SITE}/news/${post.id}`;
  const title = `${post.title} | 아인합동관세사무소`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting', '@id': url + '#article', mainEntityOfPage: url, url,
        headline: post.title, description: post.summary, articleSection: post.category,
        datePublished: post.date, dateModified: post.date, inLanguage: 'ko-KR',
        author: AUTHOR, publisher: ORG, isBasedOn: post.naverUrl, sameAs: post.naverUrl,
        ...(post.image ? { image: post.image } : {}), ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
      },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '홈', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: '관세 주요 뉴스', item: SITE + '/news' },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ] },
    ],
  };
  const e = escapeHtml;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${e(title)}</title>
    <meta name="description" content="${e(clip(post.summary, 160))}">
    <link rel="canonical" href="${url}">
    <link rel="alternate" type="application/rss+xml" title="Ain 관세 인사이트" href="${SITE}/feed.xml">
    <meta property="og:type" content="article">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="아인합동관세사무소">
    <meta property="og:title" content="${e(post.title)}">
    <meta property="og:description" content="${e(clip(post.summary, 160))}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${e(post.image || SITE + '/images/logo.png')}">
    <meta property="article:published_time" content="${e(post.date)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
    <script type="application/ld+json">${safeJson(ld)}</script>
    <style>${NEWS_PAGE_CSS}${ARTICLE_CSS}</style>
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a class="logo" href="/" aria-label="아인합동관세사무소 홈"><img src="/images/logo.png" alt="아인합동관세사무소 로고"></a>
            <div class="nav-menu">
                <a href="/#home">홈</a>
                <a href="/#about">회사소개</a>
                <a href="/#services">전문서비스</a>
                <a href="/#team">구성원소개</a>
                <a href="/news">관세 주요 뉴스</a>
                <a href="/#contact">연락처</a>
            </div>
            <a class="nav-mobile" href="/news">관세 주요 뉴스</a>
        </div>
    </nav>
    <main>
        <article class="article">
            <div class="crumbs"><a href="/">홈</a> › <a href="/news">관세 주요 뉴스</a> › ${e(post.category)}</div>
            <h1>${e(post.title)}</h1>
            <div class="byline">
                <span>${e(post.category)}</span>
                <time datetime="${e(post.dateDay)}">${e(post.dateLabel)}</time>
                <span>작성: 정석현 대표관세사 (아인합동관세사무소)</span>
            </div>
            ${post.image ? `<img class="cover" src="${e(post.image)}" alt="${e(post.title + ' 카드뉴스 표지')}" width="743" height="929" referrerpolicy="no-referrer">` : ''}
            ${renderMarkdown(post.markdown)}
            <p class="original">카드뉴스 이미지 전체는 <a href="${e(post.naverUrl)}" target="_blank" rel="noopener noreferrer">네이버 블로그 원문</a>에서 볼 수 있습니다.</p>
            ${post.tags.length ? `<p class="tags">${post.tags.map(t => '#' + e(t)).join(' ')}</p>` : ''}
        </article>
    </main>
    <footer class="site-footer">
        <div class="container">
            <span>© 아인합동관세사무소 · <a href="tel:02-518-5435">02-518-5435</a></span>
            <a href="${BLOG_URL}" target="_blank" rel="noopener noreferrer">Ain 관세 인사이트 (네이버 블로그) ↗</a>
        </div>
    </footer>
</body>
</html>
`;
}

function sitemap(posts, today) {
  const urls = [
    { loc: SITE + '/', lastmod: today },
    { loc: SITE + '/news', lastmod: posts[0] ? posts[0].dateDay : today },
    ...posts.map(p => ({ loc: `${SITE}/news/${p.id}`, lastmod: p.dateDay })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
}

function feed(posts) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Ain 관세 인사이트 | 아인합동관세사무소</title>
  <link>${SITE}/news</link>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>관세사가 판례·유권해석·제도 변경을 정리한 관세 실무 글</description>
  <language>ko</language>
${posts.map(p => `  <item>
    <title>${xml(p.title)}</title>
    <link>${SITE}/news/${p.id}</link>
    <guid isPermaLink="true">${SITE}/news/${p.id}</guid>
    <pubDate>${new Date(p.date).toUTCString()}</pubDate>
    <category>${xml(p.category)}</category>
    <description>${xml(p.summary)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
}

function llms(posts) {
  return `# 아인합동관세사무소 (Ain Customs)

> 서울 강남구와 인천 부평구에 사무소를 둔 관세사 사무소입니다. 4대 회계법인·관세법인 출신 관세사가 수출입 통관, 관세심사·조사 대응, 품목분류·경정청구, FTA·원산지, 수입요건(세관장확인), AEO, 외국환거래 진단을 수행합니다.

- 웹사이트: ${SITE}/
- 대표전화: 02-518-5435 (인천지사 032-265-2750)
- 서울본사: 서울특별시 강남구 학동로 43길 38, 145호
- 인천지사: 인천시 부평구 부평대로 337, 325호
- 관세사: 조재호 대표관세사, 정석현 대표관세사, 박종욱 관세사

## 관세 인사이트 (관세사가 쓴 실무 글)

각 글은 관련 법령 조문을 법제처 현행 원문과 대조해 작성했으며, 출처와 작성 기준월을 본문에 표기합니다.

${posts.map(p => `- [${p.title}](${SITE}/news/${p.id}): ${p.summary}`).join('\n')}

## 기타

- [관세 주요 뉴스 목록](${SITE}/news)
- [RSS](${SITE}/feed.xml)
`;
}

async function main() {
  const response = await fetch(RSS_URL, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('RSS HTTP ' + response.status);
  const live = parseRss(await response.text());
  const index = JSON.parse(fs.readFileSync(path.join(POSTS, 'index.json'), 'utf8'));
  const posts = [];
  for (const entry of index) {
    const bodyFile = path.join(POSTS, entry.id, 'body.md');
    if (!fs.existsSync(bodyFile)) continue;
    const rss = live.find(item => norm(item.title) === norm(entry.title));
    if (!rss) continue; // not (yet) published on Naver
    const { markdown, tags } = parseBody(fs.readFileSync(bodyFile, 'utf8'));
    posts.push({
      id: entry.id, title: rss.title, category: rss.category || entry.category,
      summary: rss.summary || entry.summary, naverUrl: rss.url, image: rss.image,
      date: rss.date, dateDay: rss.dateDay, dateLabel: rss.dateLabel, markdown, tags: tags.length ? tags : rss.tags,
    });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  fs.mkdirSync(path.join(ROOT, 'news'), { recursive: true });
  for (const name of fs.readdirSync(path.join(ROOT, 'news'))) {
    if (/^\d+\.html$/.test(name)) fs.unlinkSync(path.join(ROOT, 'news', name));
  }
  for (const post of posts) fs.writeFileSync(path.join(ROOT, 'news', `${post.id}.html`), renderPage(post));
  const map = Object.fromEntries(posts.map(p => [p.naverUrl, `/news/${p.id}`]));
  fs.writeFileSync(path.join(ROOT, 'lib/news-local-posts.json'), JSON.stringify(map, null, 2) + '\n');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap(posts, today));
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), feed(posts));
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), llms(posts));
  const skipped = index.filter(e => !posts.some(p => p.id === e.id)).map(e => e.id);
  console.log(`built ${posts.length} pages: ${posts.map(p => p.id).join(' ')}; skipped (unpublished or no body): ${skipped.join(' ') || '-'}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseBody, renderPage };
