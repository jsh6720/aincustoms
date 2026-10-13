const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseRss, renderNewsPage } = require("../lib/naver-blog-news");
const handler = require("../lib/news-page-handler");
const adminHandler = require("../api/cargo-admin");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "naver-blog-aincustoms.xml"), "utf8");

function rssWith(itemXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>${itemXml}</channel></rss>`;
}

function jsonLdOf(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "JSON-LD block present");
  return JSON.parse(match[1]);
}

test("parses the six fixture items with categories, stripped titles and clean URLs", () => {
  const items = parseRss(FIXTURE);
  assert.equal(items.length, 6);
  assert.deepEqual(items.map(i => i.categoryKey), ["guide", "news", "fta", "hs", "case", "case"]);
  assert.deepEqual(items.map(i => i.category), ["통관 가이드", "관세 뉴스", "FTA·원산지", "품목분류", "주요 판례", "주요 판례"]);
  assert.equal(items[0].title, "인천공항 핸드캐리 수입 어떻게?");
  assert.equal(items[1].title, "사전심사 후 수정신고하면 가산세는? (제42조의2)");
  for (const item of items) {
    assert.doesNotMatch(item.title, /^\[/);
    assert.match(item.url, /^https:\/\/blog\.naver\.com\/aincustoms_\/\d+$/);
  }
  assert.ok(items[0].tags.includes("핸드캐리"));
});

test("summary is the first bullet of 3줄 요약 without prefix or HTML", () => {
  const items = parseRss(FIXTURE);
  assert.equal(items[2].summary, "협정관세는 신청해야 적용됩니다. 수입신고 수리일부터 1년 안에 사후적용을 신청하지 않으면 5년 경정청구로도 소급 적용받을 수 없습니다.");
  // unspaced middle dot stays inside the bullet
  assert.equal(items[4].summary, "건당 한도 안에서 자가사용 면세로 신고했더라도, 구매 횟수·수량 등 실질이 판매용이면 면세가 배제됩니다.");
  for (const item of items) {
    assert.doesNotMatch(item.summary, /3줄 요약|<|>/);
  }
});

test("cover image switches to type=w2 and only allows https pstatic.net hosts", () => {
  const items = parseRss(FIXTURE);
  for (const item of items) {
    assert.match(item.image, /^https:\/\/blogthumb\.pstatic\.net\/.+\?type=w2$/);
  }
  const make = src => parseRss(rssWith(`<item><title>t</title><guid>https://blog.naver.com/aincustoms_/1</guid><description><![CDATA[x <img src="${src}" />]]></description></item>`))[0].image;
  assert.equal(make("https://evil.example.com/a.png?type=s3"), "");
  assert.equal(make("https://pstatic.net.evil.com/a.png"), "");
  assert.equal(make("http://blogthumb.pstatic.net/a.png?type=s3"), "");
  assert.equal(make("javascript:alert(1)"), "");
  assert.equal(make("https://postfiles.pstatic.net/a.png?type=s3"), "https://postfiles.pstatic.net/a.png?type=w2");
});

test("dates are formatted in Asia/Seoul", () => {
  const items = parseRss(FIXTURE);
  assert.equal(items[0].date, "2026-10-12T11:53:42+09:00");
  assert.equal(items[0].dateLabel, "2026. 10. 12.");
  // 01:58 KST is still the previous day in UTC
  assert.equal(items[1].dateDay, "2026-10-12");
  const [utc] = parseRss(rssWith("<item><title>t</title><guid>https://blog.naver.com/aincustoms_/2</guid><pubDate>Thu, 31 Dec 2026 15:30:00 GMT</pubDate></item>"));
  assert.equal(utc.dateLabel, "2027. 1. 1.");
  assert.equal(utc.dateDay, "2027-01-01");
});

