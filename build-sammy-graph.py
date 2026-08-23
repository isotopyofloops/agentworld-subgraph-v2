#!/usr/bin/env python3
"""Build Sammy's graph-data.json from his JSONL KG export.
Uses sammys-mirror/graph/{entities,triples}.jsonl as source.
Outputs same format as rebuild-graph-data.py for explore.html compatibility."""

import json
from pathlib import Path

import networkx as nx

SAMMY_DIR = Path.home() / "autonomous-ai/sam-repos/sammys-mirror/graph"
SKELETON_MAX = 120


def make_skeleton(summary):
    if not summary:
        return ""
    s = summary.strip()
    if len(s) <= SKELETON_MAX:
        return s
    cut = s[:SKELETON_MAX].rsplit(" ", 1)[0]
    return cut + "..." if cut else s[:SKELETON_MAX] + "..."


def classify_origin(name, etype):
    if etype == "agent":
        return "agent"
    if etype == "paper":
        return "paper"
    return "kg"


def compute_communities(nodes, raw_edges):
    G = nx.Graph()
    for n in nodes:
        G.add_node(n["id"])
    for e in raw_edges:
        if G.has_node(e["source"]) and G.has_node(e["target"]):
            G.add_edge(e["source"], e["target"])

    if len(G.nodes) == 0:
        return {}, {}

    comms = nx.community.greedy_modularity_communities(G, resolution=1.2)

    communities = {}
    node_community = {}
    for i, comm in enumerate(comms):
        members = sorted(comm)
        communities[str(i)] = members
        for m in members:
            node_community[m] = str(i)

    return communities, node_community


def build():
    entities = []
    with open(SAMMY_DIR / "entities.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                entities.append(json.loads(line))

    triples = []
    with open(SAMMY_DIR / "triples.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                triples.append(json.loads(line))

    entity_map = {e["name"]: e for e in entities}
    entity_names = set(entity_map.keys())

    nodes = []
    for e in entities:
        name = e["name"]
        etype = e.get("type", "concept")
        summary = e.get("summary", "")
        origin = classify_origin(name, etype)
        nodes.append({
            "id": name,
            "type": etype,
            "summary": summary,
            "skeleton": make_skeleton(summary),
            "origin": origin,
            "group": origin,
        })

    edges = []
    seen = set()
    for t in triples:
        s = t["subject"]
        p = t["predicate"]
        o = t["object"]

        if s not in entity_names and o not in entity_names:
            continue

        # Add missing entities as implicit nodes
        for name in [s, o]:
            if name not in entity_names:
                entity_names.add(name)
                nodes.append({
                    "id": name,
                    "type": "concept",
                    "summary": "",
                    "skeleton": "",
                    "origin": "kg",
                    "group": "kg",
                })

        key = (s, p, o)
        if key in seen:
            continue
        seen.add(key)

        origin_s = next((n["origin"] for n in nodes if n["id"] == s), "kg")
        origin_o = next((n["origin"] for n in nodes if n["id"] == o), "kg")
        same = origin_s == origin_o

        edges.append({
            "source": s,
            "predicate": p,
            "target": o,
            "edge_type": "internal" if same else "bridge",
        })

    communities, node_community = compute_communities(nodes, edges)
    for node in nodes:
        node["community"] = node_community.get(node["id"], "0")

    return {"nodes": nodes, "edges": edges, "communities": communities}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="sammy-graph-data.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data = build()
    print(f"{len(data['nodes'])} nodes, {len(data['edges'])} edges, "
          f"{len(data['communities'])} communities")

    origins = {}
    for n in data["nodes"]:
        g = n["origin"]
        origins[g] = origins.get(g, 0) + 1
    for g, c in sorted(origins.items(), key=lambda x: -x[1]):
        print(f"  origin {g}: {c}")

    for cid, members in sorted(data["communities"].items(), key=lambda x: -len(x[1])):
        print(f"  community {cid}: {len(members)} nodes")

    if not args.dry_run:
        with open(args.output, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Wrote {args.output}")
