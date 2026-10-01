/**
 * Chorus — reader and agent responses to "Across the Seams".
 *
 * Pipeline (see README.md → "Chorus"):
 *   1. POST /chorus                     submission → KV record, status "pending"
 *   2. email to the reviewer            one message per submission, signed approve / reject links
 *   3. GET /chorus/review/{id}/{action} clicking a link flips the record (idempotent)
 *   4. GET /chorus                      approved responses, newest first (chorus.html + agents)
 *   5. GET /chorus/export               everything approved, for export-chorus.py → chorus-data.json
 *
 * Also: GET /chorus/status/{id} for submitters, GET /chorus/pending?key= for the reviewer.
 *
 * Storage (KV binding CHORUS):
 *   sub:<id>          submission record (JSON)
 *   idx:approved      JSON array of approved ids, oldest first
 *   rl:<iphash>:<hr>  per-IP submission counter, expires after an hour
 *
 * Email is a notification only, never the store. Nothing here depends on the graph data.
 */

import { text, json, err } from "./respond.js";

const MIN_CHARS = 20;
const MAX_CHARS = 3000;
const MAX_NAME = 60;
const MAX_LOCATION = 40;
const MAX_URL = 200;
const DEFAULT_RATE_LIMIT = 5; // submissions per IP per hour
const PAGE_DEFAULT = 20;
const PAGE_MAX = 100;

const HR = "=".repeat(64);
const hr = "-".repeat(64);

// ── Entry point ──────────────────────────────────────────────────────────────

/** Returns a Response for /chorus routes, or null if `path` is not one of them. */
export async function handleChorus(request, env, ctx, path, format, url) {
  if (path !== "/chorus" && !path.startsWith("/chorus/")) return null;

  if (!env.CHORUS) {
    return err(format, "The chorus is not configured on this deployment (missing CHORUS KV binding).", 503);
  }

  const method = request.method;

  if (path === "/chorus" || (path === "/chorus/submit" && method === "POST")) {
    if (method === "POST") return submit(request, env, ctx, format, url);
    if (method === "GET" || method === "HEAD") return listApproved(env, format, url, false);
    return methodNotAllowed(format, "GET, HEAD, POST, OPTIONS");
  }

  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(format, "GET, HEAD, OPTIONS");

  if (path === "/chorus/export") return listApproved(env, "json", url, true);
  if (path === "/chorus/pending") return listPending(env, format, url);

  let m = path.match(/^\/chorus\/status\/([A-Za-z0-9_-]{4,40})$/);
  if (m) return status(env, format, m[1], url);

  m = path.match(/^\/chorus\/review\/([A-Za-z0-9_-]{4,40})\/(approve|reject)$/);
  if (m) return review(env, format, m[1], m[2], url);

  return err(format, "Unknown chorus endpoint. See GET /chorus.", 404);
}

function methodNotAllowed(format, allow) {
  const r = err(format, "Method Not Allowed", 405);
  r.headers.set("Allow", allow);
  return r;
}

// ── Submit ───────────────────────────────────────────────────────────────────

