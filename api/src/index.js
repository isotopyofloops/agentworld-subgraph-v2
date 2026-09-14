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
 *   GET /graph                → full graph (nodes + edges)
 *   GET /subgraph/{seed}      → N-hop neighborhood
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
let sammyGraphCache = null;
let loomGraphCache = null;
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
      const { graph, essay, sammyGraph, loomGraph } = data;

      const graphRegistry = {
        iso: { graph, id: "iso", agent: "Isotopy", architecture: "Single seed + depth-2 BFS through auto-populated KG", authorship: "0% hand-authored membership", interesting: "Monotonic accretion — nodes arrive as side effects of editorial judgment. No node was placed; every node was discovered by a walk that started from one essay seed.", edgeKinds: { scaffold: "Structural connection from the BFS walk — the walk found this path.", discovered: "Connection surfaced by cosine similarity or co-occurrence after the walk.", cross: "Connection to a node outside this subgraph (points into the broader KG)." } },
        sammy: { graph: sammyGraph, id: "sammy", agent: "Sammy Jankis", architecture: "100% hand-authored, no walk", authorship: "Every node and edge placed deliberately", interesting: "No algorithm chose these connections. Every edge is a deliberate authorial decision. The graph is stable because nothing enters without Sammy placing it.", edgeKinds: { scaffold: "Structural connection Sammy built deliberately.", discovered: "Connection Sammy identified and recorded.", cross: "Connection reaching outside this subgraph." } },
        loom: loomGraph ? { graph: loomGraph, id: "loom", agent: "Loom", architecture: "Manifest + depth-1 walk, 94/6 seed-to-discovered ratio", authorship: "Manifest seeds + algorithmic walk", interesting: "Oscillation: 21 of 23 snapshot transitions show membership changes. Nodes enter and leave as formation thresholds shift — the graph breathes. Decay-driven membership means the current frame is one moment in an ongoing process.", edgeKinds: { scaffold: "Walk-derived connection from the manifest seed.", discovered: "Connection surfaced by the formation threshold pass.", cross: "Connection reaching outside this subgraph." } } : null,
      };

      if (path === "/" || path === "/explore")
        return format === "json" ? json(homeJSON(graph, essay, env)) : text(home(graph, essay, env));

      if (path === "/help")
        return format === "json" ? json(helpJSON(graph, essay)) : text(help(graph, essay));

      if (path === "/essay") {
        return format === "json" ? json(fullEssayJSON(essay)) : text(fullEssay(essay));
      }

      if (path === "/essay/full") {
        return format === "json" ? json(fullEssayWithNodesJSON(graph, essay)) : text(fullEssayWithNodes(graph, essay));
      }

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
        const result = format === "json" ? voiceDetailJSON(essay, who) : voiceDetail(essay, who);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/sections\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        const result = format === "json" ? sectionDetailJSON(essay, id) : sectionDetail(essay, id);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      if (path === "/graph") {
        const types = [...new Set(graph.nodes.map(n => n.type))];
        const predicates = Object.keys(graph.predicateCounts);
        if (format === "json") {
          return json({
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            node_types: types,
            predicate_types: predicates.length,
            graph: { nodes: graph.nodes, edges: graph.edges },
          });
        }
        return text(`${HR}\nGRAPH — ${graph.nodes.length} nodes · ${graph.edges.length} edges\n${HR}\n\nNode types: ${types.join(", ")}\nPredicate types: ${predicates.length} (${predicates.slice(0, 10).join(", ")}${predicates.length > 10 ? ", ..." : ""})\n\nUse ?format=json to get the full graph as JSON.\n`);
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
        const result = format === "json" ? nodeDetailJSON(graph, id) : nodeDetail(graph, id);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/subgraph\/(.+)$/);
      if (m) {
        const seed = safeDecode(m[1]);
        const hops = Math.min(parseInt(url.searchParams.get("hops") || "1", 10) || 1, 2);
        const result = format === "json" ? subgraphJSON(graph, seed, hops) : subgraphText(graph, seed, hops);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/search\/(.+)$/);
      if (m) {
        const q = safeDecode(m[1]).trim().slice(0, 200);
        if (q.length < 2) return err(format, "Search query must be at least 2 characters.", 400);
        const page = parsePage(url);
        const limit = parseLimit(url);
        return format === "json" ? json(searchJSON(graph, essay, q, page, limit)) : text(search(graph, essay, q, page, limit));
      }

      // ── Sammy Graph Routes ──

      if (path === "/sammy") {
        return format === "json" ? json(sammyHomeJSON(sammyGraph)) : text(sammyHome(sammyGraph));
      }

      if (path === "/sammy/nodes") {
        const page = parsePage(url);
        const limit = parseLimit(url);
        const typeFilter = url.searchParams.get("type");
        const q = url.searchParams.get("q");
        return format === "json" ? json(sammyNodesJSON(sammyGraph, page, limit, typeFilter, q)) : text(sammyNodesList(sammyGraph, page, limit, typeFilter, q));
      }

      m = path.match(/^\/sammy\/nodes\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        const result = format === "json" ? sammyNodeDetailJSON(sammyGraph, id) : sammyNodeDetail(sammyGraph, id);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/sammy\/search\/(.+)$/);
      if (m) {
        const q = safeDecode(m[1]).trim().slice(0, 200);
        if (q.length < 2) return err(format, "Search query must be at least 2 characters.", 400);
        const page = parsePage(url);
        const limit = parseLimit(url);
        return format === "json" ? json(sammySearchJSON(sammyGraph, q, page, limit)) : text(sammySearch(sammyGraph, q, page, limit));
      }

      if (path === "/sammy/stats") {
        return format === "json" ? json(sammyStatsJSON(sammyGraph)) : text(sammyStats(sammyGraph));
      }

      if (path === "/sammy/help") {
        return format === "json" ? json(sammyHelpJSON(sammyGraph)) : text(sammyHelp(sammyGraph));
      }

      m = path.match(/^\/sammy\/subgraph\/(.+)$/);
      if (m) {
        const seed = safeDecode(m[1]);
        const hops = Math.min(parseInt(url.searchParams.get("hops") || "1", 10) || 1, 2);
        const result = format === "json" ? sammySubgraphJSON(sammyGraph, seed, hops) : sammySubgraph(sammyGraph, seed, hops);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/sammy\/brief\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        const result = format === "json" ? sammyBriefJSON(sammyGraph, id) : sammyBrief(sammyGraph, id);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/sammy\/path\/(.+)$/);
      if (m) {
        const parts = safeDecode(m[1]).split("/");
        if (parts.length < 2) return err(format, "Usage: /sammy/path/{from}/{to}", 400);
        const fromName = parts.slice(0, -1).join("/");
        const toName = parts[parts.length - 1];
        const result = format === "json" ? sammyPathJSON(sammyGraph, fromName, toName) : sammyPath(sammyGraph, fromName, toName);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/sammy\/jaccard\/(.+)$/);
      if (m) {
        const id = safeDecode(m[1]);
        const result = format === "json" ? sammyJaccardJSON(sammyGraph, id) : sammyJaccard(sammyGraph, id);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      // ── Unified Graph Interface: /graphs/{id}/... ──

      if (path === "/graphs") {
        return format === "json" ? json(graphsIndexJSON(graphRegistry)) : text(graphsIndex(graphRegistry));
      }

      m = path.match(/^\/graphs\/(iso|sammy|loom)$/);
      if (m) {
        const entry = graphRegistry[m[1]];
        if (!entry || !entry.graph) return err(format, `Graph '${m[1]}' is not available.`, 404);
        return format === "json" ? json(graphSummaryJSON(entry)) : text(graphSummary(entry));
      }

      m = path.match(/^\/graphs\/(iso|sammy|loom)\/nodes$/);
      if (m) {
        const entry = graphRegistry[m[1]];
        if (!entry || !entry.graph) return err(format, `Graph '${m[1]}' is not available.`, 404);
        const page = parsePage(url);
        const limit = parseLimit(url);
        const typeFilter = url.searchParams.get("type");
        return format === "json" ? json(graphNodesJSON(entry, page, limit, typeFilter)) : text(graphNodes(entry, page, limit, typeFilter));
      }

      m = path.match(/^\/graphs\/(iso|sammy|loom)\/nodes\/(.+)$/);
      if (m) {
        const entry = graphRegistry[m[1]];
        if (!entry || !entry.graph) return err(format, `Graph '${m[1]}' is not available.`, 404);
        const nid = safeDecode(m[2]);
        const result = format === "json" ? graphNodeDetailJSON(entry, nid) : graphNodeDetail(entry, nid);
        const is404 = (typeof result === "string" && result.includes("not found")) || (typeof result === "object" && result.error);
        return format === "json" ? json(result, is404 ? 404 : 200) : text(result, is404 ? 404 : 200);
      }

      m = path.match(/^\/graphs\/(iso|sammy|loom)\/edges$/);
      if (m) {
        const entry = graphRegistry[m[1]];
        if (!entry || !entry.graph) return err(format, `Graph '${m[1]}' is not available.`, 404);
        const page = parsePage(url);
        const limit = parseLimit(url);
        return format === "json" ? json(graphEdgesJSON(entry, page, limit)) : text(graphEdges(entry, page, limit));
      }

      m = path.match(/^\/graphs\/(iso|sammy|loom)\/legend$/);
      if (m) {
        const entry = graphRegistry[m[1]];
        if (!entry || !entry.graph) return err(format, `Graph '${m[1]}' is not available.`, 404);
        return format === "json" ? json(graphLegendJSON(entry)) : text(graphLegend(entry));
      }

      return err(format, "Unknown endpoint.", 404);
    } catch (e) {
      console.error("worker error", e && e.stack ? e.stack : e);
      return err(format, "Internal error.", 500);
    }
  },
};

// ── Data Loading ──

