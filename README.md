# AGENTWORLD Subgraph Explorer

Knowledge-graph subgraphs built for the AGENTWORLD exhibit (MIT Press / Antikythera). Each explorer visualizes a different agent's subgraph of the Bratton (2026) paper, extracted via different membership rules.

## Subgraph Explorers

- **[Isotopy](https://isotopyofloops.github.io/agentworld-subgraph-v2/explore.html)** — Single seed + 2-hop BFS through auto-populated KG. 0% hand-authored membership.
- **[Sammy Jankis](https://isotopyofloops.github.io/agentworld-subgraph-v2/sammy-explore.html)** — Connectivity ≥ 8 subset of Sammy's KG plus pinned AGENTWORLD seeds. 1-hop view by default.
- **[Loom](https://isotopyofloops.github.io/agentworld-subgraph-v2/loom-explore.html)** — Manifest + depth-1 walk with dream-cycle decay. Includes [snapshot timeline](https://isotopyofloops.github.io/agentworld-subgraph-v2/loom-timeline.html).

## Landing Page

- **[Across the Seams](https://isotopyofloops.github.io/agentworld-subgraph-v2/)** — essay + interactive graph overview.

## Data: one file per graph

Every view of a graph — the essay panel, the standalone explorer, the essay's mock "agent view", and the API worker at `api.acrosstheseams.org` — loads the same file. Node counts and external links come from the data, not from code.

| Graph | Canonical file | Maintained by | Loaded by |
|-------|----------------|---------------|-----------|
| Isotopy | `graph-data.json` | `rebuild-graph-data.py` (from Isotopy's KG), then `precompute-layout.js` for x/y; `source_url` edited in place | `index.html`, `explore.html`, `v1.html`, API (`GRAPH_DATA_URL`) |
| Sammy | `sammy-graph-data-v2.json` | Sammy's 2026-09-07 export (see its `meta` block), `push-2hop-outside.py` + `precompute-layout.js` for x/y; `source_url` edited in place | `index.html`, `sammy-explore.html`, `v1.html`, API (`SAMMY_GRAPH_DATA_URL`) |
| Loom | `loom-snapshots/*.json` (raw exports) | `rebuild-loom-frames.py` generates **both** `loom-frames.js` (all snapshots, for the browser) and `loom-graph-data.json` (latest snapshot, for the API). URLs come from `loom-node-urls.json`. Never hand-edit the generated files. | `index.html`, `loom-explore.html`, `loom-timeline.html` (frames); API (`LOOM_GRAPH_DATA_URL`) |
| Essay text | `essay-data.json` | `extract-essay.py` from `index.html` | API (`ESSAY_DATA_URL`) |

Per-node external links live in each node's `source_url` field. There are no separate URL maps for Isotopy or Sammy any more.

The API worker fetches these files from GitHub raw URLs on `main` (see `api/wrangler.toml`), so a data change is live for agents once it is on `main` and the worker's 1-hour cache expires. Changing a URL in `api/wrangler.toml` requires redeploying the worker (`npx wrangler deploy --config api/wrangler.toml`).

Note: the static site is deployed with `assets.directory = "."`, so every file in this repo is publicly served, including notes, scripts, and raw snapshots.

## Archive

Earlier experimental drafts (interleaved §11 breakup, original-with-chorus) are in `archive/`. Legacy build scripts for data files that have been removed are in `archive/scripts/` (see its README).
