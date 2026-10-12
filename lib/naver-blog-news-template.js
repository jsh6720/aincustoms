'use strict';
// Static CSS/JS for the /news page, ported from the approved mock content/news-design/news.html
// (content/ is not deployed, so the template lives here as module strings).

const NEWS_PAGE_CSS = `
:root {
    --navy: #0f172a;
    --blue: #2563eb;
    --blue-deep: #1d4ed8;
    --light: #eff6ff;
    --ink-2: #334155;
    --ink-3: #64748b;
    --slate-400: #94a3b8;
    --slate-300: #cbd5e1;
    --slate-200: #e2e8f0;
    --slate-100: #f1f5f9;
    --bg: #f8fafc;
    --accent: var(--navy);
    --radius: 16px;
    --nav-h: 80px;
}

/* 카테고리 강조색: 카드와 칩 모두 data-category 로 받는다 */
[data-category="case"] { --accent: #2563eb; }
[data-category="hs"] { --accent: #0f766e; }
[data-category="fta"] { --accent: #6d28d9; }
[data-category="news"] { --accent: #b45309; }
[data-category="req"] { --accent: #be123c; }
[data-category="guide"] { --accent: #4d7c0f; }
[data-category="etc"] { --accent: #0f172a; }

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
    margin: 0;
    font-family: 'Pretendard Variable', Pretendard, 'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    color: var(--navy);
    background: var(--bg);
    line-height: 1.5;
    word-break: keep-all;
    overflow-x: hidden;
}

a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; }

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding-left: 24px;
    padding-right: 24px;
}

/* ---------- 네비게이션 (index.html 과 동일한 외형) ---------- */
.navbar {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    position: fixed;
    top: 0;
    width: 100%;
    z-index: 1000;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.navbar .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 32px;
    padding-top: 20px;
    padding-bottom: 20px;
}

.logo { flex: none; }
.logo img { height: 40px; width: auto; object-fit: contain; }

.nav-menu {
    display: none;
    align-items: center;
    gap: 20px;
    white-space: nowrap;
}

.nav-menu a {
    color: #374151;
    font-weight: 500;
    font-size: 16px;
    transition: color .2s;
    position: relative;
}

.nav-menu a:hover { color: var(--blue); }
.nav-menu a.is-red { color: #dc2626; font-weight: 700; }
.nav-menu a.is-red:hover { color: #991b1b; }
.nav-menu a.is-blue { color: var(--blue); font-weight: 700; }
.nav-menu a.is-blue:hover { color: var(--blue-deep); }
.nav-menu a.is-green { color: #16a34a; font-weight: 700; }
.nav-menu a.is-green:hover { color: #166534; }

/* 현재 페이지 표시 */
.nav-menu a[aria-current="page"] {
    color: var(--navy);
    font-weight: 700;
}

.nav-menu a[aria-current="page"]::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -8px;
    height: 2px;
    background: var(--blue);
    border-radius: 2px;
}

/* 모바일: 홈으로 가는 링크만 */
.nav-mobile {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    padding: 8px 12px;
    border: 1px solid var(--slate-200);
    border-radius: 999px;
    background: #fff;
}

/* 메뉴 10개가 로고와 겹치지 않는 너비부터 데스크톱 메뉴 */
@media (min-width: 1280px) {
    .nav-menu { display: flex; }
    .nav-mobile { display: none; }
}

/* ---------- 페이지 헤더 ---------- */
.page-header {
    margin-top: var(--nav-h);
    background: var(--navy);
    color: #fff;
    position: relative;
    overflow: hidden;
}

/* 카드뉴스 표지의 워터마크 모티프 (외곽선 글자, 우측으로 흘러나감) */
.page-header::before {
    content: "INSIGHT";
    position: absolute;
    right: -0.08em;
    top: 50%;
    transform: translateY(-50%);
    font-size: clamp(120px, 18vw, 240px);
    font-weight: 900;
    letter-spacing: -0.04em;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 2px rgba(255, 255, 255, 0.14);
    pointer-events: none;
    user-select: none;
}

.page-header .container {
    position: relative;
    padding-top: 72px;
    padding-bottom: 64px;
    display: grid;
    gap: 20px;
}

.kicker {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--slate-300);
}

.kicker::before {
    content: "";
    width: 28px; height: 2px;
    background: var(--blue);
}

.page-header h1 {
    margin: 0;
    font-size: clamp(34px, 4.4vw, 52px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
}

.page-header p {
    margin: 0;
    max-width: 640px;
    font-size: 18px;
    line-height: 1.6;
    color: var(--slate-300);
    font-weight: 500;
}

.header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
}

.btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 12px;
    font-weight: 700;
    font-size: 15px;
    transition: all .3s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: #fff;
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
}

.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(59, 130, 246, 0.4); }

.btn-ghost {
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.28);
}

.btn-ghost:hover { background: rgba(255, 255, 255, 0.08); }

.btn svg { width: 18px; height: 18px; flex: none; }

/* ---------- 필터 ---------- */
.filters-wrap {
    position: sticky;
    top: var(--nav-h);
    z-index: 20;
    background: rgba(248, 250, 252, 0.92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--slate-200);
}

.filters {
    display: flex;
    gap: 8px;
    padding: 14px 0;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}

.filters::-webkit-scrollbar { display: none; }

.chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid var(--slate-200);
    background: #fff;
    color: var(--ink-2);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all .2s;
}

.chip::before {
    content: "";
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
}

.chip[data-category="all"]::before { display: none; }

.chip .count {
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-3);
    background: var(--slate-100);
    padding: 2px 7px;
    border-radius: 999px;
    line-height: 1.2;
}

.chip:hover { border-color: var(--slate-300); color: var(--navy); }

.chip[aria-pressed="true"] {
    background: var(--navy);
    border-color: var(--navy);
    color: #fff;
}

.chip[aria-pressed="true"]::before { background: #fff; }
.chip[aria-pressed="true"] .count { background: rgba(255, 255, 255, 0.16); color: #fff; }

/* ---------- 글 목록 ---------- */
.news-section { padding: 40px 0 72px; }

.list-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 20px;
    font-size: 14px;
    color: var(--ink-3);
}

.list-meta strong { color: var(--navy); font-weight: 700; }

.grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px;
}

.card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: var(--radius);
    border: 1px solid rgba(15, 23, 42, 0.06);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
    overflow: hidden;
    transition: transform .4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow .4s cubic-bezier(0.4, 0, 0.2, 1);
    min-width: 0;
}

.card:hover { transform: translateY(-6px); box-shadow: 0 20px 48px rgba(0, 0, 0, 0.12); }
.card:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.card[hidden] { display: none; }

.card-cover {
    position: relative;
    aspect-ratio: 4 / 5;
    background: var(--navy);
    overflow: hidden;
}

.card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.card-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 22px 22px;
    flex: 1;
}

.card-cat {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: 0.01em;
}

.card-cat::before {
    content: "";
    width: 8px; height: 8px;
    border-radius: 2px;
    background: var(--accent);
}

.card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.card-date {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.card-title {
    margin: 0;
    font-size: 19px;
    font-weight: 800;
    line-height: 1.35;
    letter-spacing: -0.02em;
    color: var(--navy);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card:hover .card-title { color: var(--blue-deep); }

.card-summary {
    margin: 0;
    font-size: 14.5px;
    line-height: 1.6;
    color: var(--ink-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-more {
    margin-top: auto;
    padding-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-3);
}

.card-more svg { width: 14px; height: 14px; }
.card:hover .card-more { color: var(--blue); }

/* 빈 상태 */
.empty {
    display: none;
    padding: 56px 24px;
    text-align: center;
    color: var(--ink-3);
    border: 1px dashed var(--slate-300);
    border-radius: var(--radius);
    background: #fff;
}

.grid.is-empty + .empty { display: block; }

/* ---------- 푸터 CTA ---------- */
.cta {
    background: var(--navy);
    color: #fff;
}

.cta .container {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    padding-top: 56px;
    padding-bottom: 56px;
}

.cta h2 {
    margin: 0 0 8px;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
}

.cta p { margin: 0; color: var(--slate-300); font-size: 16px; }

.cta-contact {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

.cta-contact a {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 14px 22px;
    border-radius: 12px;
    font-weight: 800;
    font-size: 18px;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
}

.cta-contact .tel { background: #fff; color: var(--navy); }
.cta-contact .tel:hover { background: var(--light); }
.cta-contact .site { border: 1px solid rgba(255, 255, 255, 0.28); color: #fff; }
.cta-contact .site:hover { background: rgba(255, 255, 255, 0.08); }
.cta-contact svg { width: 20px; height: 20px; }

.site-footer {
    background: #0b1120;
    color: var(--slate-400);
    font-size: 13px;
}

.site-footer .container {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 24px;
    padding-top: 20px;
    padding-bottom: 20px;
}

.site-footer a:hover { color: #fff; }

/* ---------- 반응형 ---------- */
@media (max-width: 1024px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
}

@media (max-width: 768px) {
    :root { --nav-h: 72px; }
    .container { padding-left: 16px; padding-right: 16px; }
    .navbar .container { padding-top: 16px; padding-bottom: 16px; }
    .page-header .container { padding-top: 44px; padding-bottom: 48px; gap: 14px; }
    .page-header p { font-size: 16px; }
    .page-header::before { font-size: 96px; -webkit-text-stroke-width: 1.5px; opacity: .7; top: auto; bottom: -0.18em; transform: none; }
    .filters { padding: 12px 0; margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
    .news-section { padding: 24px 0 48px; }
    .grid { gap: 16px 12px; }
    .card { border-radius: 12px; }
    .card-body { padding: 14px 14px 16px; gap: 8px; }
    .card-meta { flex-direction: column; align-items: flex-start; gap: 4px; }
    .card-cat { font-size: 12px; white-space: nowrap; }
    .card-date { font-size: 12px; }
    .card-title { font-size: 15.5px; }
    .card-summary { font-size: 13px; line-height: 1.55; }
    .card-more { display: none; }
    .cta .container { padding-top: 40px; padding-bottom: 40px; }
    .cta h2 { font-size: 22px; }
    .cta-contact { width: 100%; }
    .cta-contact a { flex: 1 1 auto; justify-content: center; font-size: 16px; }
}

@media (max-width: 359px) {
    .grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
    .card, .btn { transition: none; }
    .card:hover { transform: none; }
}
`;

const NEWS_PAGE_SCRIPT = `
// 카테고리 필터: JS 없이도 전체 목록은 그대로 보이고, JS 가 있으면 칩으로 걸러낸다.
(function () {
    var chips = document.querySelectorAll('.chip');
    var cards = document.querySelectorAll('#news-grid .card');
    var grid = document.getElementById('news-grid');
    var countEl = document.querySelector('[data-count]');
    chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            var key = chip.getAttribute('data-category');
            var shown = 0;
            chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
            cards.forEach(function (card) {
                var on = key === 'all' || card.getAttribute('data-category') === key;
                card.hidden = !on;
                if (on) shown++;
            });
            grid.classList.toggle('is-empty', shown === 0);
            if (countEl) countEl.textContent = shown;
        });
    });
})();
`;

module.exports = { NEWS_PAGE_CSS, NEWS_PAGE_SCRIPT };