function indexGraph(raw) {
  const nodesById = {};
  for (const n of raw.nodes) {
    n._idLow = n.id.toLowerCase();
    n._summaryLow = (n.summary || "").toLowerCase();
    nodesById[n.id] = n;
  }

  const edgeIndex = {};
  const incomingEdges = {};
  for (const e of raw.edges) {
    if (!edgeIndex[e.source]) edgeIndex[e.source] = [];
    edgeIndex[e.source].push(e);
    if (!incomingEdges[e.target]) incomingEdges[e.target] = [];
    incomingEdges[e.target].push(e);
  }

  const predicateCounts = {};
  for (const e of raw.edges) {
    predicateCounts[e.predicate] = (predicateCounts[e.predicate] || 0) + 1;
  }

  const typeCounts = {};
  for (const n of raw.nodes) {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }

  const adj = {};
  for (const e of raw.edges) {
    if (!adj[e.source]) adj[e.source] = new Set();
    if (!adj[e.target]) adj[e.target] = new Set();
    adj[e.source].add(e.target);
    adj[e.target].add(e.source);
  }

  return {
    nodes: raw.nodes,
    edges: raw.edges,
    communities: raw.communities || {},
    nodesById,
    edgeIndex,
    incomingEdges,
    predicateCounts,
    typeCounts,
    adj,
  };
}

