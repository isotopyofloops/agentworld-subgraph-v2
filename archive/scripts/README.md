# Legacy build scripts

These produced data files that are no longer in the repo. They are kept for provenance only.

| Script | Produced | Superseded by |
|--------|----------|---------------|
| `build-sammy-graph.py` | `sammy-graph-data.json` (July/August 2-hop export from `sammys-mirror/`) | `sammy-graph-data-v2.json` (Sammy's 2026-09-07 export, connectivity ≥ 8 + pinned seeds, privacy-filtered; see its `meta` block) |
| `filter-sammy-graph.py` | `sammy-graph-data-filtered.json` (privacy pass over the above) | Privacy filter is recorded in `sammy-graph-data-v2.json` → `meta.privacy_filter` |
| `dedup-graph.py` | `deduped-graph-data.json` (285-node dedup of Isotopy's graph) | Folded into `graph-data.json` (292 nodes) |

The removed data files remain in git history (last present at commit `cb7d7a6`).
