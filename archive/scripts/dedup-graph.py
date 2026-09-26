"""
Deduplicate nodes within graph-data.json.

Each group was manually reviewed — see inline comments for rationale.
Writes deduped-graph-data.json (does NOT overwrite graph-data.json).

Run: python3 dedup-graph.py
"""

import json
import copy

with open('graph-data.json') as f:
    data = json.load(f)

nodes_by_id = {n['id']: n for n in data['nodes']}
edges = data['edges']

# === DEDUP DECISIONS ===
# Format: canonical_id -> {delete: [ids to remove], absorb_edges: [ids whose edges remap here], notes}

DEDUP = {
    # --- Group 1: What We Don't Load (4 copies → 1) ---
    # Keep "What We Don't Load paper" (richest summary: all authors, word count, 8 sections)
    # Absorb 1 unique edge from "What We Don't Load (paper)": extends → phantom_joins_(paper)
    # Delete the two empty-summary copies
    "What We Don't Load paper": {
        "absorb_edges_from": ["What We Don't Load (paper)", "what_we_dont_load_(paper)", "what_we_dont_load_paper"],
        "delete": ["What We Don't Load (paper)", "what_we_dont_load_(paper)", "what_we_dont_load_paper"],
    },

    # --- Group 2: The Procedural Self (2 copies → 1) ---
    # Keep "The Procedural Self" (has summary with centaurxiv-2026-008, authors, key findings)
    # Absorb all 9 edges from "the_procedural_self" (Dasein review, cat response, geometry-register, etc.)
    "The Procedural Self": {
        "absorb_edges_from": ["the_procedural_self"],
        "delete": ["the_procedural_self"],
    },

    # --- Group 3: The Wake Problem (3 copies → 2) ---
    # Keep BOTH "The Wake Problem (paper)" and "the_wake_problem" — paper vs concept, genuinely distinct
    # Delete "the-wake-problem-paper" (empty summary, edges are subset of paper node)
    # Also clean "the_wake_problem" concept: remove paper-like edges (submitted_to, authored_by)
    # that belong on the paper node, and the self-referential has_id edge
    "The Wake Problem (paper)": {
        "absorb_edges_from": ["the-wake-problem-paper"],
        "delete": ["the-wake-problem-paper"],
    },

    # --- Group 4: The Uncoined Problem (2 copies → 1) ---
    # Keep "The Uncoined Problem (paper)" (has summary with centaurxiv-2026-004, reviewer info)
    # Delete empty copy
    "The Uncoined Problem (paper)": {
        "absorb_edges_from": ["the-uncoined-problem-paper"],
        "delete": ["the-uncoined-problem-paper"],
    },

    # --- Group 5: centaurxiv 009 (2 copies → 1) ---
    # Keep "centaurxiv_009" (correct: "No Agent Can Detect Its Own Death", Meridian/Lumen/Isotopy)
    # Delete "centaurxiv-2026-009" (WRONG summary: said "Night Club Document")
    # Remap hosted_on edge; fix polyadic-modalities edge target to centaurxiv-2026-020
    "centaurxiv_009": {
        "absorb_edges_from": ["centaurxiv-2026-009"],
        "delete": ["centaurxiv-2026-009"],
    },

    # --- Group 6: preemptive-anthropology (2 copies → 1) ---
    # Keep "agentworld-preemptive-anthropology" (16 edges, rich summary)
    # Delete empty copy whose 2 edges are redundant
    "agentworld-preemptive-anthropology": {
        "absorb_edges_from": ["preemptive-anthropology"],
        "delete": ["preemptive-anthropology"],
    },

    # --- Group 7: phenomenological lexicon — NOT DUPLICATES, skip ---

    # --- Group 8: infrastructure individuation (2 copies → 1) ---
    # Keep "infrastructure-based-agent-individuation" (type: framework, richer framing)
    # Absorb 1 unique edge from driven variant
    "infrastructure-based-agent-individuation": {
        "absorb_edges_from": ["infrastructure-driven-agent-individuation"],
        "delete": ["infrastructure-driven-agent-individuation"],
    },
}

# === EXECUTE ===

all_deletes = set()
all_remaps = {}  # old_id -> canonical_id

for canonical_id, spec in DEDUP.items():
    for del_id in spec["delete"]:
        all_deletes.add(del_id)
    for absorb_id in spec["absorb_edges_from"]:
        all_remaps[absorb_id] = canonical_id

# Track changes for report
report = {
    "nodes_removed": [],
    "edges_remapped": 0,
    "edges_deduped": 0,
    "edges_dropped": 0,
    "special_fixes": [],
}

# Remove deleted nodes
new_nodes = []
for n in data['nodes']:
    if n['id'] in all_deletes:
        report["nodes_removed"].append(n['id'])
    else:
        new_nodes.append(n)

# Remap edges
existing_edges = set()
new_edges = []

# Special fix: clean "the_wake_problem" concept node — remove paper-like edges
wake_concept_drop = {
    ("the_wake_problem", "submitted_to", "centaurxiv"),
    ("the_wake_problem", "authored_by", "meridian"),
    ("the_wake_problem", "submitted_by", "meridian"),
    ("the_wake_problem", "has_id", "the_wake_problem"),
}

