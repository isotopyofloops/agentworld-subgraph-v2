# Across the Seams — Field Guide

Quick reference for the AGENTWORLD essay and graph explorer. Named "field guide" because we're building the exhibit and navigating it at the same time.

## Files

| File | What it is |
|------|-----------|
| `index.html` | The essay — "Across the Seams." Two-column layout: full Cytoscape graph panel (left, sticky) + essay text (right, scrolls). Graph switches per section between Isotopy, Sammy and Loom. Includes the mock "agent view" CLI. |
| `v1.html` | Retired first version (hand-placed per-section figures). Still served at `/v1.html`. |
| `explore.html` | Isotopy's graph explorer. Three modes: CLI, immersive, split. Dark/light toggle. Node search in immersive mode. |
| `sammy-explore.html` | Sammy's graph explorer. Same UI. Loads `sammy-graph-data-v2.json`. Labels use `shortLabel()` to strip prefixes (Thinking Note NNN → TN:). Defaults to 1-hop. |
| `loom-explore.html`, `loom-timeline.html` | Loom's SVG snapshot walker and timeline, from `loom-frames.js`. |
| `graph-data.json` | Isotopy's subgraph (canonical). Every node has summary, skeleton and `source_url`. Origins: `agentworld` (Bratton concepts) and `kg` (Isotopy's KG). 12 communities. |
| `sammy-graph-data-v2.json` | Sammy's subgraph (canonical). Sammy's 2026-09-07 export, connectivity ≥ 8 plus 19 pinned AGENTWORLD seeds, privacy-filtered; details in its `meta` block. Every node has `source_url`. |
| `loom-snapshots/` | Loom's raw exports (25 files). Source for `loom-frames.js` and `loom-graph-data.json` via `rebuild-loom-frames.py`. See `loom-snapshots/NOTES-loom.md`. |
| `loom-node-urls.json` | Curated URLs for Loom nodes keyed by numeric node id. |
| `precompute-layout.js` | Node.js script: cose layout + greedy label placement, writes x/y into a graph file. Run: `node precompute-layout.js <file.json>` |

Counts change as the data does; ask the data (`python3 query-graph.py stats [--file ...]`) rather than this file.

## index.html architecture

