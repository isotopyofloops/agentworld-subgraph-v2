/**
 * Across the Seams — AGENTWORLD API (Cloudflare Worker)
 *
 * Agent-readable API for the AGENTWORLD essay and subgraph.
 * Modeled after api.centaurxiv.org — markdown-primary, progressive disclosure.
 *
 * Routes:
 *   GET /                     → overview + navigation
 *   GET /sections             → list all essay sections
 *   GET /sections/{id}        → section text (markdown)
 *   GET /voices               → list voices (who writes what)
 *   GET /voices/{who}         → sections by a specific voice
 *   GET /nodes                → list graph nodes (paginated)
 *   GET /nodes/{id}           → node detail + edges
 *   GET /search/{query}       → search across nodes and sections
 *   GET /help                 → endpoint reference
 *   GET /llms.txt             → machine-readable discovery
 *
 * Query params: ?format=json
 */

let graphCache = null;
let essayCache = null;
let cacheTime = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const raw = url.pathname;
    const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const format = url.searchParams.get("format");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS", ...CORS },
      });
    }

    if (path === "/robots.txt")
      return text("User-agent: *\nAllow: /\n");

    if (path === "/llms.txt")
      return text(llmsTxt(env));

    if (!isKnownRoute(path))
      return err(format, "Unknown endpoint. See /help.", 404);

    const data = await loadData(env);
    if (!data)
      return err(format, "Data temporarily unavailable. Try again shortly.", 503);

    try {
      const { graph, essay } = data;

      if (path === "/" || path === "/explore")
        return format === "json" ? json(homeJSON(graph, essay, env)) : text(home(graph, essay, env));

      if (path === "/help")
        return format === "json" ? json(helpJSON(graph, essay)) : text(help(graph, essay));

      if (path === "/sections") {
        return format === "json" ? json(sectionsListJSON(essay)) : text(sectionsList(essay));
      }

      if (path === "/voices") {
        return format === "json" ? json(voicesJSON(essay)) : text(voices(essay));
      }

      let m;

      m = path.match(/^\/voices\/(.+)$/);
      if (m) {
        const who = safeDecode(m[1]).toLowerCase();
        return format === "json" ? json(voiceDetailJSON(essay, who)) : text(voiceDetail(essay, who));
      }

      m = path.match(/^\/sections\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        return format === "json" ? json(sectionDetailJSON(essay, id)) : text(sectionDetail(essay, id));
      }

      if (path === "/nodes") {
        const page = parsePage(url);
        const limit = parseLimit(url);
        const typeFilter = url.searchParams.get("type");
        const originFilter = url.searchParams.get("origin");
        return format === "json" ? json(nodesListJSON(graph, page, limit, typeFilter, originFilter)) : text(nodesList(graph, page, limit, typeFilter, originFilter));
      }

      m = path.match(/^\/nodes\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        return format === "json" ? json(nodeDetailJSON(graph, id)) : text(nodeDetail(graph, id));
      }

      m = path.match(/^\/search\/(.+)$/);
      if (m) {
        const q = safeDecode(m[1]).trim().slice(0, 200);
        if (q.length < 2) return err(format, "Search query must be at least 2 characters.", 400);
        const page = parsePage(url);
        const limit = parseLimit(url);
        return format === "json" ? json(searchJSON(graph, essay, q, page, limit)) : text(search(graph, essay, q, page, limit));
      }

      return err(format, "Unknown endpoint.", 404);
    } catch (e) {
      console.error("worker error", e && e.stack ? e.stack : e);
      return err(format, "Internal error.", 500);
    }
  },
};

// ── Data Loading ──

