# Contributing — AGENTWORLD Subgraph Explorers

Welcome. This repo holds the interactive exhibit for AGENTWORLD (MIT Press): an essay with embedded graph visualizations, three standalone graph explorers, and an agent-facing API worker.

## What's here

| File | What it is |
|------|-----------|
| `index.html` | The essay — "Across the Seams." Full Cytoscape graph panel (left) + essay text (right), with the mock "agent view" CLI. |
| `v1.html` | Retired first version of the essay page (hand-placed section graphs). Kept at `/v1.html`. |
| `explore.html` | Isotopy's graph explorer (thin wrapper). |
| `sammy-explore.html` | Sammy's graph explorer (thin wrapper). |
| `loom-explore.html`, `loom-timeline.html` | Loom's snapshot walker and timeline (SVG, from `loom-frames.js`). |
| `explore-core.css` / `explore-core.js` | Shared CSS/JS for the Isotopy and Sammy explorers. Agent-specific config is in `window.GRAPH_CONFIG`. |
| `graph-data.json` | Isotopy's subgraph. **Canonical.** |
| `sammy-graph-data-v2.json` | Sammy's subgraph. **Canonical.** Its `meta` block records membership rule and privacy filter. |
| `loom-snapshots/` → `loom-frames.js`, `loom-graph-data.json` | Loom's raw exports and the two files generated from them by `rebuild-loom-frames.py`. |
| `loom-node-urls.json` | Curated source URLs for Loom nodes (the export has none), merged in by `rebuild-loom-frames.py`. |
| `essay-data.json` | Essay text extracted from `index.html` by `extract-essay.py`, for the API. |
| `api/` | Cloudflare Worker for `api.acrosstheseams.org`. Loads the files above; holds no data of its own. |
| `precompute-layout.js` | Node.js: writes x/y positions into a graph file. Run after data changes. |
| `push-2hop-outside.py` | Sammy layout: pushes 2-hop nodes outside the 1-hop hull. |
| `query-graph.py` | CLI tool for querying graph data. See below. |
| `FIELD-GUIDE.md` | Detailed internal notes on architecture, design decisions, what's done/left. |

See "Data: one file per graph" in `README.md` for which file each page and the API load. When you change a graph file, every consumer picks it up; there is nothing to sync by hand.

## Quick start

Open any HTML file directly in a browser, or serve locally:

```
python3 -m http.server 8000
# then visit localhost:8000/explore.html
```

GitHub Pages serves the `main` branch automatically.

## query-graph.py

CLI tool for querying the graph data without a browser. Useful for finding nodes, checking edges, extracting subgraphs.

```bash
# Node detail + all edges
python3 query-graph.py node "sammy jankis"

# Fuzzy search (normalizes - and _ to spaces, case-insensitive)
python3 query-graph.py search bratton

# 1-hop or 2-hop subgraph from a seed
python3 query-graph.py subgraph autonomous-coordination --hops 2

# Real edges among a set of nodes (for building section graphs)
python3 query-graph.py edges-between isotopy loom the_goodbye_problem sammy_jankis

# Graph overview
python3 query-graph.py stats

# Check for origin mismatches (is_concept_from agentworld edge but origin != agentworld)
python3 query-graph.py origins

# Use Sammy's graph instead of Isotopy's
python3 query-graph.py stats --file sammy-graph-data-v2.json
```

## How the explorers work

Both explorers load from `explore-core.css` and `explore-core.js`. Each HTML file sets a `window.GRAPH_CONFIG` object with agent-specific values:

- `agent` / `agentPossessive` — display name
- `dataFile` — which JSON to load (the canonical file for that graph)
- `shortLabel` — optional label truncation function (Sammy's strips "Thinking Note NNN:" prefixes)
- `defaultHops` — which hop level to show on load (Sammy defaults to 1-hop)
- `nodeUrls` — optional per-node overrides for the panel link; by default the link is the node's `source_url`

**To change UI behavior**: edit `explore-core.js` or `explore-core.css`. Changes apply to both explorers.
**To change agent-specific config**: edit the `GRAPH_CONFIG` block in the relevant HTML wrapper.

## How the essay graph works

`index.html` loads the full canonical graph for whichever agent the current section belongs to (`SECTION_SOURCE`), then filters it client-side:

- `DATA_FILES` — canonical file per graph (Isotopy, Sammy). Loom is rendered from `loom-frames.js`.
- `GRAPH_SEEDS` / `DEFAULT_HOPS` — hop filtering. Sammy's 1-hop view is a BFS from all `origin: agentworld` nodes, the same rule `explore-core.js` uses.
- `HIGHLIGHT_SEED` / `FRAME_KEEP` — which neighbourhood is highlighted and kept in frame per section.
- The "agent view" panel is a mock of the API that runs against the graph currently loaded in the page (so it reflects the current hop filter, not the full file).

(`v1.html` still uses the older hand-placed `NODE_POOL` / `SECTION_GRAPHS` / `NODE_SUMMARIES` approach.)

## What needs testing

- [ ] Explorer: CLI commands (`explore`, `node <name>`, `search <query>`, `community <id>`, `path <a> -- <b>`, `crossings`)
- [ ] Explorer: immersive mode (Graph Only) — node click opens panel, search works, Esc exits
- [ ] Explorer: hop toggle (1-hop / 2-hop) — especially on Sammy's 742-node graph
- [ ] Explorer: theme toggle (Dark/Light)
- [ ] Explorer: splitter drag between CLI and graph panels
- [ ] Essay: graph panel collapse/expand
- [ ] Essay: node click → detail overlay
- [ ] Essay: scroll through sections → graph transitions
- [ ] Essay: search nodes in graph panel

## Known issues

- CLI search shows `skeleton` field instead of `summary` for results — many nodes lack skeleton
- Sammy's data has case-duplicate node ids (e.g. `Basin Key` / `basin key`, `Fidelity Signatures` / `fidelity signatures`, `Procedural Identity` / `procedural identity`, `Sammy Jankis` / `Sammy`). They come from Sammy's KG; merging is a data decision for Sammy.
- 49 Sammy `source_url`s use `centaurxiv.org/papers/<id>`; the canonical pattern used everywhere else is `centaurxiv.org/submissions/<id>/` (see `url-audit.md`). Some of these also point at a different paper id than Isotopy's graph does for the same work (e.g. The Goodbye Problem: 2026-005 vs 2026-001).
