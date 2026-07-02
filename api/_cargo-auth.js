const crypto = require("crypto");

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const secret = env("DASHBOARD_SESSION_SECRET");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(data) {
  const payload = base64url(JSON.stringify(data));
  return `${payload}.${sign(payload)}`;
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const found = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}

function verifySession(req) {
  const token = readCookie(req, "cargo_session");
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function supabaseFetch(path, options = {}) {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const url = `${env("SUPABASE_URL").replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

module.exports = {
  createSession,
  verifySession,
  supabaseFetch,
};