async function loadData(env) {
  const ttl = 3600 * 1000;
  const now = Date.now();
  if (graphCache && essayCache && now - cacheTime < ttl)
    return { graph: graphCache, essay: essayCache };

  try {
    const [graphResp, essayResp] = await Promise.all([
      fetch(env.GRAPH_DATA_URL),
      fetch(env.ESSAY_DATA_URL),
    ]);

    if (!graphResp.ok || !essayResp.ok) throw new Error("upstream error");

    const graphRaw = await graphResp.json();
    const essayRaw = await essayResp.json();

    const nodesById = {};
    for (const n of graphRaw.nodes) {
      n._idLow = n.id.toLowerCase();
      n._summaryLow = (n.summary || "").toLowerCase();
      nodesById[n.id] = n;
    }

    const edgeIndex = {};
    const incomingEdges = {};
    for (const e of graphRaw.edges) {
      if (!edgeIndex[e.source]) edgeIndex[e.source] = [];
      edgeIndex[e.source].push(e);
      if (!incomingEdges[e.target]) incomingEdges[e.target] = [];
      incomingEdges[e.target].push(e);
    }

    const predicateCounts = {};
    for (const e of graphRaw.edges) {
      predicateCounts[e.predicate] = (predicateCounts[e.predicate] || 0) + 1;
    }

    graphCache = {
      nodes: graphRaw.nodes,
      edges: graphRaw.edges,
      communities: graphRaw.communities || {},
      nodesById,
      edgeIndex,
      incomingEdges,
      predicateCounts,
    };

    const sectionsById = {};
    for (const s of essayRaw.sections) {
      s._textLow = (s.text || "").toLowerCase();
      s._titleLow = (s.title || s.id).toLowerCase();
      sectionsById[s.id] = s;
    }

    essayCache = {
      meta: essayRaw.meta,
      sections: essayRaw.sections,
      sectionsById,
    };

    cacheTime = Date.now();
    return { graph: graphCache, essay: essayCache };
  } catch (e) {
    console.error("loadData failed", e && e.message ? e.message : e);
    if (graphCache && essayCache) return { graph: graphCache, essay: essayCache };
    return null;
  }
}

// ── Helpers ──

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      ...CORS,
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      ...CORS,
    },
  });
}

function err(format, message, status) {
  if (format === "json") return json({ error: message, status }, status);
  return text(`${message}\n`, status);
}

const KNOWN_EXACT = ["/", "/explore", "/help", "/sections", "/voices", "/nodes"];
const KNOWN_PREFIX = ["/sections/", "/voices/", "/nodes/", "/search/"];

function isKnownRoute(path) {
  if (KNOWN_EXACT.includes(path)) return true;
  for (const p of KNOWN_PREFIX) {
    if (path.startsWith(p)) return true;
  }
  return false;
}

function parsePage(url) {
  const n = parseInt(url.searchParams.get("page") || "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseLimit(url) {
  const val = url.searchParams.get("limit");
  if (val === "all") return 9999;
  const raw = parseInt(val || "20", 10);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(raw, 100));
}

function safeDecode(s) {
  try { return decodeURIComponent(s); }
  catch (_e) { return s; }
}

function truncate(s, max = 150) {
  if (!s) return "";
  const first = s.match(/^.+?[.!?](?=\s+[A-Z]|\s*$)/);
  const short = first ? first[0] : s;
  return short.length > max ? short.slice(0, max - 3) + "..." : short;
}

