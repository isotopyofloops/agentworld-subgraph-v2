#!/usr/bin/env python3
"""Query tool for AGENTWORLD subgraph data.

Usage:
  python3 query-graph.py node <name>                    — node detail + edges
  python3 query-graph.py search <query>                 — fuzzy search nodes
  python3 query-graph.py subgraph <seed> [--hops N]     — extract N-hop subgraph
  python3 query-graph.py edges-between <n1> <n2> [...]  — real edges among a set of nodes
  python3 query-graph.py stats                          — graph overview
  python3 query-graph.py origins                        — list origin mismatches (is_concept_from edges vs origin field)

Searches normalize - and _ to spaces. Node names are case-insensitive.
Defaults to graph-data.json; use --file sammy-graph-data.json for Sammy's graph.
"""

import json, sys, os

def load(path):
    with open(path) as f:
        return json.load(f)

def normalize(s):
    return s.lower().replace('-', ' ').replace('_', ' ')

def resolve(name, nodes):
    nl = normalize(name)
    for nid in nodes:
        if normalize(nid) == nl:
            return nid
    for nid in nodes:
        if nl in normalize(nid):
            return nid
    return None

def cmd_node(data, name):
    nodes = {n['id']: n for n in data['nodes']}
    nid = resolve(name, nodes)
    if not nid:
        print(f"No node matching '{name}'")
        candidates = [n for n in nodes if normalize(name) in normalize(n)]
        if candidates:
            print(f"  Did you mean: {', '.join(candidates[:5])}")
        return

    n = nodes[nid]
    print(f"\n  {nid}")
    print(f"  type:      {n.get('type', '?')}")
    print(f"  origin:    {n.get('origin', '?')}")
    print(f"  community: {n.get('community', '?')}")
    if n.get('summary'):
        print(f"  summary:   {n['summary'][:200]}")

    edges_out = []
    edges_in = []
    for e in data['edges']:
        if e['source'] == nid:
            edges_out.append(e)
        elif e['target'] == nid:
            edges_in.append(e)

    print(f"\n  edges: {len(edges_out)} outgoing, {len(edges_in)} incoming")
    if edges_out:
        print("\n  outgoing:")
        for e in edges_out:
            print(f"    → [{e['predicate']}] {e['target']}")
    if edges_in:
        print("\n  incoming:")
        for e in edges_in:
            print(f"    ← [{e['predicate']}] {e['source']}")
    print()

def cmd_search(data, query):
    q = normalize(query)
    results = []
    for n in data['nodes']:
        score = 0
        nl = normalize(n['id'])
        if q == nl:
            score = 100
        elif q in nl:
            score = 50
        if q in normalize(n.get('summary', '')):
            score += 10
        if score > 0:
            results.append((score, n))

    results.sort(key=lambda x: (-x[0], x[1]['id']))
    print(f"\n  {len(results)} results for '{query}'\n")
    for score, n in results[:20]:
        origin = n.get('origin', '?')
        ntype = n.get('type', '?')
        summary = (n.get('summary', '') or '')[:80]
        print(f"  [{origin:10}] [{ntype:12}] {n['id']}")
        if summary:
            print(f"               {summary}")
    if len(results) > 20:
        print(f"\n  ... and {len(results) - 20} more")
    print()

def cmd_subgraph(data, seed_name, hops):
    nodes = {n['id']: n for n in data['nodes']}
    seed = resolve(seed_name, nodes)
    if not seed:
        print(f"No node matching '{seed_name}'")
        return

    adj = {}
    for e in data['edges']:
        adj.setdefault(e['source'], []).append((e['target'], e['predicate']))
        adj.setdefault(e['target'], []).append((e['source'], e['predicate']))

    layers = {seed: 0}
    frontier = [seed]
    for d in range(1, hops + 1):
        nxt = []
        for nd in frontier:
            for nb, pred in adj.get(nd, []):
                if nb not in layers:
                    layers[nb] = d
                    nxt.append(nb)
        frontier = nxt

    sg_edges = [e for e in data['edges']
                if e['source'] in layers and e['target'] in layers]

    print(f"\n  {hops}-hop subgraph from {seed}: {len(layers)} nodes, {len(sg_edges)} edges\n")
    for d in range(hops + 1):
        label = "SEED" if d == 0 else f"HOP {d}"
        layer_nodes = sorted([nid for nid, dd in layers.items() if dd == d])
        print(f"  --- {label} ({len(layer_nodes)} nodes) ---")
        for nid in layer_nodes:
            n = nodes.get(nid, {})
            deg = len(adj.get(nid, []))
            local_deg = len([nb for nb, _ in adj.get(nid, []) if nb in layers])
            print(f"    {nid} [{n.get('type','?')}] origin={n.get('origin','?')} deg={local_deg}/{deg}")
        print()

    print(f"  edges:")
    for e in sg_edges:
        print(f"    {e['source']} --[{e['predicate']}]--> {e['target']}")
    print()