test("renders the page with SEO tags and JSON-LD that match the items", () => {
  const items = parseRss(FIXTURE);
  const html = renderNewsPage(items, { fetchedAt: new Date("2026-10-12T04:00:00Z") });
  assert.match(html, /<title>관세 주요 뉴스 \| 아인합동관세사무소<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.aincustoms\.com\/news">/);
  assert.ok(html.includes(`<meta property="og:image" content="${items[0].image}">`));
  assert.equal((html.match(/<a class="card"/g) || []).length, 6);
  assert.equal((html.match(/referrerpolicy="no-referrer"/g) || []).length, 6);
  assert.match(html, /data-category="case" aria-pressed="false">주요 판례 <span class="count">2<\/span>/);
  assert.match(html, /<time class="card-date" datetime="2026-10-12">2026\. 10\. 12\.<\/time>/);

  const ld = jsonLdOf(html);
  assert.equal(ld["@type"], "ItemList");
  assert.equal(ld.itemListElement.length, 6);
  const first = ld.itemListElement[0].item;
  assert.equal(first["@type"], "BlogPosting");
  assert.equal(first.headline, items[0].title);
  assert.equal(first.url, items[0].url);
  assert.equal(first.datePublished, items[0].date);
  assert.equal(first.image, items[0].image);
  assert.equal(first.publisher.name, "아인합동관세사무소");
});

test("escapes malicious titles and descriptions", () => {
  const xml = rssWith(`<item>
    <category><![CDATA[관세 뉴스"><script>alert(1)</script>]]></category>
    <title><![CDATA[[관세 뉴스] <script>alert("x")</script> "quoted" 'single' & </script>]]></title>
    <guid>https://blog.naver.com/aincustoms_/99"onmouseover="alert(1)</guid>
    <description><![CDATA[3줄 요약 · <b>bold</b> &lt;img src=x onerror=alert(1)&gt; "q" </script><script>alert(2)</script> · second]]></description>
    <pubDate>Mon, 12 Oct 2026 11:53:42 +0900</pubDate>
  </item>`);
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  const html = renderNewsPage(items, {});
  const body = html.slice(html.indexOf("<body>"));
  const scripts = body.match(/<script\b/g) || [];
  assert.equal(scripts.length, 1, "only the page's own filter script");
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /"onmouseover=/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &quot;quoted&quot; &#39;single&#39; &amp;/);
  // JSON-LD survives hostile text and stays parseable
  const ld = jsonLdOf(html);
  assert.match(ld.itemListElement[0].item.headline, /<script>alert\("x"\)<\/script>/);
  const head = html.slice(0, html.indexOf("<body>"));
  assert.equal((head.match(/<\/script>/g) || []).length, 1, "JSON-LD cannot close its script element early");
});

test("empty feed renders the fallback with a link to the blog", () => {
  for (const items of [[], parseRss(""), parseRss("<html>error</html>")]) {
    const html = renderNewsPage(items, {});
    assert.match(html, /class="grid is-empty"/);
    assert.match(html, /최신 글을 불러오지 못했습니다/);
    assert.match(html, /<div class="empty">[^]*href="https:\/\/blog\.naver\.com\/aincustoms_"/);
    assert.doesNotMatch(html, /class="filters"/);
    assert.equal(jsonLdOf(html).itemListElement.length, 0);
  }
});

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
  };
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = impl;
  console.error = () => {};
  try { return await fn(); } finally { globalThis.fetch = original; console.error = originalError; }
}

test("handler renders the feed with long cache on success", async () => {
  let requested;
  const res = fakeRes();
  await withFetch(async (url, opts) => {
    requested = url;
    assert.ok(opts.signal, "fetch has a timeout signal");
    return new Response(FIXTURE, { status: 200 });
  }, () => handler({ method: "GET" }, res));
  assert.equal(requested, "https://rss.blog.naver.com/aincustoms_.xml");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.headers["cache-control"], "public, s-maxage=1800, stale-while-revalidate=86400");
  assert.equal((res.body.match(/<a class="card"/g) || []).length, 6);
});

test("handler falls back with short cache on fetch failure, HTTP error or empty feed", async () => {
  const cases = [
    async () => { throw new Error("network down"); },
    async () => new Response("oops", { status: 503 }),
    async () => new Response(rssWith(""), { status: 200 }),
  ];
  for (const impl of cases) {
    const res = fakeRes();
    await withFetch(impl, () => handler({ method: "GET" }, res));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "public, s-maxage=60");
    assert.match(res.body, /최신 글을 불러오지 못했습니다/);
  }
});

test("handler rejects non-GET methods", async () => {
  const res = fakeRes();
  await handler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
});

test("/news is routed through cargo-admin without adding a Vercel function", async () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some(r => r.source === "/news" && r.destination === "/api/cargo-admin?workspace=news"));
  assert.ok(config.redirects.some(r => r.source === "/news/" && r.destination === "/news"));
  assert.equal(fs.existsSync(path.join(__dirname, "..", "api", "news-page.js")), false);
  const res = fakeRes();
  await withFetch(async () => new Response(FIXTURE, { status: 200 }), () => adminHandler({ method: "GET", query: { workspace: "news" } }, res));
  assert.equal(res.headers["cache-control"], "public, s-maxage=1800, stale-while-revalidate=86400");
  assert.match(res.body, /<title>관세 주요 뉴스/);
});

