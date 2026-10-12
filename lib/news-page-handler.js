// GET /news (rewritten to /api/cargo-admin?workspace=news to stay within the Hobby function limit): Naver blog RSS rendered as the "관세 주요 뉴스" page.
// GET /news.json (rewritten to the same handler with format=json): the latest posts for the homepage "관세 인사이트" section.
const { parseRss, renderNewsPage, RSS_URL } = require("./naver-blog-news");

const FETCH_TIMEOUT_MS = 5000;
const CACHE_OK = "public, s-maxage=1800, stale-while-revalidate=86400";
const CACHE_FALLBACK = "public, s-maxage=60";
const JSON_MAX_ITEMS = 12;
const JSON_FIELDS = ["title", "category", "categoryKey", "url", "summary", "image", "dateLabel", "dateDay"];

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

// Latest first (RSS order breaks ties), whitelisted fields only; url/image already passed the parser's host allowlists.
function toJsonItems(items) {
  return items
    .map((item, index) => ({ item, index, time: Date.parse(item.date || "") || 0 }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .slice(0, JSON_MAX_ITEMS)
    .map(({ item }) => Object.fromEntries(JSON_FIELDS.map(key => [key, String(item[key] == null ? "" : item[key])])));
}

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Method Not Allowed");
  }

  const json = req.query?.format === "json";
  let items = [];
  let failure = null;
  try {
    items = await loadItems();
  } catch (error) {
    console.error("news-page: RSS load failed:", error && error.message);
    failure = error;
  }

  const fetchedAt = new Date();
  let body;
  if (json) {
    // Upstream answered badly -> 502; network error or timeout -> 503.
    res.statusCode = failure ? (/^RSS (HTTP|has no items)/.test(String(failure.message)) ? 502 : 503) : 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    body = JSON.stringify(failure ? { items: [], error: true, fetchedAt: fetchedAt.toISOString() } : { items: toJsonItems(items), fetchedAt: fetchedAt.toISOString() });
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    body = renderNewsPage(items, { fetchedAt });
  }
  res.setHeader("Cache-Control", failure ? CACHE_FALLBACK : CACHE_OK);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(req.method === "HEAD" ? undefined : body);
};

module.exports.toJsonItems = toJsonItems;
