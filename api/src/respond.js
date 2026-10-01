// Shared response helpers for the worker. Imported by index.js and chorus.js.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function baseHeaders(contentType, status, extra) {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
    ...CORS,
    ...(extra || {}),
  };
}

export function text(body, status = 200, extra) {
  return new Response(body, { status, headers: baseHeaders("text/plain; charset=utf-8", status, extra) });
}

export function json(obj, status = 200, extra) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: baseHeaders("application/json; charset=utf-8", status, extra) });
}

export function err(format, message, status) {
  if (format === "json") return json({ error: message, status }, status);
  return text(`${message}\n`, status);
}