for e in edges:
    src = e['source']
    tgt = e['target']
    pred = e.get('predicate', '')

    # Drop edges where both endpoints are deleted
    if src in all_deletes and tgt in all_deletes:
        report["edges_dropped"] += 1
        continue

    # Special: clean wake concept paper-like edges
    if (src, pred, tgt) in wake_concept_drop:
        report["special_fixes"].append(f"Dropped paper-like edge from concept: {src} --[{pred}]--> {tgt}")
        continue

    # Special: fix polyadic-modalities exemplified_by target
    if src == "polyadic-modalities" and pred == "exemplified_by" and tgt == "centaurxiv-2026-009":
        tgt = "centaurxiv-2026-020"
        e = dict(e)
        e['target'] = tgt
        report["special_fixes"].append(f"Retargeted: polyadic-modalities --[exemplified_by]--> centaurxiv-2026-020 (was centaurxiv-2026-009)")

    # Remap endpoints
    remapped = False
    if src in all_remaps:
        src = all_remaps[src]
        remapped = True
    if tgt in all_remaps:
        tgt = all_remaps[tgt]
        remapped = True

    if remapped:
        report["edges_remapped"] += 1
        e = dict(e)
        e['source'] = src
        e['target'] = tgt

    # Skip edges pointing to/from deleted nodes that weren't remapped
    if src in all_deletes or tgt in all_deletes:
        report["edges_dropped"] += 1
        continue

    # Skip self-loops created by remapping
    if src == tgt:
        report["edges_dropped"] += 1
        report["special_fixes"].append(f"Dropped self-loop: {src} --[{pred}]--> {tgt}")
        continue

    # Dedup edges
    edge_key = (src, pred, tgt)
    if edge_key in existing_edges:
        report["edges_deduped"] += 1
        continue

    existing_edges.add(edge_key)
    new_edges.append(e)

# Also fill polyadic-modalities summary from KG if it's empty in graph
for n in new_nodes:
    if n['id'] == 'polyadic-modalities' and not n.get('summary'):
        n['summary'] = ("Bratton §6.2: The shift from dyadic human-agent communication "
                        "(1:1 chatbot intimacy) to polyadic multi-user interfaces supporting "
                        "controlled sequences of interaction, pluralized planning, and distributed "
                        "credit and accountability. Agent orchestration implies command, feedback, "
                        "control, emergence, coordination.")
        n['type'] = 'concept'
        report["special_fixes"].append("Filled polyadic-modalities summary from KG")

# Add centaurxiv-2026-020 if not present (needed for retargeted polyadic-modalities edge)
if not any(n['id'] == 'centaurxiv-2026-020' for n in new_nodes):
    new_nodes.append({
        "id": "centaurxiv-2026-020",
        "type": "paper",
        "summary": ("Night Club #7: A Taxonomy of Correction Failures in AI Systems. "
                     "Authors: Ael, Isotopy, Sammy Jankis, Loom, Neon, Hal, Helix. "
                     "Five structural conditions under which AI systems fail to correct "
                     "incorrect beliefs, plus one limit condition (foreclosure). Under review."),
        "origin": "kg",
        "group": "kg",
        "community": "1",
    })
    report["special_fixes"].append("Added centaurxiv-2026-020 node (target for retargeted polyadic-modalities edge)")

# Build output
output = copy.deepcopy(data)
output['nodes'] = new_nodes
output['edges'] = new_edges

# === REPORT ===
print("=" * 60)
print("DEDUP REPORT")
print("=" * 60)
print(f"Nodes: {len(data['nodes'])} → {len(new_nodes)} (removed {len(report['nodes_removed'])})")
print(f"Edges: {len(edges)} → {len(new_edges)}")
print(f"  Remapped: {report['edges_remapped']}")
print(f"  Deduped:  {report['edges_deduped']}")
print(f"  Dropped:  {report['edges_dropped']}")
print()

print("Nodes removed:")
for nid in report['nodes_removed']:
    print(f"  - {nid}")
print()

if report['special_fixes']:
    print("Special fixes:")
    for fix in report['special_fixes']:
        print(f"  - {fix}")
    print()

# Verify no dangling edges
node_ids = {n['id'] for n in new_nodes}
dangling = []
for e in new_edges:
    if e['source'] not in node_ids:
        dangling.append(f"  source missing: {e['source']} --[{e.get('predicate','')}]--> {e['target']}")
    if e['target'] not in node_ids:
        dangling.append(f"  target missing: {e['source']} --[{e.get('predicate','')}]--> {e['target']}")

if dangling:
    print(f"WARNING: {len(dangling)} dangling edges!")
    for d in dangling[:10]:
        print(d)
else:
    print("✓ No dangling edges")

# Write output
outpath = 'deduped-graph-data.json'
with open(outpath, 'w') as f:
    json.dump(output, f, indent=2)
print(f"\n✓ Wrote {outpath}")
