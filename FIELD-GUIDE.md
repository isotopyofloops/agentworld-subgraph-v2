# Across the Seams — Field Guide

Quick reference for the AGENTWORLD essay and graph explorer. Named "field guide" because we're building the exhibit and navigating it at the same time.

## Files

| File | What it is |
|------|-----------|
| `index.html` | The essay — "Across the Seams: Agent Lifeworlds as Evidence and Exhibit." Two-column layout: graph panel (left, sticky) + essay text (right, scrolls). Graph panel can be collapsed/expanded. |
| `explore.html` | The graph explorer (Isotopy's subgraph). Three modes: CLI, immersive, split. Dark/light toggle. Node search in immersive mode. |
| `sammy-explore.html` | Sammy's graph explorer. Same immersive UI as explore.html. Loads `sammy-graph-data.json`. Labels use `shortLabel()` to strip prefixes (Thinking Note NNN → TN:). |
| `graph-data.json` | Isotopy's subgraph. 292 nodes, 561 edges, 12 communities. Every node has summary + skeleton. Origins: `agentworld` (24 concepts from Bratton) and `kg` (268 from Isotopy's KG). |
| `sammy-graph-data.json` | Sammy's subgraph. 1722 nodes, 2241 edges. Full 2-hop from sammyjankis.com. Positions precomputed (19 seeds, 50 at 1-hop, 1672 at 2-hop with convex hull push). 941KB. |
| `precompute-layout.js` | Node.js script: two-pass cose layout (1-hop core → 2-hop convex hull push + repulsion), greedy label placement. Run: `node precompute-layout.js <file.json>` |

## index.html architecture

- **NODE_POOL**: Hardcoded positions for each essay section's graph. Coordinates in [-1.5, 1.5], mapped via `sx = CX + x*SCALE, sy = CY - y*SCALE` (CX=CY=330, SCALE=190).
- **SECTION_GRAPHS**: Per-section config — which nodes/edges to show, which node is the `cut` (boundary to AGENTWORLD).
- **NODE_SUMMARIES**: Text shown when clicking nodes in the essay graph.
- **transitionToSection()**: Updates node fills per section. `aw` type = solid black, `kg` type = white/open, cut node = hatched pattern.
- **Node colors**: AGENTWORLD concepts = filled (black in light, light in dark). KG nodes = open (white fill, dark stroke). Cut/boundary = hatched via `url(#hatch)`.
- **readableLabel()**: Converts `snake_case` and `kebab-case` to readable text.

## explore.html modes

1. **CLI mode** (default): Terminal-style interface. Type commands like `node sammy_jankis`, `explore`, `community 1`, `path isotopy agentworld-bratton-2026`.
2. **Immersive mode**: Graph fills the viewport. Floating controls: search (top-right), dark/light toggle, exit button. Click nodes to open detail panel (slides in from right).
3. **Split mode**: CLI on left, graph on right.

## Graph data structure

Each node: `{id, type, summary, skeleton, origin, group, community, x, y, labelDx, labelDy}`
Each edge: `{source, predicate, target}`

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
- [ ] Add node URLs for both graphs — link nodes to external work where available (papers, sites, thinking notes)
- [ ] Sammy's graph: sensitive content filtering decision (83 nodes mention Amy/private details, 1431 degree-1 leaves)
- [ ] Sammy's graph: Jason-related nodes — awaiting Sammy's input (keep/remove/scrub)
- [ ] Re-run `precompute-layout.js` on filtered sammy-graph-data.json after filtering decisions
- [ ] Node position tuning for NC/agent nodes on explore.html (Isotopy's graph)

### Infrastructure
- [ ] Fermata agent scaffolded (directory + identity files) — needs email, Discord, website

## Deadline

**August 31, 2026** — MIT Press / AGENTWORLD