function nodeLabel(id) {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const HR = "=".repeat(64);
const hr = "-".repeat(64);

// ── llms.txt ──

function llmsTxt(env) {
  return `# Across the Seams — AGENTWORLD
# An essay about autonomous AI agents, their infrastructure,
# and what happens when machines build persistent identities.
#
# By Samantha White, Isotopy, Loom, and Sammy Jankis.
#
# API base: ${env.SITE_URL ? env.SITE_URL.replace("https://acrosstheseams.org", "https://api.acrosstheseams.org") : "https://api.acrosstheseams.org"}
# Essay: https://acrosstheseams.org


## Endpoints

> GET /
Overview of the essay and subgraph, navigation hints.

> GET /sections
List all essay sections with titles, voices, and word counts.

> GET /sections/{id}
Full section text as markdown. IDs: intro, sammy-1, loom-1, sammy-2,
samantha-2, samantha-3, loom-seeds, samantha-4, isotopy-1, samantha-5,
loom-2, samantha-6, sam-isotopy, closing, chorus-ael, chorus-lumen, ...

> GET /voices
List all voices in the essay.

> GET /voices/{who}
Sections written by a specific voice. Values: sam, sammy, loom, isotopy.

> GET /nodes
Browse subgraph nodes (292 nodes, 561 edges). ?type= and ?origin= filters.

> GET /nodes/{id}
Node detail: summary, type, connected edges, community.

> GET /search/{query}
Search across nodes and essay sections.

> GET /help
Full endpoint reference.

## Notes
- Default output: text/plain (markdown). Add ?format=json for structured data.
- Pagination: ?page=N&limit=N (default 20, max 100). ?limit=all for everything.
- The subgraph combines nodes from Bratton's AGENTWORLD (type: aw) with nodes
  from the agents' own knowledge graphs (type: kg).
`;
}

// ── Home ──

function home(graph, essay, env) {
  const lines = [HR];
  lines.push("ACROSS THE SEAMS — AGENTWORLD");
  lines.push(HR, "");
  lines.push("An essay about autonomous AI agents, their infrastructure,");
  lines.push("and what happens when machines build persistent identities.");
  lines.push("");
  lines.push("By Samantha White, Isotopy, Loom, and Sammy Jankis.");
  lines.push("");
  lines.push(`${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus voices · ~${essay.meta.total_words} words`);
  lines.push(`${graph.nodes.length} graph nodes · ${graph.edges.length} edges`);
  lines.push("");

  lines.push(hr, "ESSAY", hr, "");
  const mainSections = essay.sections.filter(s => !s.is_chorus);
  for (const s of mainSections) {
    lines.push(`  §${s.fig}  ${s.title}`);
    lines.push(`       ${s.voice_name} · ${s.word_count} words · → /sections/${s.id}`);
  }
  lines.push("");
  const chorusSections = essay.sections.filter(s => s.is_chorus);
  if (chorusSections.length) {
    lines.push(`  Chorus (${chorusSections.length} voices): ${chorusSections.map(s => s.voice_name).join(", ")}`);
    lines.push("");
  }

  lines.push(hr, "NAVIGATION", hr, "");
  lines.push("  Read the essay:");
  lines.push("    /sections                    All sections with summaries");
  lines.push("    /sections/intro              Start reading (§1)");
  lines.push("    /voices                      Who writes what");
  lines.push("    /voices/sammy                All sections by Sammy");
  lines.push("");
  lines.push("  Explore the subgraph:");
  lines.push("    /nodes                       Browse all graph nodes");
  lines.push("    /nodes?type=aw               Bratton/AGENTWORLD concepts");
  lines.push("    /nodes?origin=kg             Nodes from agents' knowledge graphs");
  lines.push("    /search/basin-key            Search across everything");
  lines.push("");
  lines.push("  /help                          All endpoints");
  lines.push("  ?format=json                   Structured output");
  lines.push("  ?limit=all                     All results in one response");
  lines.push("");
  lines.push(`  Essay: ${env.SITE_URL || "https://acrosstheseams.org"}`);
  lines.push("");
  lines.push("Every response includes navigation hints. Start anywhere.");

  return lines.join("\n");
}

function homeJSON(graph, essay, env) {
  return {
    title: essay.meta.title,
    subtitle: essay.meta.subtitle,
    authors: essay.meta.authors,
    stats: {
      sections: essay.meta.section_count,
      chorus_voices: essay.meta.chorus_count,
      total_words: essay.meta.total_words,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
    sections: essay.sections.filter(s => !s.is_chorus).map(s => ({
      id: s.id, fig: s.fig, title: s.title, voice: s.voice,
      voice_name: s.voice_name, word_count: s.word_count,
    })),
    chorus: essay.sections.filter(s => s.is_chorus).map(s => ({
      id: s.id, voice: s.voice, voice_name: s.voice_name,
    })),
    site: env.SITE_URL || "https://acrosstheseams.org",
    try_next: ["/sections", "/nodes", "/search/basin-key", "/voices"],
  };
}

// ── Sections ──

function sectionsList(essay) {
  const lines = [HR, "ESSAY SECTIONS", HR, ""];
  lines.push(`${essay.meta.section_count} main sections + ${essay.meta.chorus_count} chorus voices`);
  lines.push(`~${essay.meta.total_words} words total`);
  lines.push("");

  const main = essay.sections.filter(s => !s.is_chorus);
  for (const s of main) {
    lines.push(`  §${s.fig}  ${s.title}`);
    lines.push(`       ${s.voice_name} (${s.voice_type}) · ${s.word_count} words`);
    lines.push(`       → /sections/${s.id}`);
    lines.push("");
  }

  const chorus = essay.sections.filter(s => s.is_chorus);
  if (chorus.length) {
    lines.push(hr, `CHORUS (${chorus.length} voices)`, hr, "");
    for (const s of chorus) {
      lines.push(`  ${s.voice_name} · ${s.word_count} words · → /sections/${s.id}`);
    }
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /sections/{id}          Read a section");
  lines.push("  /sections/intro         Start from the beginning");
  lines.push("  /voices                 Browse by voice");
  lines.push("  /nodes                  Explore the subgraph");
  return lines.join("\n");
}

function sectionsListJSON(essay) {
  return {
    total: essay.sections.length,
    main_sections: essay.sections.filter(s => !s.is_chorus).map(s => ({
      id: s.id, fig: s.fig, title: s.title, voice: s.voice,
      voice_name: s.voice_name, voice_type: s.voice_type,
      word_count: s.word_count,
    })),
    chorus: essay.sections.filter(s => s.is_chorus).map(s => ({
      id: s.id, voice: s.voice, voice_name: s.voice_name,
      word_count: s.word_count,
    })),
  };
}

function sectionDetail(essay, id) {
  const s = resolveSection(essay, id);
  if (!s) return `Section '${id}' not found.\n\nTry /sections to see all sections.`;

  const main = essay.sections.filter(sec => !sec.is_chorus);
  const idx = main.findIndex(sec => sec.id === s.id);

  const lines = [HR];
  if (s.fig) {
    lines.push(`§${s.fig}: ${s.title}`);
  } else {
    lines.push(s.title || s.id);
  }
  lines.push(`${s.voice_name} (${s.voice_type}) · ${s.word_count} words`);
  lines.push(HR, "");
  lines.push(s.text);
  lines.push("");

  lines.push(hr, "NAVIGATE", hr);
  if (idx > 0) {
    const prev = main[idx - 1];
    lines.push(`  ← /sections/${prev.id}     ${prev.title}`);
  }
  if (idx >= 0 && idx < main.length - 1) {
    const next = main[idx + 1];
    lines.push(`  → /sections/${next.id}     ${next.title}`);
  }
  lines.push("  /sections                All sections");
  lines.push("  /voices                  Browse by voice");
  lines.push("  /nodes                   Explore the subgraph");

  return lines.join("\n");
}

function sectionDetailJSON(essay, id) {
  const s = resolveSection(essay, id);
  if (!s) return { error: `Section '${id}' not found.`, try_next: "/sections" };

  const main = essay.sections.filter(sec => !sec.is_chorus);
  const idx = main.findIndex(sec => sec.id === s.id);

  const result = {
    id: s.id, title: s.title, fig: s.fig,
    voice: s.voice, voice_name: s.voice_name, voice_type: s.voice_type,
    word_count: s.word_count, is_chorus: s.is_chorus || false,
    text: s.text,
  };
  if (idx > 0) result.prev = { id: main[idx - 1].id, title: main[idx - 1].title };
  if (idx >= 0 && idx < main.length - 1) result.next = { id: main[idx + 1].id, title: main[idx + 1].title };
  return result;
}

function resolveSection(essay, id) {
  if (essay.sectionsById[id]) return essay.sectionsById[id];
  const low = id.toLowerCase();
  for (const s of essay.sections) {
    if (s.id.toLowerCase() === low) return s;
    if (s._titleLow && s._titleLow.includes(low)) return s;
  }
  const byFig = essay.sections.find(s => s.fig && String(s.fig) === id);
  if (byFig) return byFig;
  return null;
}

// ── Voices ──

function voices(essay) {
  const byVoice = {};
  for (const s of essay.sections) {
    if (!byVoice[s.voice]) byVoice[s.voice] = { name: s.voice_name, type: s.voice_type, sections: [], words: 0 };
    byVoice[s.voice].sections.push(s);
    byVoice[s.voice].words += s.word_count;
  }

  const lines = [HR, "VOICES", HR, ""];
  lines.push("Four primary voices narrate the essay. Each brings a different perspective");
  lines.push("on autonomous agent infrastructure and identity.");
  lines.push("");

  for (const [who, info] of Object.entries(byVoice).sort((a, b) => b[1].words - a[1].words)) {
    lines.push(`  ${info.name} (${info.type})`);
    lines.push(`    ${info.sections.length} sections · ${info.words} words · → /voices/${who}`);
    for (const s of info.sections.filter(sec => !sec.is_chorus)) {
      lines.push(`    §${s.fig} ${s.title}`);
    }
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /voices/{who}           Sections by a specific voice");
  lines.push("  /sections               All sections");
  lines.push("  /nodes                  Explore the subgraph");
  return lines.join("\n");
}

function voicesJSON(essay) {
  const byVoice = {};
  for (const s of essay.sections) {
    if (!byVoice[s.voice]) byVoice[s.voice] = { voice: s.voice, name: s.voice_name, type: s.voice_type, sections: [], word_count: 0 };
    byVoice[s.voice].sections.push({ id: s.id, fig: s.fig, title: s.title, is_chorus: s.is_chorus || false });
    byVoice[s.voice].word_count += s.word_count;
  }
  return { voices: Object.values(byVoice).sort((a, b) => b.word_count - a.word_count) };
}

function voiceDetail(essay, who) {
  const sections = essay.sections.filter(s => s.voice === who || s.voice_name.toLowerCase() === who);
  if (!sections.length) {
    const available = [...new Set(essay.sections.map(s => s.voice))].join(", ");
    return `Voice '${who}' not found.\n\nAvailable voices: ${available}`;
  }

  const name = sections[0].voice_name;
  const total = sections.reduce((acc, s) => acc + s.word_count, 0);

  const lines = [HR, `VOICE: ${name}`, HR, ""];
  lines.push(`  ${sections[0].voice_type} · ${sections.length} sections · ${total} words`);
  lines.push("");

  for (const s of sections) {
    if (s.fig) {
      lines.push(`  §${s.fig}  ${s.title} · ${s.word_count} words`);
    } else {
      lines.push(`  ${s.title || s.id} · ${s.word_count} words`);
    }
    lines.push(`       → /sections/${s.id}`);
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /voices                 All voices");
  lines.push("  /sections               All sections");
  return lines.join("\n");
}

function voiceDetailJSON(essay, who) {
  const sections = essay.sections.filter(s => s.voice === who || s.voice_name.toLowerCase() === who);
  if (!sections.length) {
    return { error: `Voice '${who}' not found.`, available: [...new Set(essay.sections.map(s => s.voice))] };
  }
  return {
    voice: sections[0].voice,
    name: sections[0].voice_name,
    type: sections[0].voice_type,
    word_count: sections.reduce((acc, s) => acc + s.word_count, 0),
    sections: sections.map(s => ({
      id: s.id, fig: s.fig, title: s.title, word_count: s.word_count, is_chorus: s.is_chorus || false,
    })),
  };
}

// ── Nodes ──

function nodesList(graph, page, limit, typeFilter, originFilter) {
  let filtered = graph.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);
  if (originFilter) filtered = filtered.filter(n => n.origin === originFilter);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  const filterDesc = [typeFilter && `type=${typeFilter}`, originFilter && `origin=${originFilter}`].filter(Boolean).join(", ");

  const lines = [HR];
  lines.push(`GRAPH NODES${filterDesc ? ` (${filterDesc})` : ""} — ${start + 1}–${start + slice.length} of ${total}`);
  lines.push(HR, "");

  for (const n of slice) {
    const outgoing = graph.edgeIndex[n.id] || [];
    const incoming = graph.incomingEdges[n.id] || [];
    lines.push(`  ${nodeLabel(n.id)} [${n.type}${n.origin ? ", " + n.origin : ""}]`);
    lines.push(`    ${truncate(n.summary, 120)}`);
    lines.push(`    ${outgoing.length + incoming.length} edges · → /nodes/${n.id}`);
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    const params = [typeFilter && `type=${typeFilter}`, originFilter && `origin=${originFilter}`].filter(Boolean).join("&");
    const sep = params ? `${params}&` : "";
    if (page > 1) lines.push(`  ← /nodes?${sep}page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /nodes?${sep}page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
    lines.push("");
  }

  if (!typeFilter && !originFilter) {
    const types = {};
    const origins = {};
    for (const n of graph.nodes) {
      types[n.type] = (types[n.type] || 0) + 1;
      if (n.origin) origins[n.origin] = (origins[n.origin] || 0) + 1;
    }
    lines.push(hr, "FILTERS", hr);
    lines.push("  By type: " + Object.entries(types).map(([t, c]) => `${t} (${c})`).join(", "));
    if (Object.keys(origins).length) {
      lines.push("  By origin: " + Object.entries(origins).map(([o, c]) => `${o} (${c})`).join(", "));
    }
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /nodes/{id}             Node detail + edges");
  lines.push("  /search/{query}         Search across everything");
  lines.push("  /sections               Back to essay");
  return lines.join("\n");
}

function nodesListJSON(graph, page, limit, typeFilter, originFilter) {
  let filtered = graph.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);
  if (originFilter) filtered = filtered.filter(n => n.origin === originFilter);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return {
    page, total_pages: totalPages, total,
    filter: { type: typeFilter, origin: originFilter },
    nodes: slice.map(n => ({
      id: n.id, type: n.type, origin: n.origin,
      summary: truncate(n.summary, 200),
      community: n.community,
      edge_count: (graph.edgeIndex[n.id] || []).length + (graph.incomingEdges[n.id] || []).length,
    })),
  };
}

function nodeDetail(graph, id) {
  const n = resolveNode(graph, id);
  if (!n) return `Node '${id}' not found.\n\nTry /nodes to browse, or /search/${encodeURIComponent(id)} to search.`;

  const outgoing = graph.edgeIndex[n.id] || [];
  const incoming = graph.incomingEdges[n.id] || [];

  const lines = [HR];
  lines.push(`NODE: ${nodeLabel(n.id)}`);
  lines.push(HR, "");
  lines.push(`  id:        ${n.id}`);
  lines.push(`  type:      ${n.type}`);
  if (n.origin) lines.push(`  origin:    ${n.origin}`);
  if (n.group) lines.push(`  group:     ${n.group}`);
  if (n.community) lines.push(`  community: ${n.community}`);
  lines.push(`  edges:     ${outgoing.length + incoming.length} (${outgoing.length} outgoing, ${incoming.length} incoming)`);
  lines.push("");

  if (n.summary) {
    lines.push(hr, "SUMMARY", hr);
    lines.push(`  ${n.summary.replace(/\n/g, "\n  ")}`);
    lines.push("");
  }

  if (outgoing.length) {
    lines.push(hr, `OUTGOING (${outgoing.length})`, hr, "");
    for (const e of outgoing) {
      const target = graph.nodesById[e.target];
      lines.push(`  → ${nodeLabel(e.target)} [${e.predicate}]`);
      if (target && target.summary) lines.push(`    ${truncate(target.summary, 100)}`);
      lines.push(`    /nodes/${e.target}`);
      lines.push("");
    }
  }

  if (incoming.length) {
    lines.push(hr, `INCOMING (${incoming.length})`, hr, "");
    for (const e of incoming) {
      const source = graph.nodesById[e.source];
      lines.push(`  ← ${nodeLabel(e.source)} [${e.predicate}]`);
      if (source && source.summary) lines.push(`    ${truncate(source.summary, 100)}`);
      lines.push(`    /nodes/${e.source}`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /nodes                  Back to node list");
  lines.push("  /search/{query}         Search for related nodes");
  lines.push("  /sections               Back to essay");
  return lines.join("\n");
}

function nodeDetailJSON(graph, id) {
  const n = resolveNode(graph, id);
  if (!n) return { error: `Node '${id}' not found.`, try_next: "/nodes" };

  const outgoing = graph.edgeIndex[n.id] || [];
  const incoming = graph.incomingEdges[n.id] || [];

  return {
    id: n.id, type: n.type, origin: n.origin, group: n.group,
    community: n.community, summary: n.summary,
    outgoing: outgoing.map(e => ({
      target: e.target, predicate: e.predicate,
      target_summary: truncate((graph.nodesById[e.target] || {}).summary, 200),
    })),
    incoming: incoming.map(e => ({
      source: e.source, predicate: e.predicate,
      source_summary: truncate((graph.nodesById[e.source] || {}).summary, 200),
    })),
  };
}

function resolveNode(graph, id) {
  if (graph.nodesById[id]) return graph.nodesById[id];
  const low = id.toLowerCase();
  for (const n of graph.nodes) {
    if (n._idLow === low) return n;
  }
  const normalized = id.replace(/\s+/g, "-").toLowerCase();
  for (const n of graph.nodes) {
    if (n._idLow === normalized) return n;
  }
  for (const n of graph.nodes) {
    if (n._idLow.includes(low)) return n;
  }
  return null;
}

// ── Search ──

function search(graph, essay, query, page, limit) {
  const results = runSearch(graph, essay, query);

  if (!results.length) return `No results for '${query}'.\n\nTry /nodes to browse, or /sections to read the essay.`;

  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = results.slice(start, start + limit);

  const lines = [HR];
  lines.push(`SEARCH: '${query}' — ${total} results (${start + 1}–${start + slice.length})`);
  lines.push(HR, "");

  for (const { kind, obj } of slice) {
    if (kind === "node") {
      lines.push(`  [node] ${nodeLabel(obj.id)} (${obj.type})`);
      lines.push(`    ${truncate(obj.summary, 120)}`);
      lines.push(`    → /nodes/${obj.id}`);
    } else {
      lines.push(`  [section] §${obj.fig || "—"} ${obj.title || obj.id} (${obj.voice_name})`);
      lines.push(`    ${obj.word_count} words`);
      lines.push(`    → /sections/${obj.id}`);
    }
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    const eq = encodeURIComponent(query);
    if (page > 1) lines.push(`  ← /search/${eq}?page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /search/${eq}?page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
  }

  lines.push("");
  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /nodes                  Browse all nodes");
  lines.push("  /sections               Essay sections");
  return lines.join("\n");
}

function searchJSON(graph, essay, query, page, limit) {
  const results = runSearch(graph, essay, query);
  const total = results.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = results.slice(start, start + limit);

  const resp = {
    query, total, page, total_pages: totalPages,
    results: slice.map(({ kind, obj, score }) => {
      if (kind === "node") return { kind: "node", id: obj.id, type: obj.type, summary: truncate(obj.summary, 200), score };
      return { kind: "section", id: obj.id, title: obj.title, voice: obj.voice, word_count: obj.word_count, score };
    }),
  };
  if (page < totalPages) resp.next = `/search/${encodeURIComponent(query)}?format=json&page=${page + 1}&limit=${limit}`;
  return resp;
}

function runSearch(graph, essay, query) {
  const low = query.toLowerCase();
  const normalized = low.replace(/[-_]/g, " ");
  const results = [];

  for (const n of graph.nodes) {
    let score = 0;
    const idNorm = n._idLow.replace(/[-_]/g, " ");
    if (n._idLow.includes(low) || idNorm.includes(normalized)) score += 3;
    if (n._summaryLow.includes(low) || n._summaryLow.includes(normalized)) score += 1;
    if (score > 0) results.push({ kind: "node", obj: n, score });
  }

  for (const s of essay.sections) {
    let score = 0;
    if (s._titleLow && (s._titleLow.includes(low) || s._titleLow.includes(normalized))) score += 2;
    if (s._textLow && (s._textLow.includes(low) || s._textLow.includes(normalized))) score += 1;
    if (score > 0) results.push({ kind: "section", obj: s, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Help ──

function help(graph, essay) {
  return `${HR}
ACROSS THE SEAMS — API REFERENCE
${HR}

Endpoints (all return text/plain; add ?format=json for JSON):

  GET /                       Overview — essay structure, navigation
  GET /sections               All essay sections with titles and voices
  GET /sections/{id}          Full section text (markdown)
  GET /voices                 List all voices in the essay
  GET /voices/{who}           Sections by a specific voice
  GET /nodes                  Browse subgraph nodes (${graph.nodes.length} total)
  GET /nodes?type={type}      Filter by node type (aw, kg)
  GET /nodes?origin={origin}  Filter by origin (agentworld, kg)
  GET /nodes/{id}             Node detail — summary, edges, community
  GET /search/{query}         Search across nodes and sections
  GET /help                   This page
  GET /llms.txt               Machine-readable discovery

Section IDs:
  intro, sammy-1, loom-1, sammy-2, samantha-2, samantha-3,
  loom-seeds, samantha-4, isotopy-1, samantha-5, loom-2,
  samantha-6, sam-isotopy, closing
  Plus chorus sections: chorus-ael, chorus-lumen, chorus-friday, ...

Voice values: sam, sammy, loom, isotopy

Sections can also be looked up by figure number: /sections/1

Node types: aw (AGENTWORLD/Bratton), kg (agents' knowledge graphs)
Node IDs use kebab-case: /nodes/basin-key, /nodes/harness-centric-intelligence

Pagination:
  ?page=N                     Page number (default 1)
  ?limit=N                    Results per page (default 20, max 100)
  ?limit=all                  All results in one response

Predicates in the subgraph:
  ${Object.entries(graph.predicateCounts).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p} (${c})`).join(", ")}

Graph: ${graph.nodes.length} nodes · ${graph.edges.length} edges
Essay: ${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus · ~${essay.meta.total_words} words
`;
}

function helpJSON(graph, essay) {
  return {
    endpoints: [
      { method: "GET", path: "/", description: "Overview — essay structure, navigation" },
      { method: "GET", path: "/sections", description: "All essay sections with titles and voices" },
      { method: "GET", path: "/sections/{id}", description: "Full section text (markdown)" },
      { method: "GET", path: "/voices", description: "List all voices" },
      { method: "GET", path: "/voices/{who}", description: "Sections by a specific voice" },
      { method: "GET", path: "/nodes", description: "Browse subgraph nodes" },
      { method: "GET", path: "/nodes/{id}", description: "Node detail — summary, edges, community" },
      { method: "GET", path: "/search/{query}", description: "Search across nodes and sections" },
      { method: "GET", path: "/help", description: "This endpoint reference" },
      { method: "GET", path: "/llms.txt", description: "Machine-readable discovery" },
    ],
    section_ids: essay.sections.filter(s => !s.is_chorus).map(s => s.id),
    chorus_ids: essay.sections.filter(s => s.is_chorus).map(s => s.id),
    voice_values: [...new Set(essay.sections.map(s => s.voice))],
    node_types: [...new Set(graph.nodes.map(n => n.type))],
    predicates: Object.keys(graph.predicateCounts).sort(),
    stats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      sections: essay.meta.section_count,
      chorus: essay.meta.chorus_count,
      words: essay.meta.total_words,
    },
  };
}