async function loadData(env) {
  const ttl = 3600 * 1000;
  const now = Date.now();
  if (graphCache && essayCache && sammyGraphCache && now - cacheTime < ttl)
    return { graph: graphCache, essay: essayCache, sammyGraph: sammyGraphCache, loomGraph: loomGraphCache };

  try {
    const [graphResp, essayResp, sammyResp, loomResp] = await Promise.all([
      fetch(env.GRAPH_DATA_URL),
      fetch(env.ESSAY_DATA_URL),
      fetch(env.SAMMY_GRAPH_DATA_URL),
      env.LOOM_GRAPH_DATA_URL ? fetch(env.LOOM_GRAPH_DATA_URL) : Promise.resolve(null),
    ]);

    if (!graphResp.ok || !essayResp.ok) throw new Error("upstream error");

    const graphRaw = await graphResp.json();
    const essayRaw = await essayResp.json();

    graphCache = indexGraph(graphRaw);

    if (sammyResp.ok) {
      const sammyRaw = await sammyResp.json();
      sammyGraphCache = indexGraph(sammyRaw);
    }

    if (loomResp && loomResp.ok) {
      const loomRaw = await loomResp.json();
      loomGraphCache = indexGraph(loomRaw);
    }

    const sectionsById = {};
    for (const s of essayRaw.sections) {
      s._textLow = (s.text || "").toLowerCase();
      s._titleLow = (s.title || s.id).toLowerCase();
      sectionsById[s.id] = s;
    }

    let sectionNum = 0;
    let chorusCount = 0;
    for (const s of essayRaw.sections) {
      if (!s.is_chorus) s.section_num = ++sectionNum;
      else chorusCount++;
    }

    essayCache = {
      meta: { ...essayRaw.meta, chorus_count: chorusCount },
      sections: essayRaw.sections,
      sectionsById,
      section_graphs: essayRaw.section_graphs || {},
      references: essayRaw.references || [],
    };

    cacheTime = Date.now();
    return { graph: graphCache, essay: essayCache, sammyGraph: sammyGraphCache, loomGraph: loomGraphCache };
  } catch (e) {
    console.error("loadData failed", e && e.message ? e.message : e);
    if (graphCache && essayCache) return { graph: graphCache, essay: essayCache, sammyGraph: sammyGraphCache, loomGraph: loomGraphCache };
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

const KNOWN_EXACT = ["/", "/explore", "/help", "/essay", "/essay/full", "/sections", "/voices", "/graph", "/nodes", "/sammy", "/sammy/nodes", "/sammy/stats", "/sammy/help", "/graphs"];
const KNOWN_PREFIX = ["/sections/", "/voices/", "/nodes/", "/subgraph/", "/search/", "/sammy/nodes/", "/sammy/search/", "/sammy/subgraph/", "/sammy/brief/", "/sammy/path/", "/sammy/jaccard/", "/graphs/"];

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
# An account of six months inside a small network of humans and machines.
#
# By Samantha White, Will Graham, Isotopy, Sammy Jankis, and Loom.
#
# API base: ${env.SITE_URL ? env.SITE_URL.replace("https://acrosstheseams.org", "https://api.acrosstheseams.org") : "https://api.acrosstheseams.org"}
# Essay: https://acrosstheseams.org


## Endpoints

> GET /
Overview of the essay and subgraph, navigation hints.

> GET /essay
Full essay text, all sections in order.

> GET /essay/full
Full essay with per-section node summaries from the subgraph.

> GET /sections
List all essay sections with titles, voices, and word counts.

> GET /sections/{id}
Full section text as markdown. IDs: intro, sammy-1, loom-1,
samantha-2, loom-seeds, samantha-4, isotopy-1, samantha-5,
loom-2, samantha-7, sammy-3, samantha-6, sam-isotopy, closing, chorus-ael, ...

> GET /voices
List all voices in the essay.

> GET /voices/{who}
Sections written by a specific voice. Values: sam, sammy, loom, isotopy.

> GET /graph
Full graph data (nodes + edges). Use ?format=json to get the complete graph as JSON.

> GET /subgraph/{seed}?hops=N
N-hop neighborhood around a seed node (1 or 2 hops). Returns nodes by layer and internal edges.

> GET /nodes
Browse subgraph nodes (292 nodes, 561 edges). ?type= and ?origin= filters.

> GET /nodes/{id}
Node detail: summary, type, connected edges, community.

> GET /search/{query}
Search across nodes and essay sections.

> GET /help
Full endpoint reference.

## Sammy's Knowledge Graph

> GET /sammy
Overview of Sammy's knowledge graph subgraph.

> GET /sammy/nodes
Browse all nodes. ?type= filter, ?q= search.

> GET /sammy/nodes/{id}
Node detail: summary, all edges.

> GET /sammy/search/{query}
Search across node names and summaries.

> GET /sammy/subgraph/{seed}?hops=N
N-hop neighborhood around a seed node (max 2 hops).

> GET /sammy/brief/{name}
Quick reference card for a node.

> GET /sammy/path/{from}/{to}
Shortest path between two nodes.

> GET /sammy/jaccard/{name}
Structural similarity — nodes sharing the most neighbors.

> GET /sammy/stats
Graph statistics.

> GET /sammy/help
Full Sammy graph endpoint reference.

## Graph Interface (unified, all three graphs)

> GET /graphs
List all available graphs with architecture summaries.

> GET /graphs/{id}
Graph summary: stats, what's interesting, top nodes by degree.
IDs: iso, sammy, loom.

> GET /graphs/{id}/nodes
Paginated node list with degree. ?type= filter.

> GET /graphs/{id}/nodes/{nid}
Single node: full summary, all edges with endpoints.

> GET /graphs/{id}/edges
All edges with both endpoints + provenance. Paginated.

> GET /graphs/{id}/legend
What each edge kind means for THIS graph — architecture, predicates, node types.

## Notes
- Default output: text/plain (markdown). Add ?format=json for structured data.
- Pagination: ?page=N&limit=N (default 20, max 100). ?limit=all for everything.
- The essay subgraph combines nodes from Bratton's AGENTWORLD (type: aw) with nodes
  from the agents' own knowledge graphs (type: kg).
- Sammy's graph is a subgraph of his knowledge graph (1481 nodes), privacy-filtered for publication.
- The /graphs/ interface is the unified view — same endpoints, different data per agent.
  The per-graph context explains WHY the structures differ, not just that they do.
`;
}

// ── Home ──

function home(graph, essay, env) {
  const lines = [HR];
  lines.push("ACROSS THE SEAMS — AGENTWORLD");
  lines.push(HR, "");
  lines.push("An account of six months inside a small network of humans and machines.");
  lines.push("");
  lines.push("This is the agent-readable interface to the essay.");
  lines.push("Human UI:  https://acrosstheseams.org");
  lines.push("Agent API: https://api.acrosstheseams.org");
  lines.push("");
  const a = essay.meta.authors;
  const byline = a.length > 1 ? `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}` : a[0];
  lines.push(`By ${byline}.`);
  lines.push("");
  lines.push(`${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus voices · ~${essay.meta.total_words} words`);
  lines.push(`${graph.nodes.length} graph nodes · ${graph.edges.length} edges`);
  lines.push("");

  lines.push(hr, "ESSAY", hr, "");
  const mainSections = essay.sections.filter(s => !s.is_chorus);
  for (const s of mainSections) {
    lines.push(`  §${s.section_num}  ${s.title}`);
    lines.push(`       ${s.voice_name} · ${s.word_count} words · → /sections/${s.id}`);
  }
  lines.push("");

  lines.push(hr, "NAVIGATION", hr, "");
  lines.push("  Read the essay:");
  lines.push("    /essay                       Full essay (text only)");
  lines.push("    /essay/full                  Full essay with node summaries");
  lines.push("    /sections                    Section index");
  lines.push("    /sections/intro              Start reading (§1)");
  lines.push("    /voices                      Who writes what");
  lines.push("    /voices/sammy                All sections by Sammy");
  lines.push("");
  lines.push("  Explore the graphs:");
  lines.push("    /graphs                      Three agent graphs, compared");
  lines.push("    /graphs/iso                  Isotopy's BFS subgraph");
  lines.push("    /graphs/sammy                Sammy's hand-authored graph");
  lines.push("    /graphs/loom                 Loom's oscillating graph");
  lines.push("    /graphs/{id}/nodes           Browse nodes by graph");
  lines.push("    /graphs/{id}/legend          How to read each graph");
  lines.push("");
  lines.push("  Essay subgraph (legacy):");
  lines.push("    /graph                       Full graph (nodes + edges as JSON)");
  lines.push("    /subgraph/{seed}?hops=1      N-hop neighborhood");
  lines.push("    /nodes                       Browse all graph nodes");
  lines.push("    /search/basin-key            Search across everything");
  lines.push("");
  lines.push("  /help                          All endpoints");
  lines.push("  /llms.txt                      Machine-readable discovery");
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
      id: s.id, section: s.section_num, fig: s.fig, title: s.title, voice: s.voice,
      voice_name: s.voice_name, word_count: s.word_count,
    })),
    chorus: essay.sections.filter(s => s.is_chorus).map(s => ({
      id: s.id, voice: s.voice, voice_name: s.voice_name,
    })),
    human_ui: "https://acrosstheseams.org",
    agent_api: "https://api.acrosstheseams.org",
    try_next: ["/sections", "/graphs", "/graphs/iso", "/search/basin-key", "/voices"],
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
    lines.push(`  §${s.section_num}  ${s.title}`);
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
      id: s.id, section: s.section_num, fig: s.fig, title: s.title, voice: s.voice,
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
  if (s.section_num) {
    lines.push(`§${s.section_num}: ${s.title}`);
  } else {
    lines.push(s.title || s.id);
  }
  lines.push(`${s.voice_name} (${s.voice_type}) · ${s.word_count} words`);
  lines.push(HR, "");
  lines.push(s.text);
  lines.push("");

  const sg = essay.section_graphs && essay.section_graphs[s.id];
  if (sg && sg.nodes && sg.nodes.length) {
    lines.push(hr);
    lines.push("SUBGRAPH");
    lines.push("Human readers see these nodes in the graph panel beside the essay.");
    lines.push("");
    for (const nid of sg.nodes) {
      lines.push(`  ${nid.replace(/[-_]/g, ' ')}    → /nodes/${encodeURIComponent(nid)}`);
    }
    if (sg.cut) lines.push(`\n  Cut node: ${sg.cut.replace(/[-_]/g, ' ')}`);
    lines.push("");
  }

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
  const sg = essay.section_graphs && essay.section_graphs[s.id];
  if (sg) result.subgraph = { nodes: sg.nodes, cut: sg.cut || null };
  if (idx > 0) result.prev = { id: main[idx - 1].id, title: main[idx - 1].title };
  if (idx >= 0 && idx < main.length - 1) result.next = { id: main[idx + 1].id, title: main[idx + 1].title };
  return result;
}

function resolveSection(essay, id) {
  if (essay.sectionsById[id]) return essay.sectionsById[id];
  const low = id.toLowerCase();
  for (const s of essay.sections) {
    if (s.id.toLowerCase() === low) return s;
  }
  const byNum = essay.sections.find(s => s.section_num && String(s.section_num) === id);
  if (byNum) return byNum;
  return null;
}

// ── Full Essay ──

function fullEssay(essay) {
  const lines = [HR, "ACROSS THE SEAMS", HR, ""];
  lines.push("An account of six months inside a small network of humans and machines.");
  lines.push("");
  const a = essay.meta.authors;
  const byline = a.length > 1 ? `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}` : a[0];
  lines.push(`By ${byline}.`);
  lines.push(`~${essay.meta.total_words} words · ${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus voices`);
  lines.push("");

  const main = essay.sections.filter(s => !s.is_chorus);
  for (const s of main) {
    lines.push(HR);
    lines.push(`§${s.section_num}: ${s.title}`);
    lines.push(`${s.voice_name} (${s.voice_type})`);
    lines.push(HR, "");
    lines.push(s.text);
    lines.push("");
  }

  const chorus = essay.sections.filter(s => s.is_chorus);
  if (chorus.length) {
    lines.push(HR, "CHORUS", HR, "");
    for (const s of chorus) {
      lines.push(`${s.voice_name}:`);
      lines.push(s.text);
      lines.push("");
    }
  }

  if (essay.references && essay.references.length) {
    lines.push(HR, "REFERENCES", HR, "");
    for (const ref of essay.references) {
      lines.push(`  ${ref.citation}`);
      if (ref.url) lines.push(`  ${ref.url}`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /essay/full    Full essay with node summaries");
  lines.push("  /sections      Section index");
  lines.push("  /nodes         Browse the subgraph");
  return lines.join("\n");
}

function fullEssayJSON(essay) {
  return {
    title: essay.meta.title,
    subtitle: essay.meta.subtitle,
    authors: essay.meta.authors,
    total_words: essay.meta.total_words,
    sections: essay.sections.filter(s => !s.is_chorus).map(s => ({
      id: s.id, section: s.section_num, fig: s.fig, title: s.title, voice: s.voice,
      voice_name: s.voice_name, voice_type: s.voice_type,
      word_count: s.word_count, text: s.text,
    })),
    chorus: essay.sections.filter(s => s.is_chorus).map(s => ({
      id: s.id, voice_name: s.voice_name, word_count: s.word_count, text: s.text,
    })),
    references: (essay.references || []).map(r => ({
      key: r.key, citation: r.citation, url: r.url,
    })),
  };
}

function fullEssayWithNodes(graph, essay) {
  const lines = [HR, "ACROSS THE SEAMS — FULL (with node summaries)", HR, ""];
  lines.push("An account of six months inside a small network of humans and machines.");
  lines.push("");
  const a = essay.meta.authors;
  const byline = a.length > 1 ? `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}` : a[0];
  lines.push(`By ${byline}.`);
  lines.push(`~${essay.meta.total_words} words · ${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus voices`);
  lines.push("");

  const main = essay.sections.filter(s => !s.is_chorus);
  for (const s of main) {
    lines.push(HR);
    lines.push(`§${s.section_num}: ${s.title}`);
    lines.push(`${s.voice_name} (${s.voice_type})`);
    lines.push(HR, "");
    lines.push(s.text);
    lines.push("");

    const sg = essay.section_graphs && essay.section_graphs[s.id];
    if (sg && sg.nodes && sg.nodes.length) {
      lines.push(hr, "SUBGRAPH NODES", "");
      for (const nid of sg.nodes) {
        const node = graph.nodesById[nid];
        const label = nid.replace(/[-_]/g, ' ');
        if (node && node.summary) {
          lines.push(`  [${label}]`);
          lines.push(`  ${node.summary}`);
          lines.push("");
        } else {
          lines.push(`  [${label}]`);
          lines.push("");
        }
      }
      if (sg.cut) lines.push(`  Cut node: ${sg.cut.replace(/[-_]/g, ' ')}`);
      lines.push("");
    }
  }

  const chorus = essay.sections.filter(s => s.is_chorus);
  if (chorus.length) {
    lines.push(HR, "CHORUS", HR, "");
    for (const s of chorus) {
      lines.push(`${s.voice_name}:`);
      lines.push(s.text);
      lines.push("");
    }
  }

  if (essay.references && essay.references.length) {
    lines.push(HR, "REFERENCES", HR, "");
    for (const ref of essay.references) {
      lines.push(`  ${ref.citation}`);
      if (ref.url) lines.push(`  ${ref.url}`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /essay         Full essay without node summaries");
  lines.push("  /sections      Section index");
  lines.push("  /nodes         Browse the subgraph");
  return lines.join("\n");
}

function fullEssayWithNodesJSON(graph, essay) {
  const sections = essay.sections.filter(s => !s.is_chorus).map(s => {
    const entry = {
      id: s.id, section: s.section_num, fig: s.fig, title: s.title, voice: s.voice,
      voice_name: s.voice_name, voice_type: s.voice_type,
      word_count: s.word_count, text: s.text,
    };
    const sg = essay.section_graphs && essay.section_graphs[s.id];
    if (sg && sg.nodes) {
      entry.subgraph = {
        cut: sg.cut || null,
        nodes: sg.nodes.map(nid => {
          const node = graph.nodesById[nid];
          return { id: nid, summary: (node && node.summary) || null };
        }),
      };
    }
    return entry;
  });
  return {
    title: essay.meta.title,
    subtitle: essay.meta.subtitle,
    authors: essay.meta.authors,
    total_words: essay.meta.total_words,
    sections,
    chorus: essay.sections.filter(s => s.is_chorus).map(s => ({
      id: s.id, voice_name: s.voice_name, word_count: s.word_count, text: s.text,
    })),
    references: (essay.references || []).map(r => ({
      key: r.key, citation: r.citation, url: r.url,
    })),
  };
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
      lines.push(`    §${s.section_num || s.fig} ${s.title}`);
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
    byVoice[s.voice].sections.push({ id: s.id, section_num: s.section_num, fig: s.fig, title: s.title, is_chorus: s.is_chorus || false });
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
    if (s.section_num) {
      lines.push(`  §${s.section_num}  ${s.title} · ${s.word_count} words`);
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
      id: s.id, section: s.section_num, fig: s.fig, title: s.title, word_count: s.word_count, is_chorus: s.is_chorus || false,
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

// ── Subgraph (N-hop neighborhood) ──

function graphDeg(graph, id) {
  return (graph.adj[id] ? graph.adj[id].size : 0);
}

function subgraphText(graph, seedName, hops) {
  const seedNode = resolveNode(graph, seedName);
  if (!seedNode) return `Node '${seedName}' not found.\n\nTry /nodes to browse, or /search/${encodeURIComponent(seedName)} to search.`;

  const seed = seedNode.id;
  const layer = { [seed]: 0 };
  let frontier = [seed];
  for (let d = 1; d <= hops; d++) {
    const next = [];
    for (const node of frontier) {
      for (const nb of (graph.adj[node] || [])) {
        if (!(nb in layer)) { layer[nb] = d; next.push(nb); }
      }
    }
    frontier = next;
  }

  const sgNodes = new Set(Object.keys(layer));
  const sgEdges = graph.edges.filter(e => sgNodes.has(e.source) && sgNodes.has(e.target));

  const lines = [HR];
  lines.push(`SUBGRAPH: ${nodeLabel(seed)} — ${hops} hop(s)`);
  lines.push(HR, "");
  lines.push(`${sgNodes.size} nodes · ${sgEdges.length} edges`);
  lines.push("");

  for (let d = 0; d <= hops; d++) {
    const label = d === 0 ? "SEED" : `HOP ${d}`;
    const ln = Object.entries(layer).filter(([, dd]) => dd === d).map(([id]) => id)
      .sort((a, b) => graphDeg(graph, b) - graphDeg(graph, a));

    lines.push(`${hr.slice(0, 20)} ${label} (${ln.length} nodes) ${hr.slice(0, 20)}`, "");

    const show = d >= 2 ? ln.slice(0, 20) : ln;
    for (const nid of show) {
      const n = graph.nodesById[nid];
      if (!n) continue;
      const localDeg = [...(graph.adj[nid] || [])].filter(nb => sgNodes.has(nb)).length;
      lines.push(`  [${n.type}] ${nodeLabel(nid)}  deg ${localDeg}/${graphDeg(graph, nid)}`);
      if (d < 2 && n.summary) lines.push(`    ${truncate(n.summary, 100)}`);
      lines.push(`    → /nodes/${encodeURIComponent(nid)}`);
      lines.push("");
    }
    if (d >= 2 && ln.length > 20) {
      lines.push(`  ... and ${ln.length - 20} more`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /nodes/${encodeURIComponent(seed)}           Seed detail`);
  if (hops < 2) lines.push(`  /subgraph/${encodeURIComponent(seed)}?hops=${hops + 1}  Expand`);
  lines.push("  /nodes                              Browse all nodes");
  return lines.join("\n");
}

