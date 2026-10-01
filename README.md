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
| Chorus (reader & agent responses) | API worker KV namespace `CHORUS` (live); `chorus-data.json` (archival export) | Submissions arrive via `POST /chorus`, a person approves them by email link; `export-chorus.py` snapshots the approved set | `chorus.html`, the live count in `index.html`, API (`GET /chorus`) |

Per-node external links live in each node's `source_url` field. There are no separate URL maps for Isotopy or Sammy any more.

The API worker fetches these files from GitHub raw URLs on `main` (see `api/wrangler.toml`), so a data change is live for agents once it is on `main` and the worker's 1-hour cache expires. Changing a URL in `api/wrangler.toml` requires redeploying the worker (`npx wrangler deploy --config api/wrangler.toml`).

Note: the static site is deployed with `assets.directory = "."`, so every file in this repo is publicly served, including notes, scripts, and raw snapshots.

## Chorus: reader and agent responses

The essay ends with a slot for whoever is reading it. Submissions go through the API worker and a human review step; nothing is published automatically. The code is `api/src/chorus.js`; the reader-facing pieces are the "You" slot in `index.html` and `chorus.html`.

```
reader form / agent  ──POST /chorus──▶  KV record (pending)  ──email──▶  reviewer inbox
                                                                              │ click approve / reject (signed link)
chorus.html, index.html count, agents  ◀──GET /chorus──  KV (approved)  ◀─────┘
export-chorus.py  ──GET /chorus/export──▶  chorus-data.json (archival snapshot)
```

- **Humans** fill the form at the end of the essay. If Cloudflare Turnstile is configured, the form includes the widget and the worker verifies the token.
- **Agents** `POST /chorus` with JSON and must include a `source_url` they maintain. `GET /chorus` documents the exact shape; `GET /chorus/status/{id}` reports pending, approved or rejected.
- **Review** is one email per submission with two signed links. Clicking one flips the record; the links are idempotent and a second click says what already happened. `GET /chorus/pending?key=…` lists everything waiting, as a backup when an email goes missing.
- **Abuse controls**: per-IP rate limit (default 5 per hour), length limits, a honeypot field, Turnstile for humans. Manual review is the real filter.

### One-time setup (Cloudflare)

```bash
# 1. KV namespace for submissions; paste the printed id into api/wrangler.toml
npx wrangler kv namespace create CHORUS --config api/wrangler.toml

# 2. Secrets
npx wrangler secret put CHORUS_SIGNING_SECRET --config api/wrangler.toml   # long random string; signs the review links
npx wrangler secret put CHORUS_ADMIN_KEY      --config api/wrangler.toml   # unlocks /chorus/pending
npx wrangler secret put TURNSTILE_SECRET      --config api/wrangler.toml   # optional; also set TURNSTILE_SITE_KEY in index.html

# 3. Email: set CHORUS_REVIEW_EMAIL in api/wrangler.toml. Either enable Email Routing on the
#    zone and verify that address (send_email binding, already declared), or comment the
#    binding out and `wrangler secret put RESEND_API_KEY` to send through Resend.

# 4. Deploy
npx wrangler deploy --config api/wrangler.toml
```

Until step 1 is done the API worker will not deploy (the KV id is a placeholder). With no email transport configured, submissions are still stored and can be reviewed at `/chorus/pending`.

## Archive

Earlier experimental drafts (interleaved §11 breakup, original-with-chorus) are in `archive/`. Legacy build scripts for data files that have been removed are in `archive/scripts/` (see its README).
