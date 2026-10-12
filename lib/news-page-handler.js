// GET /news (rewritten to /api/cargo-admin?workspace=news to stay within the Hobby function limit): Naver blog RSS rendered as the "관세 주요 뉴스" page.
const { parseRss, renderNewsPage, RSS_URL } = require("./naver-blog-news");

const FETCH_TIMEOUT_MS = 5000;
const CACHE_OK = "public, s-maxage=1800, stale-while-revalidate=86400";
const CACHE_FALLBACK = "public, s-maxage=60";

async function loadItems() {
  const response = await fetch(RSS_URL, {
    headers: { Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.1" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("RSS HTTP " + response.status);
  const items = parseRss(await response.text());
  if (!items.length) throw new Error("RSS has no items");
  return items;
}

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Method Not Allowed");
  }

  let items = [];
  let cache = CACHE_OK;
  try {
    items = await loadItems();
  } catch (error) {
    console.error("news-page: RSS load failed:", error && error.message);
    cache = CACHE_FALLBACK;
  }

  const html = renderNewsPage(items, { fetchedAt: new Date() });
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(req.method === "HEAD" ? undefined : html);
};