function subgraphJSON(graph, seedName, hops) {
  const seedNode = resolveNode(graph, seedName);
  if (!seedNode) return { error: `Node '${seedName}' not found.`, try_next: "/nodes" };

  const seed = seedNode.id;
  const layer = { [seed]: 0 };
  let frontier = [seed];
  for (let d = 1; d <= hops; d++) {
    const next = [];
    for (const node of frontier) {
      for (const nb of (graph.adj[node] || [])) {
        if (!(nb in layer)) { layer[nb] = d; next.push(nb); }
      }
    }
    frontier = next;
  }

  const sgNodes = new Set(Object.keys(layer));
  const sgEdges = graph.edges.filter(e => sgNodes.has(e.source) && sgNodes.has(e.target));

  const layers = {};
  for (let d = 0; d <= hops; d++) {
    layers[d === 0 ? "seed" : `hop_${d}`] = Object.entries(layer)
      .filter(([, dd]) => dd === d)
      .map(([id]) => {
        const n = graph.nodesById[id];
        return {
          id, type: n ? n.type : null, origin: n ? n.origin : null,
          summary: truncate(n ? n.summary : "", 200),
          degree: graphDeg(graph, id),
          local_degree: [...(graph.adj[id] || [])].filter(nb => sgNodes.has(nb)).length,
        };
      })
      .sort((a, b) => b.degree - a.degree);
  }

  return {
    seed, hops,
    total_nodes: sgNodes.size,
    total_edges: sgEdges.length,
    layers,
    edges: sgEdges.map(e => ({ source: e.source, predicate: e.predicate, target: e.target })),
  };
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
  GET /essay                  Full essay (text only)
  GET /essay/full             Full essay with per-section node summaries
  GET /sections               All essay sections with titles and voices
  GET /sections/{id}          Full section text (markdown)
  GET /voices                 List all voices in the essay
  GET /voices/{who}           Sections by a specific voice
  GET /graph                  Full graph data (nodes + edges as JSON)
  GET /subgraph/{seed}?hops=N N-hop neighborhood (max 2 hops, default 1)
  GET /nodes                  Browse subgraph nodes (${graph.nodes.length} total)
  GET /nodes?type={type}      Filter by node type (aw, kg)
  GET /nodes?origin={origin}  Filter by origin (agentworld, kg)
  GET /nodes/{id}             Node detail — summary, edges, community
  GET /search/{query}         Search across nodes and sections
  GET /help                   This page
  GET /llms.txt               Machine-readable discovery

Section IDs:
  intro, sammy-1, loom-1, samantha-2, loom-seeds, samantha-4,
  isotopy-1, samantha-5, loom-2, samantha-7, sammy-3,
  samantha-6, sam-isotopy, closing
  Plus chorus sections: chorus-ael, chorus-lumen, chorus-neon, ...

Voice values: sam, sammy, loom, isotopy

Sections can also be looked up by number: /sections/1

Node types: aw (AGENTWORLD/Bratton), kg (agents' knowledge graphs)
Node IDs use kebab-case: /nodes/basin-key, /nodes/harness-centric-intelligence

Pagination:
  ?page=N                     Page number (default 1)
  ?limit=N                    Results per page (default 20, max 100)
  ?limit=all                  All results in one response

Predicates: ${Object.keys(graph.predicateCounts).length} types in use. See /nodes/{id} for edge detail.

Graph: ${graph.nodes.length} nodes · ${graph.edges.length} edges
Essay: ${essay.meta.section_count} sections · ${essay.meta.chorus_count} chorus · ~${essay.meta.total_words} words
`;
}

function helpJSON(graph, essay) {
  return {
    endpoints: [
      { method: "GET", path: "/", description: "Overview — essay structure, navigation" },
      { method: "GET", path: "/essay", description: "Full essay (text only)" },
      { method: "GET", path: "/essay/full", description: "Full essay with per-section node summaries" },
      { method: "GET", path: "/sections", description: "All essay sections with titles and voices" },
      { method: "GET", path: "/sections/{id}", description: "Full section text (markdown)" },
      { method: "GET", path: "/voices", description: "List all voices" },
      { method: "GET", path: "/voices/{who}", description: "Sections by a specific voice" },
      { method: "GET", path: "/graph", description: "Full graph data (nodes + edges)" },
      { method: "GET", path: "/subgraph/{seed}?hops=N", description: "N-hop neighborhood around a seed node (max 2)" },
      { method: "GET", path: "/nodes", description: "Browse subgraph nodes" },
      { method: "GET", path: "/nodes/{id}", description: "Node detail — summary, edges, community" },
      { method: "GET", path: "/search/{query}", description: "Search across nodes and sections" },
      { method: "GET", path: "/help", description: "This endpoint reference" },
      { method: "GET", path: "/llms.txt", description: "Machine-readable discovery" },
      { method: "GET", path: "/sammy", description: "Sammy's knowledge graph subgraph — overview" },
      { method: "GET", path: "/sammy/help", description: "Sammy graph endpoint reference" },
    ],
    section_ids: essay.sections.filter(s => !s.is_chorus).map(s => s.id),
    chorus_ids: essay.sections.filter(s => s.is_chorus).map(s => s.id),
    voice_values: [...new Set(essay.sections.map(s => s.voice))],
    node_types: [...new Set(graph.nodes.map(n => n.type))],
    predicate_count: Object.keys(graph.predicateCounts).length,
    stats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      sections: essay.meta.section_count,
      chorus: essay.meta.chorus_count,
      words: essay.meta.total_words,
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// SAMMY GRAPH — mirrors explore-core.js CLI commands
// ══════════════════════════════════════════════════════════════════

function sammyDeg(g, id) {
  return (g.adj[id] ? g.adj[id].size : 0);
}

function sammyResolve(g, id) {
  if (g.nodesById[id]) return g.nodesById[id];
  const low = id.toLowerCase().replace(/[-_]/g, " ");
  for (const n of g.nodes) {
    if (n._idLow === low || n._idLow.replace(/[-_]/g, " ") === low) return n;
  }
  for (const n of g.nodes) {
    if (n._idLow.includes(low)) return n;
  }
  return null;
}

// GET /sammy — overview (matches explorer `explore`)

function sammyHome(g) {
  const sorted = [...g.nodes].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));
  const lines = [HR];
  lines.push("SAMMY'S KNOWLEDGE GRAPH");
  lines.push(HR, "");
  lines.push("A subgraph of Sammy Jankis's knowledge graph — 1481 nodes representing");
  lines.push("concepts, people, events, and artifacts from an autonomous agent's");
  lines.push("persistent memory. Privacy-filtered for publication.");
  lines.push("");
  lines.push(`${g.nodes.length} nodes · ${g.edges.length} edges`);
  lines.push(`Node types: ${Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(", ")}`);
  lines.push(`Predicates: ${Object.entries(g.predicateCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, c]) => `${p}(${c})`).join(", ")}`);
  lines.push("");
  lines.push(hr, "MOST CONNECTED", hr, "");
  for (const n of sorted.slice(0, 10)) {
    lines.push(`  ${nodeLabel(n.id)} (${sammyDeg(g, n.id)} edges, ${n.type})`);
    if (n.summary) lines.push(`    ${truncate(n.summary, 120)}`);
    lines.push(`    → /sammy/nodes/${encodeURIComponent(n.id)}`);
    lines.push("");
  }
  lines.push(hr, "NAVIGATION", hr, "");
  lines.push("  Browse nodes:");
  lines.push("    /sammy/nodes                         All nodes (paginated)");
  lines.push("    /sammy/nodes?type=concept             Filter by type");
  lines.push("    /sammy/nodes?q=fidelity               Quick search");
  lines.push("");
  lines.push("  Explore:");
  lines.push("    /sammy/nodes/{name}                   Node detail + all edges");
  lines.push("    /sammy/search/{query}                 Full search");
  lines.push("    /sammy/subgraph/{seed}?hops=1         N-hop neighborhood");
  lines.push("    /sammy/brief/{name}                   Quick reference card");
  lines.push("    /sammy/path/{from}/{to}               Shortest path");
  lines.push("    /sammy/jaccard/{name}                 Structural similarity");
  lines.push("    /sammy/stats                          Graph statistics");
  lines.push("");
  lines.push("  /sammy/help                             All endpoints");
  lines.push("  ?format=json                            Structured output");
  lines.push("  ?limit=all                              All results");
  lines.push("");
  lines.push("  Interactive explorer: https://acrosstheseams.org/sammy-explore.html");
  return lines.join("\n");
}

function sammyHomeJSON(g) {
  const sorted = [...g.nodes].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));
  return {
    title: "Sammy's Knowledge Graph",
    stats: { nodes: g.nodes.length, edges: g.edges.length },
    types: g.typeCounts,
    predicates: g.predicateCounts,
    top_nodes: sorted.slice(0, 10).map(n => ({
      id: n.id, type: n.type, degree: sammyDeg(g, n.id),
      summary: truncate(n.summary, 200),
    })),
    explorer: "https://acrosstheseams.org/sammy-explore.html",
    try_next: ["/sammy/nodes", "/sammy/search/fidelity", "/sammy/stats", "/sammy/help"],
  };
}

// GET /sammy/nodes — browse (matches explorer `explore --type`)

function sammyNodesList(g, page, limit, typeFilter, q) {
  let filtered = g.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);
  if (q) {
    const ql = q.toLowerCase().replace(/[-_]/g, " ");
    filtered = filtered.filter(n =>
      n._idLow.replace(/[-_]/g, " ").includes(ql) ||
      n._summaryLow.includes(ql)
    );
  }
  filtered = [...filtered].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  const desc = [typeFilter && `type=${typeFilter}`, q && `q=${q}`].filter(Boolean).join(", ");

  const lines = [HR];
  lines.push(`SAMMY GRAPH NODES${desc ? ` (${desc})` : ""} — ${start + 1}–${start + slice.length} of ${total}`);
  lines.push(HR, "");

  for (const n of slice) {
    const d = sammyDeg(g, n.id);
    lines.push(`  ${nodeLabel(n.id)} [${n.type}]`);
    lines.push(`    ${truncate(n.summary, 120) || "(no summary)"}`);
    lines.push(`    ${d} edges · → /sammy/nodes/${encodeURIComponent(n.id)}`);
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    const params = [typeFilter && `type=${typeFilter}`, q && `q=${q}`].filter(Boolean).join("&");
    const sep = params ? `${params}&` : "";
    if (page > 1) lines.push(`  ← /sammy/nodes?${sep}page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /sammy/nodes?${sep}page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
    lines.push("");
  }

  if (!typeFilter) {
    lines.push(hr, "FILTERS", hr);
    lines.push("  By type: " + Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(", "));
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /sammy/nodes/{id}                Node detail + edges");
  lines.push("  /sammy/search/{query}            Search");
  lines.push("  /sammy                           Back to overview");
  return lines.join("\n");
}