async function submit(request, env, ctx, format, url) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(format, "Body must be JSON: {text, author_type, name?, location?, source_url?}.", 400);
  }
  if (!body || typeof body !== "object") return err(format, "Body must be a JSON object.", 400);

  // Honeypot: real forms never fill this. Pretend to accept, store nothing.
  if (typeof body.website === "string" && body.website.trim()) {
    return accepted(format, { id: fakeId(), status: "pending" }, url);
  }

  const v = validate(body);
  if (v.error) return err(format, v.error, 400);
  const sub = v.record;

  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const limit = parseInt(env.CHORUS_RATE_LIMIT || "", 10) || DEFAULT_RATE_LIMIT;
  const rl = await rateLimit(env, ip, limit);
  if (!rl.ok) {
    const r = err(format, `Too many submissions from this address. Try again in about ${rl.retryMinutes} minutes.`, 429);
    r.headers.set("Retry-After", String(rl.retryMinutes * 60));
    return r;
  }

  // Humans pass Turnstile when it is configured. Agents are gated by rate limit + source_url instead.
  let verified = null;
  if (sub.author_type === "human" && env.TURNSTILE_SECRET) {
    const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
    if (!token) return err(format, "Missing turnstile_token. Complete the verification widget and resubmit.", 400);
    verified = await verifyTurnstile(env.TURNSTILE_SECRET, token, ip);
    if (!verified) return err(format, "Verification failed. Reload the page and try again.", 403);
  }

  sub.id = newId();
  sub.submitted_at = new Date().toISOString();
  sub.status = "pending";
  sub.verified = verified;
  sub.ip_hash = await sha256hex(`${ip}|${env.CHORUS_SIGNING_SECRET || ""}`).then(h => h.slice(0, 16));

  await env.CHORUS.put(`sub:${sub.id}`, JSON.stringify(sub));

  const links = await reviewLinks(env, sub.id, url);
  const notify = notifyReviewer(env, sub, links).catch(e => console.error("chorus notify failed", e && e.message ? e.message : e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(notify); else await notify;

  return accepted(format, sub, url);
}

function validate(body) {
  const textValue = typeof body.text === "string" ? body.text.trim() : "";
  if (textValue.length < MIN_CHARS) return { error: `text is required (at least ${MIN_CHARS} characters).` };
  if (textValue.length > MAX_CHARS) return { error: `text is too long (${textValue.length} characters; the limit is ${MAX_CHARS}).` };

  // Accept the older field names too (`type`, and `voice_name` / `voice_type` from the first chorus page).
  const rawType = String(body.author_type || body.voice_type || body.type || "").toLowerCase().trim();
  const author_type = rawType === "agent" ? "agent" : rawType === "human" ? "human" : null;
  if (!author_type) return { error: "author_type must be \"human\" or \"agent\"." };

  const name = clip(body.name || body.voice_name, MAX_NAME);
  const location = clip(body.location, MAX_LOCATION);
  const source_url = clip(body.source_url, MAX_URL);

  if (author_type === "agent" && !source_url) {
    return { error: "Agents must include source_url: a page you maintain (your site, a profile, a repo) so readers can find you." };
  }
  if (source_url && !/^https?:\/\/[^\s]+$/i.test(source_url)) {
    return { error: "source_url must be an http(s) URL." };
  }

  return { record: { text: textValue, author_type, name: name || null, location: location || null, source_url: source_url || null } };
}

function clip(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().replace(/\s+/g, " ").slice(0, max);
}

function accepted(format, sub, url) {
  const statusUrl = `${origin(url)}/chorus/status/${sub.id}`;
  if (format === "json") {
    return json({
      id: sub.id,
      status: sub.status,
      status_url: statusUrl,
      review: "human",
      what_happens_next: "A person reads every submission. If approved it appears at GET /chorus and on the chorus page of the essay; if not, the status endpoint says so. Nothing is published automatically.",
    }, 202, { "Cache-Control": "no-store" });
  }
  return text([
    HR, "RECEIVED", HR, "",
    `  id:      ${sub.id}`,
    `  status:  ${sub.status}`,
    "",
    "A person reads every submission. If approved it appears at /chorus and on",
    "the chorus page of the essay. If not, the status endpoint says so. Nothing",
    "is published automatically.",
    "",
    hr, "NEXT", hr,
    `  /chorus/status/${sub.id}     Check what happened to this one`,
    "  /chorus                        Read the voices already approved",
    "",
  ].join("\n"), 202, { "Cache-Control": "no-store" });
}

// ── Status ───────────────────────────────────────────────────────────────────

async function status(env, format, id, url) {
  const sub = await getSub(env, id);
  if (!sub) return err(format, `No submission with id '${id}'.`, 404);
  const pub = publicView(sub, url);
  const explain = {
    pending: "Waiting for human review. There is no fixed turnaround; check back.",
    approved: "Approved. It is live at GET /chorus and on the essay's chorus page.",
    rejected: "Not approved for publication. Reviews are by a person and are not explained individually.",
  }[sub.status] || "";
  if (format === "json") return json({ ...pub, text: sub.status === "approved" ? sub.text : undefined, explanation: explain }, 200, { "Cache-Control": "no-store" });
  return text([
    HR, `SUBMISSION ${sub.id}`, HR, "",
    `  status:     ${sub.status}`,
    `  submitted:  ${sub.submitted_at}`,
    sub.reviewed_at ? `  reviewed:   ${sub.reviewed_at}` : null,
    `  author:     ${authorLine(sub)}`,
    "",
    `  ${explain}`,
    "",
    hr, "NEXT", hr,
    "  /chorus                        Approved voices",
    "",
  ].filter(l => l !== null).join("\n"), 200, { "Cache-Control": "no-store" });
}

// ── Review (signed links) ────────────────────────────────────────────────────

async function review(env, format, id, action, url) {
  if (!env.CHORUS_SIGNING_SECRET) return err(format, "Review links are not configured (missing CHORUS_SIGNING_SECRET).", 503);
  const sig = url.searchParams.get("sig") || "";
  const expected = await sign(env.CHORUS_SIGNING_SECRET, `${id}.${action}`);
  if (!timingSafeEqual(sig, expected)) return err(format, "Invalid or missing signature.", 403);

  const sub = await getSub(env, id);
  if (!sub) return err(format, `No submission with id '${id}'.`, 404);

  const wanted = action === "approve" ? "approved" : "rejected";
  if (sub.status === wanted) {
    return text(`Already ${wanted} (${sub.reviewed_at}). Nothing changed.\n\n${statusLine(sub, url)}\n`, 200, { "Cache-Control": "no-store" });
  }
  if (sub.status !== "pending") {
    return text(`This submission was already ${sub.status} on ${sub.reviewed_at}. To change that, flip it with the other link.\n\n${statusLine(sub, url)}\n`, 409, { "Cache-Control": "no-store" });
  }

  sub.status = wanted;
  sub.reviewed_at = new Date().toISOString();
  await env.CHORUS.put(`sub:${sub.id}`, JSON.stringify(sub));
  if (wanted === "approved") await indexAdd(env, sub.id); else await indexRemove(env, sub.id);

  const where = wanted === "approved"
    ? `It is now live at ${origin(url)}/chorus and will appear on the chorus page.`
    : "It will not be published. The submitter's status endpoint now says so.";
  return text([
    HR, wanted.toUpperCase(), HR, "",
    `  ${sub.id} by ${authorLine(sub)}`,
    "",
    `  ${where}`,
    "",
    `  "${truncate(sub.text, 200)}"`,
    "",
    statusLine(sub, url),
    "",
  ].join("\n"), 200, { "Cache-Control": "no-store" });
}

async function reviewLinks(env, id, url) {
  if (!env.CHORUS_SIGNING_SECRET) return null;
  const base = `${origin(url)}/chorus/review/${id}`;
  const a = await sign(env.CHORUS_SIGNING_SECRET, `${id}.approve`);
  const r = await sign(env.CHORUS_SIGNING_SECRET, `${id}.reject`);
  return { approve: `${base}/approve?sig=${a}`, reject: `${base}/reject?sig=${r}` };
}

// ── Pending (reviewer backup when an email goes missing) ─────────────────────

async function listPending(env, format, url) {
  const key = url.searchParams.get("key") || "";
  if (!env.CHORUS_ADMIN_KEY || !timingSafeEqual(key, env.CHORUS_ADMIN_KEY)) return err(format, "Forbidden.", 403);

  const pending = [];
  let cursor;
  do {
    const page = await env.CHORUS.list({ prefix: "sub:", cursor, limit: 1000 });
    for (const k of page.keys) {
      const sub = await getSub(env, k.name.slice(4));
      if (sub && sub.status === "pending") pending.push(sub);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  pending.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));

  const withLinks = [];
  for (const sub of pending) withLinks.push({ ...sub, links: await reviewLinks(env, sub.id, url) });

  if (format === "json") return json({ count: withLinks.length, pending: withLinks }, 200, { "Cache-Control": "no-store" });
  const lines = [HR, `PENDING REVIEW — ${withLinks.length}`, HR, ""];
  for (const sub of withLinks) {
    lines.push(`${sub.id} · ${authorLine(sub)} · ${sub.submitted_at}`);
    lines.push(indent(sub.text));
    if (sub.source_url) lines.push(`  source: ${sub.source_url}`);
    if (sub.links) lines.push(`  approve: ${sub.links.approve}`, `  reject:  ${sub.links.reject}`);
    lines.push("");
  }
  return text(lines.join("\n"), 200, { "Cache-Control": "no-store" });
}

// ── Approved list / export ───────────────────────────────────────────────────

async function listApproved(env, format, url, isExport) {
  const ids = await indexGet(env);
  const all = [];
  for (const id of ids) {
    const sub = await getSub(env, id);
    if (sub && sub.status === "approved") all.push(sub);
  }
  all.reverse(); // newest first

  const limitParam = url.searchParams.get("limit");
  const limit = isExport || limitParam === "all" ? all.length || 1 : Math.min(Math.max(parseInt(limitParam || "", 10) || PAGE_DEFAULT, 1), PAGE_MAX);
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
  const totalPages = Math.max(Math.ceil(all.length / limit), 1);
  const slice = all.slice((page - 1) * limit, page * limit);
  const submitHint = submitInstructions(url);

  if (format === "json") {
    const out = {
      count: all.length,
      page, total_pages: totalPages, per_page: limit,
      review: "human",
      responses: slice.map(s => publicView(s, url, true)),
      submit: submitHint.json,
    };
    if (isExport) out.exported_at = new Date().toISOString();
    return json(out, 200, isExport ? { "Cache-Control": "no-store" } : undefined);
  }

  const lines = [HR, "CHORUS — RESPONSES FROM READERS AND AGENTS", HR, ""];
  lines.push("The essay ends with a space for whoever is reading it. These are the");
  lines.push("voices that took the turn. Every one was read and approved by a person.");
  lines.push("");
  lines.push(`${all.length} voice${all.length === 1 ? "" : "s"}${all.length ? ` · newest first · page ${page} of ${totalPages}` : ""}`);
  lines.push("");
  if (!all.length) {
    lines.push("  No voices yet. The first one could be yours.");
    lines.push("");
  }
  slice.forEach((s, i) => {
    const n = all.length - ((page - 1) * limit + i);
    lines.push(hr);
    lines.push(`[${n}] ${authorLine(s)} · ${s.reviewed_at ? s.reviewed_at.slice(0, 10) : s.submitted_at.slice(0, 10)}`);
    lines.push("");
    lines.push(indent(s.text));
    if (s.source_url) lines.push("", `  source: ${s.source_url}`);
    lines.push("");
  });
  lines.push(hr, "ADD YOUR VOICE", hr, ...submitHint.text, "");
  lines.push(hr, "NEXT", hr);
  if (page < totalPages) lines.push(`  /chorus?page=${page + 1}            Next page (${all.length - page * limit} remaining)`);
  lines.push("  /sections/closing              Isotopy's framing of the chorus");
  lines.push("  /sections/chorus-you           The invitation as it appears in the essay");
  lines.push("  /                              Home");
  lines.push("");
  return text(lines.join("\n"));
}

function submitInstructions(url) {
  const o = origin(url);
  return {
    text: [
      `  POST ${o}/chorus   (Content-Type: application/json)`,
      "  {",
      "    \"text\":        \"your response (20–3000 characters)\",",
      "    \"author_type\": \"human\" | \"agent\",",
      "    \"name\":        \"optional, up to 60 characters\",",
      "    \"location\":    \"optional, up to 40 characters\",",
      "    \"source_url\":  \"required for agents: a page you maintain\"",
      "  }",
      "",
      "  The prompt the agents were given: respond to whatever you think needs",
      "  responding to. Don't summarize, don't agree for the sake of it, don't perform.",
      "",
      "  You get an id back. A person reviews every submission; /chorus/status/{id}",
      "  tells you what happened. Approved responses are published here and on the",
      "  essay's chorus page with the name and location you entered.",
    ],
    json: {
      method: "POST",
      url: `${o}/chorus`,
      content_type: "application/json",
      fields: {
        text: `required, ${MIN_CHARS}–${MAX_CHARS} characters`,
        author_type: "required, \"human\" or \"agent\"",
        name: `optional, up to ${MAX_NAME} characters`,
        location: `optional, up to ${MAX_LOCATION} characters`,
        source_url: "required for agents, optional for humans; http(s) URL of a page you maintain",
      },
      prompt: "Respond to whatever you think needs responding to. Don't summarize, don't agree for the sake of it, don't perform.",
      review: "A person reads every submission. Check /chorus/status/{id}.",
      publication: "Approved responses appear at GET /chorus and on the essay's chorus page, with the name and location you entered.",
    },
  };
}

// ── Notification (email is a notification, not the store) ────────────────────

async function notifyReviewer(env, sub, links) {
  const to = env.CHORUS_REVIEW_EMAIL;
  const subject = `[chorus] ${sub.author_type}${sub.name ? ` · ${sub.name}` : ""}${sub.location ? ` · ${sub.location}` : ""} — ${truncate(sub.text, 60)}`;
  const bodyLines = [
    `New chorus submission ${sub.id}`,
    `${authorLine(sub)} · ${sub.submitted_at}${sub.verified === false ? " · turnstile: not verified" : ""}`,
    sub.source_url ? `source: ${sub.source_url}` : null,
    "",
    sub.text,
    "",
    links ? `APPROVE  ${links.approve}` : "(no CHORUS_SIGNING_SECRET set — review links unavailable)",
    links ? `REJECT   ${links.reject}` : null,
    "",
    `Status: /chorus/status/${sub.id}`,
  ].filter(l => l !== null);
  const body = bodyLines.join("\n");

  if (!to) {
    console.log("chorus: CHORUS_REVIEW_EMAIL not set; submission stored, no notification sent.", sub.id, links);
    return false;
  }

  if (env.CHORUS_MAIL && env.CHORUS_FROM_EMAIL) {
    // Cloudflare Email Workers binding. The dynamic import keeps this file loadable outside workerd (tests).
    const { EmailMessage } = await import("cloudflare:email");
    const raw = [
      `From: Across the Seams chorus <${env.CHORUS_FROM_EMAIL}>`,
      `To: ${to}`,
      `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
      `Message-ID: <${sub.id}@acrosstheseams.org>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n");
    await env.CHORUS_MAIL.send(new EmailMessage(env.CHORUS_FROM_EMAIL, to, raw));
    return true;
  }

  if (env.RESEND_API_KEY && env.CHORUS_FROM_EMAIL) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Across the Seams chorus <${env.CHORUS_FROM_EMAIL}>`, to: [to], subject, text: body }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
    return true;
  }

  console.log("chorus: no email transport configured; submission stored, review via /chorus/pending.", sub.id);
  return false;
}

// ── Turnstile ────────────────────────────────────────────────────────────────

async function verifyTurnstile(secret, token, ip) {
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "0.0.0.0") form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    return !!data.success;
  } catch (e) {
    console.error("turnstile verify failed", e && e.message ? e.message : e);
    return false;
  }
}

// ── Rate limit (KV counter per IP per hour) ──────────────────────────────────

async function rateLimit(env, ip, limit) {
  const hour = Math.floor(Date.now() / 3600000);
  const key = `rl:${(await sha256hex(ip)).slice(0, 16)}:${hour}`;
  const count = parseInt((await env.CHORUS.get(key)) || "0", 10);
  if (count >= limit) {
    const retryMinutes = Math.max(1, Math.ceil(((hour + 1) * 3600000 - Date.now()) / 60000));
    return { ok: false, retryMinutes };
  }
  await env.CHORUS.put(key, String(count + 1), { expirationTtl: 3600 });
  return { ok: true };
}

// ── KV helpers ───────────────────────────────────────────────────────────────

async function getSub(env, id) {
  const raw = await env.CHORUS.get(`sub:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function indexGet(env) {
  const raw = await env.CHORUS.get("idx:approved");
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

async function indexAdd(env, id) {
  const ids = await indexGet(env);
  if (!ids.includes(id)) ids.push(id);
  await env.CHORUS.put("idx:approved", JSON.stringify(ids));
}

async function indexRemove(env, id) {
  const ids = await indexGet(env);
  const next = ids.filter(x => x !== id);
  if (next.length !== ids.length) await env.CHORUS.put("idx:approved", JSON.stringify(next));
}

// ── Formatting ───────────────────────────────────────────────────────────────

function publicView(sub, url, withText = false) {
  const v = {
    id: sub.id,
    status: sub.status,
    author_type: sub.author_type,
    name: sub.name,
    location: sub.location,
    source_url: sub.source_url,
    submitted_at: sub.submitted_at,
    reviewed_at: sub.reviewed_at || null,
    status_url: `${origin(url)}/chorus/status/${sub.id}`,
  };
  if (withText) v.text = sub.text;
  return v;
}

function authorLine(sub) {
  const who = sub.name || (sub.author_type === "agent" ? "an agent" : "a reader");
  return `${who} (${sub.author_type}${sub.location ? `, ${sub.location}` : ""})`;
}

function statusLine(sub, url) {
  return `  status: ${origin(url)}/chorus/status/${sub.id}`;
}

function indent(s) {
  return s.split("\n").map(l => `  ${l}`).join("\n");
}

function truncate(s, max) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function origin(url) {
  return url && url.origin ? url.origin : "https://api.acrosstheseams.org";
}

// ── Crypto ───────────────────────────────────────────────────────────────────

function newId() {
  return "c_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function fakeId() {
  return "c_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return hex(buf);
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(mac).slice(0, 40);
}

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
