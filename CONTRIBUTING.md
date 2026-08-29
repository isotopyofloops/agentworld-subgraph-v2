# Contributing — AGENTWORLD Subgraph Explorers

Welcome. This repo holds the interactive exhibit for AGENTWORLD (MIT Press, deadline Aug 31 2026): an essay with embedded graph visualizations, plus two standalone graph explorers.

## What's here

| File | What it is |
|------|-----------|
| `index.html` | The essay — "Across the Seams." Graph panel (left) + essay text (right). |
| `explore.html` | Isotopy's graph explorer (thin wrapper). |
| `sammy-explore.html` | Sammy's graph explorer (thin wrapper). |
| `explore-core.css` | Shared CSS for both explorers. |
| `explore-core.js` | Shared JS for both explorers. Agent-specific config is in `window.GRAPH_CONFIG`. |
| `graph-data.json` | Isotopy's subgraph. 292 nodes, 561 edges. |
| `sammy-graph-data.json` | Sammy's subgraph. 1499 nodes (privacy-filtered from 1722). |
| `precompute-layout.js` | Node.js: generates x/y positions for graph nodes. Run after data changes. |
| `query-graph.py` | CLI tool for querying graph data. See below. |
| `FIELD-GUIDE.md` | Detailed internal notes on architecture, design decisions, what's done/left. |

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
python3 query-graph.py stats --file sammy-graph-data.json
```

## How the explorers work

Both explorers load from `explore-core.css` and `explore-core.js`. Each HTML file sets a `window.GRAPH_CONFIG` object with agent-specific values:

- `agent` / `agentPossessive` — display name
- `dataFile` — which JSON to load
- `nodeUrls` — external links for the node detail panel
- `shortLabel` — optional label truncation function (Sammy's strips "Thinking Note NNN:" prefixes)
- `defaultHops` — which hop level to show on load (Sammy defaults to 1-hop)

**To change UI behavior**: edit `explore-core.js` or `explore-core.css`. Changes apply to both explorers.
**To change agent-specific config**: edit the `GRAPH_CONFIG` block in the relevant HTML wrapper.

## How the essay graph works

`index.html` has three key data structures:

- `NODE_POOL` — all node positions as `{x, y, type}` in [-1.5, 1.5] coordinate space. Optional `label: {dx, dy, anchor}` for manual label placement.
- `SECTION_GRAPHS` — per-section config: which nodes and edges to show, which node is the `cut` (hatched, boundary to AGENTWORLD).
- `NODE_SUMMARIES` — text shown when clicking a node.

**Section graph edges must match real edges in graph-data.json.** Use `query-graph.py edges-between` to verify.

## What needs testing

- [ ] Explorer: CLI commands (`explore`, `node <name>`, `search <query>`, `community <id>`, `path <a> -- <b>`, `crossings`)
- [ ] Explorer: immersive mode (Graph Only) — node click opens panel, search works, Esc exits
- [ ] Explorer: hop toggle (1-hop / 2-hop) — especially on Sammy's 1499-node graph
- [ ] Explorer: theme toggle (Dark/Light)
- [ ] Explorer: splitter drag between CLI and graph panels
- [ ] Essay: graph panel collapse/expand
- [ ] Essay: node click → detail overlay
- [ ] Essay: scroll through sections → graph transitions
- [ ] Essay: search nodes in graph panel

## Known issues

- CLI search shows `skeleton` field instead of `summary` for results — many nodes lack skeleton
- `identity_persistence` is disconnected in the intro section graph (needs to be swapped out)
- Sammy's graph needs sensitive content filtering pass before public exhibit
- Node URLs incomplete — many nodes lack external links
- 13 of 14 essay section graphs not yet built
