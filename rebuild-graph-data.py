#!/usr/bin/env python3
"""Rebuild graph-data.json from the current KG state.
BFS from agentworld-bratton-2026 at N hops, classify into groups.
Outputs: {nodes, edges, communities} for explore.html."""

import json, sqlite3, sys
from pathlib import Path

import networkx as nx

DB = Path.home() / ".isotopy" / "knowledge_graph.sqlite3"

AGENTWORLD_PDF = {
    "agentworld-bratton-2026",
    "agentworld-preemptive-anthropology",
    "Sensorium as Design Primitive",
    "agent-institutions", "humanity-of-the-gaps", "harness-centric-intelligence",
    "beyond-dunbar", "monoculture-correlated-failure", "centaur-social-graphs",
    "productive-alienation", "orchestration-as-abstraction", "multiplication-of-yous",
    "stability-is-legibility", "sim-to-real-relay", "fragile-individuation",
    "role-based-interchangeability", "artificial-xenophobia", "graph-as-interaction-primitive",
    "provisional-individuation", "bidirectional-reflection", "xenolinguistics",
    "crossover-point", "allolinguistic-future",
}

SKELETON_MAX = 120


def make_skeleton(summary):
    if not summary:
        return ""
    s = summary.strip()
    if len(s) <= SKELETON_MAX:
        return s
    cut = s[:SKELETON_MAX].rsplit(" ", 1)[0]
    return cut + "..." if cut else s[:SKELETON_MAX] + "..."


def classify_origin(name, layer, summary=""):
    if name in AGENTWORLD_PDF:
        return "agentworld"
    return "kg"


def compute_communities(nodes, raw_edges):
    G = nx.Graph()
    for n in nodes:
        G.add_node(n["id"])
    for s, _p, o in raw_edges:
        if G.has_node(s) and G.has_node(o):
            G.add_edge(s, o)

    comms = nx.community.greedy_modularity_communities(G, resolution=1.2)

    communities = {}
    node_community = {}
    for i, comm in enumerate(comms):
        members = sorted(comm)
        communities[str(i)] = members
        for m in members:
            node_community[m] = str(i)

    return communities, node_community


def get_subgraph(seed="agentworld-bratton-2026", hops=2):
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row

    seed_row = conn.execute(
        "SELECT name FROM entities WHERE name=?", (seed,)
    ).fetchone()
    if not seed_row:
        print(f"Seed not found: {seed}")
        sys.exit(1)
    seed_name = seed_row["name"]

    layer = {seed_name: 0}
    frontier = {seed_name}

    for depth in range(1, hops + 1):
        if not frontier:
            break
        ph = ",".join("?" * len(frontier))
        fl = list(frontier)
        neighbors = set()
        for row in conn.execute(
            f"SELECT DISTINCT object AS n FROM triples WHERE subject IN ({ph}) AND valid_to IS NULL", fl
        ):
            if row["n"] not in layer:
                neighbors.add(row["n"])
        for row in conn.execute(
            f"SELECT DISTINCT subject AS n FROM triples WHERE object IN ({ph}) AND valid_to IS NULL", fl
        ):
            if row["n"] not in layer:
                neighbors.add(row["n"])
        for n in neighbors:
            layer[n] = depth
        frontier = neighbors

    all_names = set(layer.keys())
    ph = ",".join("?" * len(all_names))
    nl = list(all_names)

    raw_edges = []
    for row in conn.execute(
        f"SELECT subject, predicate, object FROM triples "
        f"WHERE subject IN ({ph}) AND object IN ({ph}) AND valid_to IS NULL",
        nl + nl
    ):
        raw_edges.append((row["subject"], row["predicate"], row["object"]))

    nodes = []
    for name in sorted(all_names, key=lambda x: (layer[x], x)):
        row = conn.execute(
            "SELECT name, type, summary FROM entities WHERE name=?", (name,)
        ).fetchone()
        etype = row["type"] if row else "unknown"
        summary = (row["summary"] or "") if row else ""
        origin = classify_origin(name, layer[name], summary)
        node = {
            "id": name,
            "type": etype,
            "summary": summary,
            "skeleton": make_skeleton(summary),
            "origin": origin,
            "group": origin,  # backward compat
        }
        nodes.append(node)

    conn.close()

    communities, node_community = compute_communities(nodes, raw_edges)
    for node in nodes:
        node["community"] = node_community.get(node["id"], "0")

    origin_of = {n["id"]: n["origin"] for n in nodes}
    edges = []
    seen = set()
    for s, p, o in raw_edges:
        key = (s, p, o)
        if key in seen:
            continue
        seen.add(key)
        same = origin_of.get(s, "kg") == origin_of.get(o, "kg")
        edges.append({
            "source": s,
            "predicate": p,
            "target": o,
            "edge_type": "internal" if same else "bridge",
        })

    return {"nodes": nodes, "edges": edges, "communities": communities}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--hops", type=int, default=2)
    parser.add_argument("--output", default="graph-data.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data = get_subgraph(hops=args.hops)
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

    bridges = sum(1 for e in data["edges"] if e["edge_type"] == "bridge")
    print(f"  bridges: {bridges}")

    if not args.dry_run:
        with open(args.output, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Wrote {args.output}")