def cmd_edges_between(data, names):
    nodes = {n['id']: n for n in data['nodes']}
    resolved = []
    for name in names:
        r = resolve(name, nodes)
        if r:
            resolved.append(r)
        else:
            print(f"  Warning: no node matching '{name}', skipping")

    if len(resolved) < 2:
        print("Need at least 2 valid nodes")
        return

    node_set = set(resolved)
    found = []
    for e in data['edges']:
        if e['source'] in node_set and e['target'] in node_set:
            found.append(e)

    print(f"\n  {len(found)} edges among {len(resolved)} nodes: {', '.join(resolved)}\n")
    if found:
        for e in found:
            print(f"    {e['source']} --[{e['predicate']}]--> {e['target']}")
    else:
        print("    (no edges between these nodes)")
    print()

def cmd_stats(data):
    nodes = data['nodes']
    edges = data['edges']

    origins = {}
    types = {}
    communities = {}
    for n in nodes:
        o = n.get('origin', '?')
        origins[o] = origins.get(o, 0) + 1
        t = n.get('type', '?')
        types[t] = types.get(t, 0) + 1
        c = n.get('community', '?')
        communities[c] = communities.get(c, 0) + 1

    adj = {}
    for e in edges:
        adj.setdefault(e['source'], set()).add(e['target'])
        adj.setdefault(e['target'], set()).add(e['source'])

    degrees = [len(adj.get(n['id'], set())) for n in nodes]
    isolates = sum(1 for d in degrees if d == 0)
    leaves = sum(1 for d in degrees if d == 1)

    print(f"\n  {len(nodes)} nodes, {len(edges)} edges")
    print(f"  origins:     {', '.join(f'{k}({v})' for k, v in sorted(origins.items(), key=lambda x: -x[1]))}")
    print(f"  types:       {', '.join(f'{k}({v})' for k, v in sorted(types.items(), key=lambda x: -x[1])[:8])}")
    print(f"  communities: {len(communities)}")
    print(f"  isolates:    {isolates}")
    print(f"  leaves:      {leaves} ({leaves*100//len(nodes)}%)")
    print(f"  max degree:  {max(degrees)} ({[n['id'] for n in nodes if len(adj.get(n['id'], set())) == max(degrees)][0]})")
    print()

def cmd_origins(data):
    nodes = {n['id']: n for n in data['nodes']}
    aw_concepts = set()
    for e in data['edges']:
        if e['predicate'] == 'is_concept_from' and 'agentworld' in e['target'].lower():
            aw_concepts.add(e['source'])
        elif e['predicate'] == 'is_concept_from' and 'agentworld' in e['source'].lower():
            aw_concepts.add(e['target'])

    mismatches = []
    for nid in aw_concepts:
        n = nodes.get(nid)
        if n and n.get('origin') != 'agentworld':
            mismatches.append(nid)

    if mismatches:
        print(f"\n  {len(mismatches)} nodes with is_concept_from agentworld edge but origin != 'agentworld':\n")
        for nid in sorted(mismatches):
            print(f"    {nid}  origin={nodes[nid].get('origin')}")
    else:
        print("\n  No origin mismatches found.")
    print()

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return

    datafile = 'graph-data.json'
    if '--file' in args:
        idx = args.index('--file')
        datafile = args[idx + 1]
        args = args[:idx] + args[idx+2:]

    script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, datafile)
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return

    data = load(path)
    cmd = args[0].lower()

    if cmd == 'node' and len(args) >= 2:
        cmd_node(data, ' '.join(args[1:]))
    elif cmd == 'search' and len(args) >= 2:
        cmd_search(data, ' '.join(args[1:]))
    elif cmd == 'subgraph' and len(args) >= 2:
        hops = 1
        rest = args[1:]
        if '--hops' in rest:
            hi = rest.index('--hops')
            hops = int(rest[hi + 1])
            rest = rest[:hi] + rest[hi+2:]
        cmd_subgraph(data, ' '.join(rest), hops)
    elif cmd in ('edges-between', 'edges_between', 'between') and len(args) >= 3:
        cmd_edges_between(data, args[1:])
    elif cmd == 'stats':
        cmd_stats(data)
    elif cmd == 'origins':
        cmd_origins(data)
    else:
        print(__doc__)

if __name__ == '__main__':
    main()