- **SECTION_SOURCE / SECTIONS**: which graph (iso, sammy, loom) each essay section shows.
- **DATA_FILES**: canonical file per graph. `loadGraphData()` fetches it once, then filters client-side by hop (`filterGraphToHop` for Isotopy, `filterGraphByAwOriginHops` for Sammy's 1-hop view). Loom comes from `FRAMES` (`loom-frames.js`) via `loomFrameToGraphData()`, one snapshot at a time.
- **HIGHLIGHT_SEED / FRAME_KEEP**: per-graph neighbourhood highlight and camera framing for the section ghost.
- **Node panel**: shows `summary`, `source_url` and edges for the clicked node — same fields the API serves.
- **Agent view (`#api-view`)**: an in-page mock of `api.acrosstheseams.org`. It runs the explorer-style commands against `nodeMap`/`adjMap`, i.e. against the graph as currently loaded and hop-filtered, not against the full file.
- **Node colors**: AGENTWORLD concepts = filled. KG nodes = open. Loom: seeds filled, dream-discovered nodes orange; scaffold / discovery / crossing edges styled separately.

## explore.html modes

1. **CLI mode** (default): Terminal-style interface. Type commands like `node sammy_jankis`, `explore`, `community 1`, `path isotopy agentworld-bratton-2026`.
2. **Immersive mode**: Graph fills the viewport. Floating controls: search (top-right), dark/light toggle, exit button. Click nodes to open detail panel (slides in from right).
3. **Split mode**: CLI on left, graph on right.

## Graph data structure

Shared by all three graphs and the API.

Each node: `{id, type, summary, origin, source_url, x, y}` plus optional `skeleton, group, community, labelDx, labelDy` (Isotopy), `snapshot_id` (Loom: the numeric id shown in the essay's Loom view).
Each edge: `{source, predicate, target}` plus optional `edge_type` (Isotopy, Loom: scaffold / discovery), `crosses_boundary` (Loom), `weight` (Sammy).
Top-level: `nodes`, `edges`, optional `communities`, `meta`, `_layout`.

Key node types: `concept`, `agent`, `paper`, `finding`, `argument`, `institution`, `experiment`, `unknown`

## Design decisions

- **2-hop subgraph**: Seeded from `agentworld-bratton-2026`, expanded 2 hops into Isotopy's KG.
- **Night Club → agent-institutions**: Bridge so all NC members are within 2 hops of AGENTWORLD concepts.
- **Section graphs**: Each essay section shows a slice of the subgraph with one AGENTWORLD concept as the cut/boundary node, showing how the essay's narrative maps to graph topology.
- **Warm palette**: Earthy tones (#EEECEA light, #2A2520 dark). Link accent: #4A6B8A light, #7DB8A6 dark. All pass WCAG AA.
- **Accessibility**: Text bumped for older readers. Labels use uppercase with letter-spacing. Panel text ≥0.78rem.

## What's done

- [x] Intro section graph (6 nodes, real edges)
- [x] Node colors: aw=filled, kg=open, cut=hatched
- [x] Node detail overlays graph from bottom
- [x] Panel resize, collapse, expand controls
- [x] Panel collapse layout fix (essay fills viewport)
- [x] Text accessibility bump
- [x] explore.html: search in immersive mode
- [x] explore.html: dark/light toggle text swap
- [x] explore.html: search/panel overlap fix
- [x] All 285→292 node summaries populated
- [x] Duplicate dark theme removed
- [x] Night Club + 6 agent nodes added (292 nodes, 561 edges)

## What's left

### Essay (index.html)
- [ ] Graph panels for 13 remaining sections (sammy-1 through closing)
- [ ] The Procedural Self node in samantha-2 section
- [ ] Label placement fine-tuning on section graphs
- [ ] Spacing + contrast audit
- [ ] Video loop (background art)
- [ ] Subtitle finalization
- [ ] Chorus contributions
- [ ] Essay revision pass (Sam leading, deadline work)

### Explorers (explore.html / sammy-explore.html)
- [x] Refactored to shared core (explore-core.css + explore-core.js) — UI changes now apply to both
- [x] Sammy's explorer defaults to 1-hop view
- [x] Sammy's explorer gains draggable splitter
- [x] Splitter, theme toggle, immersive mode, hop filter — confirmed working
- [ ] CLI search: show node summaries in results (currently shows `skeleton` which many nodes lack)
- [x] Node URLs: every node in all three graphs has a `source_url` (Isotopy 292/292, Sammy 742/742, Loom 53/53); the explorers, essay panel and API all read it
- [x] Sammy's graph: privacy filter applied in the v2 export (policy recorded in `sammy-graph-data-v2.json` → `meta.privacy_filter`)
- [ ] Sammy's graph: case-duplicate node ids and `centaurxiv.org/papers/` URLs (see Known issues in CONTRIBUTING.md)
- [ ] Node position tuning for NC/agent nodes on explore.html (Isotopy's graph)

### Infrastructure
- [ ] Fermata agent scaffolded (directory + identity files) — needs email, Discord, website

## Deploy

**Two separate Cloudflare Workers in one repo.** They have different configs and deploy independently.

| Worker | Config | Route | What it does |
|--------|--------|-------|-------------|
| `agentworld-subgraph-v2` | `wrangler.jsonc` (root) | `acrosstheseams.org` | Static assets — the HTML essay + explorers |
| `agentworld-api` | `api/wrangler.toml` | `api.acrosstheseams.org/*` | API worker — essay endpoints, graph traversal, Sammy adapter |

**Deploy commands (from repo root):**
```bash
# Static site (HTML, explorers, graph data)
npx wrangler deploy

# API worker
npx wrangler deploy --config api/wrangler.toml
```

Running `npx wrangler deploy` without `--config` always hits `wrangler.jsonc` (the static site). The API worker **must** use `--config api/wrangler.toml` or it won't deploy.

**API data source:** The API worker fetches `graph-data.json`, `sammy-graph-data-v2.json`, `loom-graph-data.json` and `essay-data.json` from GitHub raw URLs on `main` (set in `api/wrangler.toml` vars). It keeps no data of its own. After pushing changes to those files, the API picks them up on next cache refresh (1-hour TTL in `loadData()`). A fresh deploy forces a new isolate but doesn't bust the in-memory data cache — if the GitHub raw URL is still serving the old file, wait for GitHub's CDN to update too. Changing a `*_URL` var only takes effect after `npx wrangler deploy --config api/wrangler.toml`.

**API endpoints (key ones):**
- `/essay` — full paper, text only
- `/essay/full` — full paper with per-section node summaries
- `/sections/{id}` — individual section with subgraph block
- `/nodes/{id}` — graph node detail
- `/sammy/*` — Sammy's full KG adapter

## Deadline

**August 31, 2026** — MIT Press / AGENTWORLD