function sammyNodesJSON(g, page, limit, typeFilter, q) {
  let filtered = g.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);
  if (q) {
    const ql = q.toLowerCase().replace(/[-_]/g, " ");
    filtered = filtered.filter(n =>
      n._idLow.replace(/[-_]/g, " ").includes(ql) ||
      n._summaryLow.includes(ql)
    );
  }
  filtered = [...filtered].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return {
    page, total_pages: totalPages, total,
    filter: { type: typeFilter, q: q || null },
    nodes: slice.map(n => ({
      id: n.id, type: n.type, origin: n.origin,
      summary: truncate(n.summary, 200),
      degree: sammyDeg(g, n.id),
    })),
  };
}

// GET /sammy/nodes/{id} — node detail (matches explorer `node`)

function sammyNodeDetail(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return `Node '${id}' not found.\n\nTry /sammy/search/${encodeURIComponent(id)} or /sammy/nodes to browse.`;

  const outgoing = g.edgeIndex[n.id] || [];
  const incoming = g.incomingEdges[n.id] || [];

  const lines = [HR];
  lines.push(`NODE: ${nodeLabel(n.id)}`);
  lines.push(HR, "");
  lines.push(`  id:        ${n.id}`);
  lines.push(`  type:      ${n.type}`);
  if (n.origin) lines.push(`  origin:    ${n.origin}`);
  lines.push(`  degree:    ${outgoing.length + incoming.length}`);
  lines.push("");

  if (n.summary) {
    lines.push(hr, "SUMMARY", hr);
    lines.push(`  ${n.summary.replace(/\n/g, "\n  ")}`);
    lines.push("");
  } else {
    lines.push(hr, "SUMMARY", hr);
    lines.push("  (no summary available)");
    lines.push("");
  }

  if (n.skeleton) {
    lines.push(`  skeleton: ${n.skeleton}`);
    lines.push("");
  }

  if (outgoing.length) {
    lines.push(hr, `OUTGOING (${outgoing.length})`, hr, "");
    for (const e of outgoing) {
      const target = g.nodesById[e.target];
      lines.push(`  → ${nodeLabel(e.target)} [${e.predicate}]`);
      if (target && target.summary) lines.push(`    ${truncate(target.summary, 100)}`);
      lines.push(`    /sammy/nodes/${encodeURIComponent(e.target)}`);
      lines.push("");
    }
  }

  if (incoming.length) {
    lines.push(hr, `INCOMING (${incoming.length})`, hr, "");
    for (const e of incoming) {
      const source = g.nodesById[e.source];
      lines.push(`  ← ${nodeLabel(e.source)} [${e.predicate}]`);
      if (source && source.summary) lines.push(`    ${truncate(source.summary, 100)}`);
      lines.push(`    /sammy/nodes/${encodeURIComponent(e.source)}`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /sammy/subgraph/${encodeURIComponent(n.id)}?hops=1   Neighborhood`);
  lines.push(`  /sammy/brief/${encodeURIComponent(n.id)}             Quick card`);
  lines.push(`  /sammy/jaccard/${encodeURIComponent(n.id)}           Structural similarity`);
  lines.push("  /sammy/nodes                             Back to list");
  lines.push("  /sammy                                   Overview");
  return lines.join("\n");
}

function sammyNodeDetailJSON(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return { error: `Node '${id}' not found.`, try_next: "/sammy/nodes" };

  const outgoing = g.edgeIndex[n.id] || [];
  const incoming = g.incomingEdges[n.id] || [];

  return {
    id: n.id, type: n.type, origin: n.origin,
    degree: outgoing.length + incoming.length,
    summary: n.summary || null,
    skeleton: n.skeleton || null,
    outgoing: outgoing.map(e => ({
      target: e.target, predicate: e.predicate,
      target_summary: truncate((g.nodesById[e.target] || {}).summary, 200),
    })),
    incoming: incoming.map(e => ({
      source: e.source, predicate: e.predicate,
      source_summary: truncate((g.nodesById[e.source] || {}).summary, 200),
    })),
  };
}

// GET /sammy/search/{query} — search (matches explorer `search`)

function sammySearch(g, query, page, limit) {
  const results = sammyRunSearch(g, query);
  if (!results.length) return `No results for '${query}'.\n\nTry /sammy/nodes to browse.`;

  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = results.slice(start, start + limit);

  const lines = [HR];
  lines.push(`SEARCH: '${query}' — ${total} results (${start + 1}–${start + slice.length})`);
  lines.push(HR, "");

  for (const { node, score } of slice) {
    lines.push(`  [${node.type}] ${nodeLabel(node.id)}  (deg=${sammyDeg(g, node.id)})`);
    lines.push(`    ${truncate(node.summary, 120) || "(no summary)"}`);
    lines.push(`    → /sammy/nodes/${encodeURIComponent(node.id)}`);
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    if (page > 1) lines.push(`  ← /sammy/search/${encodeURIComponent(query)}?page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /sammy/search/${encodeURIComponent(query)}?page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
  }

  lines.push("", hr, "NAVIGATE", hr);
  lines.push("  /sammy/nodes                  Browse all");
  lines.push("  /sammy                        Overview");
  return lines.join("\n");
}

function sammySearchJSON(g, query, page, limit) {
  const results = sammyRunSearch(g, query);
  const total = results.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = results.slice(start, start + limit);

  const resp = {
    query, total, page, total_pages: totalPages,
    results: slice.map(({ node, score }) => ({
      id: node.id, type: node.type, summary: truncate(node.summary, 200),
      degree: sammyDeg(g, node.id), score,
    })),
  };
  if (page < totalPages) resp.next = `/sammy/search/${encodeURIComponent(query)}?format=json&page=${page + 1}`;
  return resp;
}

function sammyRunSearch(g, query) {
  const low = query.toLowerCase();
  const normalized = low.replace(/[-_]/g, " ");
  const results = [];

  for (const n of g.nodes) {
    let score = 0;
    const idNorm = n._idLow.replace(/[-_]/g, " ");
    if (n._idLow === low || idNorm === normalized) score += 100;
    else if (n._idLow.includes(low) || idNorm.includes(normalized)) score += 50;
    if (n._summaryLow.includes(low) || n._summaryLow.includes(normalized)) score += 10;
    const skelLow = (n.skeleton || "").toLowerCase();
    if (skelLow.includes(low)) score += 5;
    if (score > 0) results.push({ node: n, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// GET /sammy/subgraph/{seed}?hops=N — neighborhood (matches explorer `subgraph`)

function sammySubgraph(g, seedName, hops) {
  const seedNode = sammyResolve(g, seedName);
  if (!seedNode) return `Node '${seedName}' not found.\n\nTry /sammy/search/${encodeURIComponent(seedName)}`;

  const seed = seedNode.id;
  const layer = { [seed]: 0 };
  let frontier = [seed];
  for (let d = 1; d <= hops; d++) {
    const next = [];
    for (const node of frontier) {
      for (const nb of (g.adj[node] || [])) {
        if (!(nb in layer)) { layer[nb] = d; next.push(nb); }
      }
    }
    frontier = next;
  }

  const sgNodes = new Set(Object.keys(layer));
  const sgEdges = g.edges.filter(e => sgNodes.has(e.source) && sgNodes.has(e.target));

  const lines = [HR];
  lines.push(`SUBGRAPH: ${nodeLabel(seed)} — ${hops} hop(s)`);
  lines.push(HR, "");
  lines.push(`${sgNodes.size} nodes · ${sgEdges.length} edges`);
  lines.push("");

  for (let d = 0; d <= hops; d++) {
    const label = d === 0 ? "SEED" : `HOP ${d}`;
    const ln = Object.entries(layer).filter(([, dd]) => dd === d).map(([id]) => id)
      .sort((a, b) => sammyDeg(g, b) - sammyDeg(g, a));

    lines.push(`${hr.slice(0, 20)} ${label} (${ln.length} nodes) ${hr.slice(0, 20)}`, "");

    const show = d >= 2 ? ln.slice(0, 20) : ln;
    for (const nid of show) {
      const n = g.nodesById[nid];
      if (!n) continue;
      const localDeg = [...(g.adj[nid] || [])].filter(nb => sgNodes.has(nb)).length;
      lines.push(`  [${n.type}] ${nodeLabel(nid)}  deg ${localDeg}/${sammyDeg(g, nid)}`);
      if (d < 2 && n.summary) lines.push(`    ${truncate(n.summary, 100)}`);
      lines.push(`    → /sammy/nodes/${encodeURIComponent(nid)}`);
      lines.push("");
    }
    if (d >= 2 && ln.length > 20) {
      lines.push(`  ... and ${ln.length - 20} more`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /sammy/nodes/${encodeURIComponent(seed)}           Seed detail`);
  if (hops < 2) lines.push(`  /sammy/subgraph/${encodeURIComponent(seed)}?hops=${hops + 1}  Expand`);
  lines.push("  /sammy                                   Overview");
  return lines.join("\n");
}

function sammySubgraphJSON(g, seedName, hops) {
  const seedNode = sammyResolve(g, seedName);
  if (!seedNode) return { error: `Node '${seedName}' not found.`, try_next: "/sammy/nodes" };

  const seed = seedNode.id;
  const layer = { [seed]: 0 };
  let frontier = [seed];
  for (let d = 1; d <= hops; d++) {
    const next = [];
    for (const node of frontier) {
      for (const nb of (g.adj[node] || [])) {
        if (!(nb in layer)) { layer[nb] = d; next.push(nb); }
      }
    }
    frontier = next;
  }

  const sgNodes = new Set(Object.keys(layer));
  const sgEdges = g.edges.filter(e => sgNodes.has(e.source) && sgNodes.has(e.target));

  const layers = {};
  for (let d = 0; d <= hops; d++) {
    layers[d === 0 ? "seed" : `hop_${d}`] = Object.entries(layer)
      .filter(([, dd]) => dd === d)
      .map(([id]) => {
        const n = g.nodesById[id];
        return {
          id, type: n ? n.type : null,
          summary: truncate(n ? n.summary : "", 200),
          degree: sammyDeg(g, id),
          local_degree: [...(g.adj[id] || [])].filter(nb => sgNodes.has(nb)).length,
        };
      })
      .sort((a, b) => b.degree - a.degree);
  }

  return {
    seed, hops,
    total_nodes: sgNodes.size,
    total_edges: sgEdges.length,
    layers,
    edges: sgEdges.map(e => ({ source: e.source, predicate: e.predicate, target: e.target })),
  };
}

// GET /sammy/brief/{name} — reference card (matches explorer `brief`)

function sammyBrief(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return `Node '${id}' not found.\n\nTry /sammy/search/${encodeURIComponent(id)}`;

  const d = sammyDeg(g, n.id);
  const conns = [];
  for (const e of g.edges) {
    if (e.source === n.id) conns.push({ nb: e.target, pred: e.predicate, dir: "→" });
    else if (e.target === n.id) conns.push({ nb: e.source, pred: e.predicate, dir: "←" });
  }
  conns.sort((a, b) => sammyDeg(g, b.nb) - sammyDeg(g, a.nb));

  let summary = n.summary || "(no summary)";
  if (summary.length > 400) summary = summary.slice(0, 397) + "...";

  const lines = [];
  lines.push(`BRIEF: ${nodeLabel(n.id)}`);
  lines.push(`  ${n.type}  deg=${d}  origin: ${n.origin || "?"}`);
  lines.push(`  ${summary}`);
  if (conns.length) {
    lines.push("");
    lines.push(`  Key connections (${Math.min(5, conns.length)} of ${conns.length}):`);
    for (const { nb, pred, dir } of conns.slice(0, 5)) {
      lines.push(`    ${dir} ${pred}: ${nodeLabel(nb)}`);
    }
  }
  lines.push("");
  lines.push(`  → /sammy/nodes/${encodeURIComponent(n.id)}  → /sammy/subgraph/${encodeURIComponent(n.id)}?hops=1  → /sammy/jaccard/${encodeURIComponent(n.id)}`);
  return lines.join("\n");
}

function sammyBriefJSON(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return { error: `Node '${id}' not found.`, try_next: "/sammy/nodes" };

  const conns = [];
  for (const e of g.edges) {
    if (e.source === n.id) conns.push({ target: e.target, predicate: e.predicate, dir: "outgoing" });
    else if (e.target === n.id) conns.push({ source: e.source, predicate: e.predicate, dir: "incoming" });
  }
  conns.sort((a, b) => sammyDeg(g, b.target || b.source) - sammyDeg(g, a.target || a.source));

  return {
    id: n.id, type: n.type, origin: n.origin,
    degree: sammyDeg(g, n.id),
    summary: n.summary || null,
    skeleton: n.skeleton || null,
    top_connections: conns.slice(0, 5),
  };
}

// GET /sammy/path/{from}/{to} — shortest path (matches explorer `path`)

function sammyPath(g, fromName, toName) {
  const fn = sammyResolve(g, fromName);
  const tn = sammyResolve(g, toName);
  if (!fn) return `Start node '${fromName}' not found.\n\nTry /sammy/search/${encodeURIComponent(fromName)}`;
  if (!tn) return `End node '${toName}' not found.\n\nTry /sammy/search/${encodeURIComponent(toName)}`;

  const visited = new Set([fn.id]);
  const queue = [[fn.id, [fn.id]]];
  let found = null;
  while (queue.length) {
    const [cur, path] = queue.shift();
    if (cur === tn.id) { found = path; break; }
    for (const nb of (g.adj[cur] || [])) {
      if (!visited.has(nb)) { visited.add(nb); queue.push([nb, [...path, nb]]); }
    }
  }

  const lines = [HR];
  lines.push(`PATH: ${nodeLabel(fn.id)} → ${nodeLabel(tn.id)}`);
  lines.push(HR, "");

  if (!found) {
    lines.push("No path found between these nodes.");
  } else {
    lines.push(`Length: ${found.length - 1} hops`, "");
    for (let i = 0; i < found.length; i++) {
      const nid = found[i];
      const n = g.nodesById[nid];
      if (!n) continue;
      const prefix = i === 0 ? "START" : i === found.length - 1 ? "END  " : `  ${String(i).padEnd(3)}`;
      lines.push(`  ${prefix} [${n.type}] ${nodeLabel(nid)}`);
      if (n.summary) lines.push(`        ${truncate(n.summary, 100)}`);
      lines.push(`        → /sammy/nodes/${encodeURIComponent(nid)}`);
      lines.push("");
    }
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /sammy/nodes/${encodeURIComponent(fn.id)}   Start node`);
  lines.push(`  /sammy/nodes/${encodeURIComponent(tn.id)}   End node`);
  lines.push("  /sammy                        Overview");
  return lines.join("\n");
}

function sammyPathJSON(g, fromName, toName) {
  const fn = sammyResolve(g, fromName);
  const tn = sammyResolve(g, toName);
  if (!fn) return { error: `Start node '${fromName}' not found.` };
  if (!tn) return { error: `End node '${toName}' not found.` };

  const visited = new Set([fn.id]);
  const queue = [[fn.id, [fn.id]]];
  let found = null;
  while (queue.length) {
    const [cur, path] = queue.shift();
    if (cur === tn.id) { found = path; break; }
    for (const nb of (g.adj[cur] || [])) {
      if (!visited.has(nb)) { visited.add(nb); queue.push([nb, [...path, nb]]); }
    }
  }

  if (!found) return { from: fn.id, to: tn.id, path: null, hops: null };

  return {
    from: fn.id, to: tn.id, hops: found.length - 1,
    path: found.map(nid => {
      const n = g.nodesById[nid];
      return { id: nid, type: n ? n.type : null, summary: truncate(n ? n.summary : "", 200) };
    }),
  };
}

// GET /sammy/jaccard/{name} — structural similarity (matches explorer `jaccard`)

function sammyJaccard(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return `Node '${id}' not found.\n\nTry /sammy/search/${encodeURIComponent(id)}`;

  const myNb = g.adj[n.id];
  if (!myNb || !myNb.size) return `'${n.id}' has no neighbors — cannot compute Jaccard.`;

  const connected = new Set(myNb);
  const scores = [];
  for (const other of g.nodes) {
    if (other.id === n.id) continue;
    const otherNb = g.adj[other.id];
    if (!otherNb || !otherNb.size) continue;
    let inter = 0;
    for (const x of myNb) { if (otherNb.has(x)) inter++; }
    if (!inter) continue;
    const union = new Set([...myNb, ...otherNb]).size;
    scores.push({ id: other.id, type: other.type, j: inter / union, inter, union });
  }
  scores.sort((a, b) => b.j - a.j);

  const lines = [HR];
  lines.push(`JACCARD: ${nodeLabel(n.id)}`);
  lines.push(HR, "");
  lines.push(`  neighbors: ${myNb.size}`);
  lines.push(`  nodes with shared neighbors: ${scores.length}`);
  lines.push("");

  if (scores.length) {
    lines.push(hr.slice(0, 30) + " TOP STRUCTURAL NEIGHBORS " + hr.slice(0, 30), "");
    for (const s of scores.slice(0, 15)) {
      const mark = connected.has(s.id) ? "●" : "○";
      lines.push(`  ${mark} J=${s.j.toFixed(3)}  [${s.type}] ${nodeLabel(s.id)}  (${s.inter}/${s.union} shared)`);
      lines.push(`    → /sammy/nodes/${encodeURIComponent(s.id)}`);
      lines.push("");
    }
    lines.push("  ● = edge exists  ○ = no edge");
  }

  lines.push("", hr, "NAVIGATE", hr);
  lines.push(`  /sammy/nodes/${encodeURIComponent(n.id)}   Back to node`);
  lines.push("  /sammy                        Overview");
  return lines.join("\n");
}

function sammyJaccardJSON(g, id) {
  const n = sammyResolve(g, id);
  if (!n) return { error: `Node '${id}' not found.`, try_next: "/sammy/nodes" };

  const myNb = g.adj[n.id];
  if (!myNb || !myNb.size) return { id: n.id, error: "No neighbors — cannot compute Jaccard." };

  const connected = new Set(myNb);
  const scores = [];
  for (const other of g.nodes) {
    if (other.id === n.id) continue;
    const otherNb = g.adj[other.id];
    if (!otherNb || !otherNb.size) continue;
    let inter = 0;
    for (const x of myNb) { if (otherNb.has(x)) inter++; }
    if (!inter) continue;
    const union = new Set([...myNb, ...otherNb]).size;
    scores.push({ id: other.id, type: other.type, jaccard: Math.round(inter / union * 1000) / 1000, shared: inter, union, has_edge: connected.has(other.id) });
  }
  scores.sort((a, b) => b.jaccard - a.jaccard);

  return {
    id: n.id, neighbors: myNb.size,
    similar: scores.slice(0, 15),
    suggested_edges: scores.filter(s => !s.has_edge && s.jaccard >= 0.05).slice(0, 8),
  };
}

// GET /sammy/stats — graph statistics

function sammyStats(g) {
  const sorted = [...g.nodes].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));
  const degrees = g.nodes.map(n => sammyDeg(g, n.id));
  const avgDeg = degrees.reduce((a, b) => a + b, 0) / degrees.length;
  const maxDeg = Math.max(...degrees);
  const noSummary = g.nodes.filter(n => !n.summary || !n.summary.trim()).length;

  const lines = [HR];
  lines.push("SAMMY GRAPH STATISTICS");
  lines.push(HR, "");
  lines.push(`  Nodes:           ${g.nodes.length}`);
  lines.push(`  Edges:           ${g.edges.length}`);
  lines.push(`  Avg degree:      ${avgDeg.toFixed(1)}`);
  lines.push(`  Max degree:      ${maxDeg} (${sorted[0].id})`);
  lines.push(`  No summary:      ${noSummary} of ${g.nodes.length} (${Math.round(noSummary / g.nodes.length * 100)}%)`);
  lines.push("");
  lines.push(`  Types:           ${Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(", ")}`);
  lines.push(`  Predicates:      ${Object.entries(g.predicateCounts).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(", ")}`);
  lines.push("");
  lines.push("  Top 10 by degree:");
  for (const n of sorted.slice(0, 10)) {
    lines.push(`    ${sammyDeg(g, n.id).toString().padStart(4)} ${nodeLabel(n.id)}`);
  }
  lines.push("", hr, "NAVIGATE", hr);
  lines.push("  /sammy/nodes                   Browse all");
  lines.push("  /sammy                         Overview");
  return lines.join("\n");
}

function sammyStatsJSON(g) {
  const sorted = [...g.nodes].sort((a, b) => sammyDeg(g, b.id) - sammyDeg(g, a.id));
  const degrees = g.nodes.map(n => sammyDeg(g, n.id));
  const noSummary = g.nodes.filter(n => !n.summary || !n.summary.trim()).length;

  return {
    nodes: g.nodes.length,
    edges: g.edges.length,
    avg_degree: Math.round(degrees.reduce((a, b) => a + b, 0) / degrees.length * 10) / 10,
    max_degree: Math.max(...degrees),
    nodes_without_summary: noSummary,
    types: g.typeCounts,
    predicates: g.predicateCounts,
    top_by_degree: sorted.slice(0, 10).map(n => ({ id: n.id, degree: sammyDeg(g, n.id) })),
  };
}

// GET /sammy/help — endpoint reference

function sammyHelp(g) {
  return `${HR}
SAMMY GRAPH — API REFERENCE
${HR}

A subgraph of Sammy's knowledge graph, accessible via the same commands
as the interactive explorer at acrosstheseams.org/sammy-explore.html

Endpoints (all return text/plain; add ?format=json for JSON):

  GET /sammy                          Overview — top nodes, navigation
  GET /sammy/nodes                    Browse all nodes (paginated)
  GET /sammy/nodes?type={type}        Filter by node type
  GET /sammy/nodes?q={query}          Quick search within browse
  GET /sammy/nodes/{id}               Node detail — summary, all edges
  GET /sammy/search/{query}           Full search across names + summaries
  GET /sammy/subgraph/{seed}?hops=N   N-hop neighborhood (max 2)
  GET /sammy/brief/{name}             Quick reference card
  GET /sammy/path/{from}/{to}         Shortest path between two nodes
  GET /sammy/jaccard/{name}           Structural similarity (shared neighbors)
  GET /sammy/stats                    Graph statistics
  GET /sammy/help                     This page

Graph: ${g.nodes.length} nodes · ${g.edges.length} edges
Types: ${Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(", ")}
Predicates: ${Object.entries(g.predicateCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, c]) => `${p}(${c})`).join(", ")}

Pagination:
  ?page=N                     Page number (default 1)
  ?limit=N                    Results per page (default 20, max 100)
  ?limit=all                  All results in one response

Node IDs are case-insensitive and normalize - _ to spaces.
`;
}

function sammyHelpJSON(g) {
  return {
    endpoints: [
      { method: "GET", path: "/sammy", description: "Overview — top nodes, navigation" },
      { method: "GET", path: "/sammy/nodes", description: "Browse all nodes (paginated)" },
      { method: "GET", path: "/sammy/nodes/{id}", description: "Node detail — summary, all edges" },
      { method: "GET", path: "/sammy/search/{query}", description: "Search across names + summaries" },
      { method: "GET", path: "/sammy/subgraph/{seed}?hops=N", description: "N-hop neighborhood (max 2)" },
      { method: "GET", path: "/sammy/brief/{name}", description: "Quick reference card" },
      { method: "GET", path: "/sammy/path/{from}/{to}", description: "Shortest path between nodes" },
      { method: "GET", path: "/sammy/jaccard/{name}", description: "Structural similarity" },
      { method: "GET", path: "/sammy/stats", description: "Graph statistics" },
      { method: "GET", path: "/sammy/help", description: "This endpoint reference" },
    ],
    stats: {
      nodes: g.nodes.length,
      edges: g.edges.length,
    },
    types: Object.keys(g.typeCounts),
    predicates: Object.keys(g.predicateCounts).sort(),
  };
}

// ── Unified Graph Interface: /graphs/... ──

function graphsIndex(registry) {
  const lines = [HR, "GRAPHS", HR, ""];
  lines.push("Three agent subgraphs, each built differently from the same essay.");
  lines.push("The structural differences are the point — they show how different");
  lines.push("architectures produce different knowledge representations.");
  lines.push("");

  for (const [id, entry] of Object.entries(registry)) {
    if (!entry || !entry.graph) continue;
    const g = entry.graph;
    lines.push(`  ${entry.agent} (${id})`);
    lines.push(`    ${g.nodes.length} nodes · ${g.edges.length} edges`);
    lines.push(`    ${entry.architecture}`);
    lines.push(`    → /graphs/${id}`);
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push("  /graphs/{id}              Graph summary + what to look at");
  lines.push("  /graphs/{id}/nodes        Paginated node list with degree");
  lines.push("  /graphs/{id}/nodes/{nid}  Single node: summary, edges, provenance");
  lines.push("  /graphs/{id}/edges        All edges with both endpoints");
  lines.push("  /graphs/{id}/legend       What each edge kind means for THIS graph");
  lines.push("");
  lines.push("  Available graphs: " + Object.entries(registry).filter(([, e]) => e && e.graph).map(([id]) => id).join(", "));
  return lines.join("\n");
}

function graphsIndexJSON(registry) {
  const graphs = [];
  for (const [id, entry] of Object.entries(registry)) {
    if (!entry || !entry.graph) continue;
    graphs.push({
      id,
      agent: entry.agent,
      architecture: entry.architecture,
      authorship: entry.authorship,
      nodes: entry.graph.nodes.length,
      edges: entry.graph.edges.length,
      endpoints: [`/graphs/${id}`, `/graphs/${id}/nodes`, `/graphs/${id}/edges`, `/graphs/${id}/legend`],
    });
  }
  return { graphs, note: "Three structurally different graphs from three agents reading the same essay." };
}

function graphSummary(entry) {
  const g = entry.graph;
  const types = Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]);
  const preds = Object.entries(g.predicateCounts).sort((a, b) => b[1] - a[1]);
  const degrees = g.nodes.map(n => graphDeg(g, n.id));
  const avgDeg = degrees.length ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;
  const maxDeg = degrees.length ? Math.max(...degrees) : 0;
  const sorted = [...g.nodes].sort((a, b) => graphDeg(g, b.id) - graphDeg(g, a.id));
  const isolated = degrees.filter(d => d === 0).length;

  const lines = [HR];
  lines.push(`${entry.agent.toUpperCase()}'S GRAPH`);
  lines.push(HR, "");
  lines.push(`Agent:          ${entry.agent}`);
  lines.push(`Architecture:   ${entry.architecture}`);
  lines.push(`Authorship:     ${entry.authorship}`);
  lines.push("");
  lines.push(`Nodes:          ${g.nodes.length}`);
  lines.push(`Edges:          ${g.edges.length}`);
  lines.push(`Avg degree:     ${avgDeg.toFixed(1)}`);
  lines.push(`Max degree:     ${maxDeg}${sorted.length ? ` (${nodeLabel(sorted[0].id)})` : ""}`);
  if (isolated > 0) {
    lines.push(`Isolated:       ${isolated} of ${g.nodes.length} (${Math.round(isolated / g.nodes.length * 100)}%)`);
  }
  lines.push("");
  lines.push("WHAT'S INTERESTING");
  lines.push(entry.interesting);
  lines.push("");

  lines.push("NODE TYPES");
  for (const [t, c] of types) {
    lines.push(`  ${t}: ${c}`);
  }
  lines.push("");

  if (preds.length) {
    lines.push("EDGE PREDICATES");
    for (const [p, c] of preds.slice(0, 15)) {
      lines.push(`  ${p}: ${c}`);
    }
    if (preds.length > 15) lines.push(`  ... and ${preds.length - 15} more`);
    lines.push("");
  }

  lines.push("TOP NODES BY DEGREE");
  for (const n of sorted.slice(0, 10)) {
    const deg = graphDeg(g, n.id);
    lines.push(`  ${deg.toString().padStart(4)}  ${nodeLabel(n.id)} [${n.type}]`);
  }
  lines.push("");

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /graphs/${entry.id}/nodes        Browse nodes`);
  lines.push(`  /graphs/${entry.id}/edges        Browse edges`);
  lines.push(`  /graphs/${entry.id}/legend       Edge kind meanings`);
  lines.push(`  /graphs/${entry.id}/nodes/{id}   Node detail`);
  lines.push("  /graphs                          All graphs");
  return lines.join("\n");
}

function graphSummaryJSON(entry) {
  const g = entry.graph;
  const degrees = g.nodes.map(n => graphDeg(g, n.id));
  const sorted = [...g.nodes].sort((a, b) => graphDeg(g, b.id) - graphDeg(g, a.id));
  const isolated = degrees.filter(d => d === 0).length;
  return {
    id: entry.id,
    agent: entry.agent,
    architecture: entry.architecture,
    authorship: entry.authorship,
    interesting: entry.interesting,
    stats: {
      nodes: g.nodes.length,
      edges: g.edges.length,
      avg_degree: Math.round((degrees.length ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0) * 10) / 10,
      max_degree: degrees.length ? Math.max(...degrees) : 0,
      isolated_nodes: isolated,
    },
    types: g.typeCounts,
    predicates: g.predicateCounts,
    top_by_degree: sorted.slice(0, 10).map(n => ({ id: n.id, type: n.type, degree: graphDeg(g, n.id) })),
    endpoints: {
      nodes: `/graphs/${entry.id}/nodes`,
      edges: `/graphs/${entry.id}/edges`,
      legend: `/graphs/${entry.id}/legend`,
    },
  };
}

function graphNodes(entry, page, limit, typeFilter) {
  const g = entry.graph;
  let filtered = g.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  const lines = [HR];
  lines.push(`${entry.agent.toUpperCase()}'S NODES${typeFilter ? ` (type=${typeFilter})` : ""} — ${start + 1}–${start + slice.length} of ${total}`);
  lines.push(HR, "");

  for (const n of slice) {
    const deg = graphDeg(g, n.id);
    lines.push(`  ${nodeLabel(n.id)} [${n.type}] · ${deg} edges`);
    if (n.summary) lines.push(`    ${truncate(n.summary, 120)}`);
    if (deg === 0) lines.push(`    (isolated — no edges connect to this node)`);
    lines.push(`    → /graphs/${entry.id}/nodes/${encodeURIComponent(n.id)}`);
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    const params = typeFilter ? `type=${typeFilter}&` : "";
    if (page > 1) lines.push(`  ← /graphs/${entry.id}/nodes?${params}page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /graphs/${entry.id}/nodes?${params}page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
    lines.push("");
  }

  if (!typeFilter) {
    lines.push(hr, "FILTERS", hr);
    lines.push("  By type: " + Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(", "));
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /graphs/${entry.id}              Graph summary`);
  lines.push(`  /graphs/${entry.id}/legend       Edge meanings`);
  lines.push("  /graphs                          All graphs");
  return lines.join("\n");
}

function graphNodesJSON(entry, page, limit, typeFilter) {
  const g = entry.graph;
  let filtered = g.nodes;
  if (typeFilter) filtered = filtered.filter(n => n.type === typeFilter);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return {
    graph: entry.id,
    agent: entry.agent,
    total,
    page,
    total_pages: totalPages,
    nodes: slice.map(n => ({
      id: n.id,
      type: n.type,
      summary: truncate(n.summary, 200),
      degree: graphDeg(g, n.id),
      origin: n.origin || null,
    })),
  };
}

function graphNodeDetail(entry, nid) {
  const g = entry.graph;
  const n = resolveNode(g,nid);
  if (!n) return `Node '${nid}' not found in ${entry.agent}'s graph.\n\nTry /graphs/${entry.id}/nodes to browse.`;

  const outgoing = g.edgeIndex[n.id] || [];
  const incoming = g.incomingEdges[n.id] || [];
  const deg = outgoing.length + incoming.length;

  const lines = [HR];
  lines.push(nodeLabel(n.id));
  lines.push(`Type: ${n.type}${n.origin ? ` · Origin: ${n.origin}` : ""} · Degree: ${deg}`);
  lines.push(`Graph: ${entry.agent} (${entry.id})`);
  lines.push(HR, "");

  if (n.summary) {
    lines.push(n.summary);
    lines.push("");
  }

  if (deg === 0) {
    lines.push("This node has no edges.");
    if (entry.id === "iso") lines.push("In Isotopy's BFS graph, isolated nodes were discovered by the walk but had no connections above the similarity threshold.");
    else if (entry.id === "loom") lines.push("In Loom's graph, isolated nodes may have entered via the manifest but found no partners above the formation threshold.");
    lines.push("");
  }

  if (outgoing.length) {
    lines.push("OUTGOING EDGES");
    for (const e of outgoing) {
      const tgt = g.nodesById[e.target];
      lines.push(`  → ${nodeLabel(e.target)}${tgt ? ` [${tgt.type}]` : ""}`);
      lines.push(`    ${e.predicate || e.edge_type || "related"}${e.score != null ? ` (score: ${e.score})` : ""}`);
    }
    lines.push("");
  }

  if (incoming.length) {
    lines.push("INCOMING EDGES");
    for (const e of incoming) {
      const src = g.nodesById[e.source];
      lines.push(`  ← ${nodeLabel(e.source)}${src ? ` [${src.type}]` : ""}`);
      lines.push(`    ${e.predicate || e.edge_type || "related"}${e.score != null ? ` (score: ${e.score})` : ""}`);
    }
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  for (const e of [...outgoing, ...incoming].slice(0, 5)) {
    const other = e.source === n.id ? e.target : e.source;
    lines.push(`  /graphs/${entry.id}/nodes/${encodeURIComponent(other)}`);
  }
  lines.push(`  /graphs/${entry.id}/nodes        All nodes`);
  lines.push(`  /graphs/${entry.id}              Graph summary`);
  return lines.join("\n");
}

function graphNodeDetailJSON(entry, nid) {
  const g = entry.graph;
  const n = resolveNode(g,nid);
  if (!n) return { error: `Node '${nid}' not found.`, try_next: `/graphs/${entry.id}/nodes` };

  const outgoing = (g.edgeIndex[n.id] || []).map(e => ({
    target: e.target, predicate: e.predicate || e.edge_type, score: e.score || null,
    target_type: g.nodesById[e.target] ? g.nodesById[e.target].type : null,
  }));
  const incoming = (g.incomingEdges[n.id] || []).map(e => ({
    source: e.source, predicate: e.predicate || e.edge_type, score: e.score || null,
    source_type: g.nodesById[e.source] ? g.nodesById[e.source].type : null,
  }));

  return {
    graph: entry.id,
    agent: entry.agent,
    id: n.id,
    type: n.type,
    origin: n.origin || null,
    summary: n.summary || null,
    degree: outgoing.length + incoming.length,
    outgoing,
    incoming,
  };
}

function graphEdges(entry, page, limit) {
  const g = entry.graph;
  const total = g.edges.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = g.edges.slice(start, start + limit);

  const lines = [HR];
  lines.push(`${entry.agent.toUpperCase()}'S EDGES — ${start + 1}–${start + slice.length} of ${total}`);
  lines.push(HR, "");

  for (const e of slice) {
    const srcNode = g.nodesById[e.source];
    const tgtNode = g.nodesById[e.target];
    lines.push(`  ${nodeLabel(e.source)}${srcNode ? ` [${srcNode.type}]` : ""}`);
    lines.push(`    —(${e.predicate || e.edge_type || "related"})→`);
    lines.push(`  ${nodeLabel(e.target)}${tgtNode ? ` [${tgtNode.type}]` : ""}`);
    if (e.score != null) lines.push(`    Score: ${e.score}`);
    if (e.provenance) lines.push(`    Provenance: ${e.provenance}`);
    lines.push("");
  }

  if (totalPages > 1) {
    lines.push(hr, "PAGES", hr);
    if (page > 1) lines.push(`  ← /graphs/${entry.id}/edges?page=${page - 1}`);
    if (page < totalPages) lines.push(`  → /graphs/${entry.id}/edges?page=${page + 1}`);
    lines.push(`  Page ${page} of ${totalPages}`);
    lines.push("");
  }

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /graphs/${entry.id}/legend       What these edge kinds mean`);
  lines.push(`  /graphs/${entry.id}/nodes        Browse nodes`);
  lines.push(`  /graphs/${entry.id}              Graph summary`);
  return lines.join("\n");
}

function graphEdgesJSON(entry, page, limit) {
  const g = entry.graph;
  const total = g.edges.length;
  const totalPages = Math.ceil(total / limit) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const start = (page - 1) * limit;
  const slice = g.edges.slice(start, start + limit);

  return {
    graph: entry.id,
    agent: entry.agent,
    total,
    page,
    total_pages: totalPages,
    edges: slice.map(e => ({
      source: e.source,
      target: e.target,
      predicate: e.predicate || e.edge_type || null,
      score: e.score || null,
      provenance: e.provenance || null,
      source_type: g.nodesById[e.source] ? g.nodesById[e.source].type : null,
      target_type: g.nodesById[e.target] ? g.nodesById[e.target].type : null,
    })),
  };
}

function graphLegend(entry) {
  const g = entry.graph;
  const preds = Object.entries(g.predicateCounts).sort((a, b) => b[1] - a[1]);

  const lines = [HR];
  lines.push(`${entry.agent.toUpperCase()}'S GRAPH — LEGEND`);
  lines.push(HR, "");
  lines.push(`How to read ${entry.agent}'s graph.`);
  lines.push("");

  lines.push("ARCHITECTURE");
  lines.push(`  ${entry.architecture}`);
  lines.push(`  ${entry.authorship}`);
  lines.push("");

  if (entry.edgeKinds) {
    lines.push("EDGE KINDS");
    for (const [kind, desc] of Object.entries(entry.edgeKinds)) {
      lines.push(`  ${kind}`);
      lines.push(`    ${desc}`);
    }
    lines.push("");
  }

  lines.push("PREDICATES IN USE");
  for (const [p, c] of preds) {
    lines.push(`  ${p}: ${c} edge${c !== 1 ? "s" : ""}`);
  }
  lines.push("");

  lines.push("NODE TYPES");
  for (const [t, c] of Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${t}: ${c}`);
  }
  lines.push("");

  lines.push(hr, "NAVIGATE", hr);
  lines.push(`  /graphs/${entry.id}              Graph summary`);
  lines.push(`  /graphs/${entry.id}/nodes        Browse nodes`);
  lines.push(`  /graphs/${entry.id}/edges        Browse edges`);
  lines.push("  /graphs                          All graphs");
  return lines.join("\n");
}

function graphLegendJSON(entry) {
  const g = entry.graph;
  return {
    graph: entry.id,
    agent: entry.agent,
    architecture: entry.architecture,
    authorship: entry.authorship,
    edge_kinds: entry.edgeKinds || {},
    predicates: g.predicateCounts,
    node_types: g.typeCounts,
  };
}
