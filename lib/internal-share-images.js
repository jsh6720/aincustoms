"use strict";
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const IMAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_BODY_LIMIT = 3 * 1024 * 1024;
const IMAGE_DIMENSION = 2560;
const IMAGE_PIXELS = 7 * 1024 * 1024;
const IMAGE_ID = /^[a-f0-9]{64}$/;
const BUCKET = "internal-note-images";
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Clipboard images are normalized by canvas: no SVG, animation, EXIF,
// profiles, palettes, interlacing or arbitrary metadata survive the wire.
function validatePng(bytes, fail) {
  if (!Buffer.isBuffer(bytes) || bytes.length > IMAGE_LIMIT) fail(413, "IMAGE_TOO_LARGE");
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(SIGNATURE)) fail(400, "INVALID_IMAGE");
  let offset = 8, width, height, channels, ended = false, idatStarted = false, idatEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(400, "INVALID_IMAGE");
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) fail(400, "INVALID_IMAGE");
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(kind)) fail(400, "INVALID_IMAGE");
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail(400, "INVALID_IMAGE");
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && kind !== "IHDR") fail(400, "INVALID_IMAGE");
    if (kind === "IHDR") {
      if (offset !== 8 || length !== 13) fail(400, "INVALID_IMAGE");
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (!width || !height || width > IMAGE_DIMENSION || height > IMAGE_DIMENSION || width * height > IMAGE_PIXELS) fail(413, "IMAGE_TOO_LARGE");
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) fail(400, "INVALID_IMAGE");
      channels = data[9] === 6 ? 4 : 3;
    } else if (kind === "IDAT") {
      if (idatEnded) fail(400, "INVALID_IMAGE");
      idatStarted = true; compressed.push(data);
    } else if (kind === "IEND") {
      if (length || !idatStarted || end !== bytes.length) fail(400, "INVALID_IMAGE");
      ended = true;
    } else {
      const lengths = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
      if (!Object.hasOwn(lengths, kind) || length !== lengths[kind] || idatStarted) fail(400, "INVALID_IMAGE");
    }
    if (idatStarted && kind !== "IDAT") idatEnded = true;
    offset = end;
  }
  if (!ended) fail(400, "INVALID_IMAGE");
  const rowBytes = width * channels + 1, expected = rowBytes * height;
  let inflated;
  try { inflated = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); }
  catch { fail(400, "INVALID_IMAGE"); }
  if (inflated.length !== expected) fail(400, "INVALID_IMAGE");
  for (let row = 0; row < height; row++) if (inflated[row * rowBytes] > 4) fail(400, "INVALID_IMAGE");
  return { id: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, mime: "image/png", width, height };
}
function parseImage(value, fail) {
  if (typeof value !== "string" || !value) fail(400, "INVALID_IMAGE");
  if (value.length > Math.ceil(IMAGE_LIMIT / 3) * 4) fail(413, "IMAGE_TOO_LARGE");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(400, "INVALID_IMAGE");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(400, "INVALID_IMAGE");
  return { bytes, metadata: validatePng(bytes, fail) };
}
function createImageStore(config, fetchImpl, fail) {
  async function fetchStorage(id, options = {}) {
    try {
      const route = options.method === "POST" ? "object" : "object/authenticated";
      return await fetchImpl(`${config.supabaseUrl}/storage/v1/${route}/${BUCKET}/${id}.png`, {
        ...options, headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
          ...(options.headers || {}) }, signal: AbortSignal.timeout(10000), redirect: "error",
      });
    } catch { fail(503, "IMAGE_STORAGE_UNAVAILABLE"); }
  }
  async function rpc(name, parameters) {
    let response, value;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(parameters), signal: AbortSignal.timeout(10000), redirect: "error",
      });
      value = await response.json();
    } catch { fail(503, "IMAGE_STORAGE_UNAVAILABLE"); }
    if (!response.ok) {
      if (value?.code === "PT413") fail(413, "IMAGE_LIMIT");
      fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    }
    return value;
  }
  function metadata(value, expected) {
    if (!value || value.id !== expected.id || !Number.isSafeInteger(value.bytes) || value.bytes < 57 || value.bytes > IMAGE_LIMIT ||
        value.mime !== "image/png" || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > IMAGE_DIMENSION ||
        !Number.isSafeInteger(value.height) || value.height < 1 || value.height > IMAGE_DIMENSION ||
        typeof value.ready !== "boolean") fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    for (const name of ["bytes", "width", "height"]) {
      if (expected[name] !== undefined && value[name] !== expected[name]) fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    }
    return value;
  }
  async function readBytes(id, expected) {
    const response = await fetchStorage(id);
    if (!response.ok) fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    const contentLength = response.headers?.get("content-length");
    if (contentLength !== null && contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > IMAGE_LIMIT)) fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    const reader = response.body?.getReader();
    let bytes;
    try {
      if (reader) {
        const chunks = []; let size = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > IMAGE_LIMIT) { await reader.cancel(); fail(503, "IMAGE_STORAGE_UNAVAILABLE"); }
          chunks.push(Buffer.from(value));
        }
        bytes = Buffer.concat(chunks);
      } else bytes = Buffer.from(await response.arrayBuffer());
    } catch { fail(503, "IMAGE_STORAGE_UNAVAILABLE"); }
    let actual;
    try { actual = validatePng(bytes, fail); } catch { fail(503, "IMAGE_STORAGE_UNAVAILABLE"); }
    if (actual.id !== id || ["bytes", "width", "height"].some(name => actual[name] !== expected[name])) fail(503, "IMAGE_STORAGE_UNAVAILABLE");
    return bytes;
  }
  return {
    async upload(value) {
      const { bytes, metadata: expected } = parseImage(value, fail);
      const entry = metadata(await rpc("internal_share_image_reserve", {
        p_id: expected.id, p_bytes: expected.bytes, p_width: expected.width, p_height: expected.height,
      }), expected);
      if (!entry.ready) {
        let uploaded = false;
        try {
          const response = await fetchStorage(expected.id, { method: "POST", body: bytes,
            headers: { "Content-Type": "image/png", "x-upsert": "false" } });
          uploaded = response.ok;
        } catch { /* A dropped acknowledgement may still have stored the object. */ }
        // Unknown/existing uploads are never overwritten: verify exact bytes
        // and hash before completing a conservatively quota-counted reservation.
        if (!uploaded) await readBytes(expected.id, expected);
        const completed = metadata(await rpc("internal_share_image_complete", { p_id: expected.id }), expected);
        if (!completed.ready) fail(503, "IMAGE_STORAGE_UNAVAILABLE");
      }
      return { id: expected.id, url: `/api/internal-share?action=image&id=${expected.id}`, mime: "image/png" };
    },
    async read(id) {
      if (typeof id !== "string" || id.length !== 64 || !IMAGE_ID.test(id)) fail(400, "INVALID_IMAGE_ID");
      const entry = await rpc("internal_share_image_read", { p_id: id });
      if (entry === null) fail(404, "IMAGE_NOT_FOUND");
      const expected = metadata(entry, { id });
      if (!expected.ready) fail(404, "IMAGE_NOT_FOUND");
      return readBytes(id, expected);
    },
  };
}
module.exports = { createImageStore, parseImage, validatePng, crc32, IMAGE_LIMIT, IMAGE_BODY_LIMIT, IMAGE_DIMENSION, IMAGE_PIXELS, IMAGE_ID, BUCKET };