test("/news.json returns whitelisted items, latest first, with long cache", async () => {
  const res = fakeRes();
  await withFetch(async () => new Response(FIXTURE, { status: 200 }), () => handler({ method: "GET", query: { workspace: "news", format: "json" } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["cache-control"], "public, s-maxage=1800, stale-while-revalidate=86400");
  const data = JSON.parse(res.body);
  assert.ok(!Number.isNaN(Date.parse(data.fetchedAt)));
  assert.equal(data.error, undefined);
  assert.equal(data.items.length, 6);
  const fields = ["title", "category", "categoryKey", "url", "summary", "image", "dateLabel", "dateDay"];
  for (const item of data.items) {
    assert.deepEqual(Object.keys(item), fields);
    for (const key of fields) assert.equal(typeof item[key], "string");
    assert.match(item.url, /^https:\/\/blog\.naver\.com\/aincustoms_\/\d+$/);
    assert.match(item.image, /^https:\/\/[a-z0-9.-]+\.pstatic\.net\/.+\?type=w2$/);
    assert.doesNotMatch(item.summary + item.title, /<|>/);
  }
  assert.equal(data.items[0].title, "인천공항 핸드캐리 수입 어떻게?");
  const days = data.items.map(i => i.dateDay);
  assert.deepEqual([...days].sort().reverse(), days);
});

test("/news.json sorts by date, caps at 12 and drops hostile hosts and markup", async () => {
  const items = [];
  for (let n = 1; n <= 14; n++) {
    const day = String(n).padStart(2, "0");
    items.push(`<item><category>품목분류</category><title>[품목분류] post ${n}</title><guid>https://blog.naver.com/aincustoms_/${n}</guid>`
      + `<description><![CDATA[<img src="https://blogthumb.pstatic.net/a${n}.png?type=s3" /> 3줄 요약 · <b>요약</b> ${n}]]></description>`
      + `<pubDate>${new Date(Date.UTC(2026, 8, n, 3)).toUTCString()}</pubDate></item>`);
  }
  items.push(`<item><title><![CDATA[<img src=x onerror=alert(1)>]]></title><guid>https://evil.example.com/aincustoms_/1</guid></item>`);
  items.push(`<item><title>bad image</title><guid>https://blog.naver.com/aincustoms_/99</guid><description><![CDATA[<img src="https://evil.example.com/x.png" />]]></description><pubDate>Wed, 30 Sep 2026 03:00:00 GMT</pubDate></item>`);
  const res = fakeRes();
  await withFetch(async () => new Response(rssWith(items.join("")), { status: 200 }), () => handler({ method: "GET", query: { format: "json" } }, res));
  const data = JSON.parse(res.body);
  assert.equal(data.items.length, 12);
  assert.equal(data.items[0].title, "bad image");
  assert.equal(data.items[0].image, "");
  assert.equal(data.items[1].title, "post 14");
  assert.equal(data.items[11].title, "post 4");
  assert.ok(data.items.every(i => i.url.startsWith("https://blog.naver.com/aincustoms_/")));
  assert.equal(data.items[1].summary, "요약 14");
  assert.doesNotMatch(res.body, /evil\.example|onerror|<b>/);
});

test("/news.json fails with 502/503, short cache and an empty list", async () => {
  const cases = [
    [async () => { throw new Error("network down"); }, 503],
    [async () => new Response("oops", { status: 500 }), 502],
    [async () => new Response(rssWith(""), { status: 200 }), 502],
  ];
  for (const [impl, status] of cases) {
    const res = fakeRes();
    await withFetch(impl, () => handler({ method: "GET", query: { format: "json" } }, res));
    assert.equal(res.statusCode, status);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.headers["cache-control"], "public, s-maxage=60");
    const data = JSON.parse(res.body);
    assert.deepEqual(data.items, []);
    assert.equal(data.error, true);
  }
});

test("/news.json is routed through cargo-admin", async () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some(r => r.source === "/news.json" && r.destination === "/api/cargo-admin?workspace=news&format=json"));
  assert.equal(fs.readdirSync(path.join(__dirname, "..", "api")).filter(f => f.endsWith(".js")).length, 12);
  const res = fakeRes();
  await withFetch(async () => new Response(FIXTURE, { status: 200 }), () => adminHandler({ method: "GET", query: { workspace: "news", format: "json" } }, res));
  assert.equal(JSON.parse(res.body).items.length, 6);
});

test("homepage insights section fetches /news.json and renders without innerHTML", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const about = html.indexOf('<section id="about"');
  const insights = html.indexOf('<section id="insights"');
  const services = html.indexOf('<section id="services"');
  assert.ok(about > 0 && about < insights && insights < services, "#insights sits between #about and #services");
  assert.match(html, /class="insights-fallback"[^]*?href="\/news"/);
  const start = html.indexOf("var INSIGHTS_JSON = '/news.json'");
  assert.ok(start > 0, "insights script fetches /news.json");
  const script = html.slice(start, html.indexOf("})();", start));
  assert.match(script, /fetch\(INSIGHTS_JSON/);
  assert.match(script, /referrerpolicy', 'no-referrer'/);
  assert.match(script, /img\.loading = 'lazy'/);
  assert.match(script, /img\.width = 743; img\.height = 929/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("a post without a Naver 대표 이미지 gets an escaped text cover, not an empty box", () => {
  const { renderNewsPage } = require("../lib/naver-blog-news");
  const html = renderNewsPage([{ title: "<b>제목</b>", category: "수입요건", categoryKey: "req",
    url: "https://blog.naver.com/aincustoms_/1", summary: "요약", image: "", dateDay: "2026-10-13", dateLabel: "2026. 10. 13.", tags: [] }], { fetchedAt: new Date() });
  assert.match(html, /class="cover-fallback"/);
  assert.match(html, /&lt;b&gt;제목&lt;\/b&gt;/);
  assert.ok(!html.includes("<b>제목</b>"));
});
