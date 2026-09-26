"""
Rebuild Loom's derived data files from the raw snapshot exports in loom-snapshots/.

This is the single generator for everything Loom-related that the UI and API load:

  loom-frames.js        all snapshots as FRAMES (index.html, loom-explore.html, loom-timeline.html)
  loom-graph-data.json  the latest snapshot in the shared graph-data schema (API worker)

For each snapshot:
  1. Read the raw JSON
  2. Convert to FRAMES format (compact node/edge representation)
  3. Compute layout positions (spiral for seeds, spring from seeds for neighbors)
  4. Write consolidated loom-frames.js
Then write loom-graph-data.json from the newest frame.

Node URLs: the export has no URL field, so links are merged from loom-node-urls.json
(keyed by Loom's numeric node id). Never edit loom-frames.js or loom-graph-data.json
by hand — edit the snapshots or loom-node-urls.json and re-run this script.

Positions: seeds arranged in a fixed spiral (consistent across frames),
neighbors placed near their connected seeds with a small radial offset.
"""

import json
import glob
import math
import os
import re

SNAPSHOT_DIR = 'loom-snapshots'
OUTPUT = 'loom-frames.js'
GRAPH_OUTPUT = 'loom-graph-data.json'
URLS_FILE = 'loom-node-urls.json'

# Slug ids for loom-graph-data.json: first SLUG_WORDS words of the content, max SLUG_MAXLEN chars.
SLUG_WORDS = 5
SLUG_MAXLEN = 50

# Layout constants — viewport matches the SVG viewBox in loom-explore.html
VP_W, VP_H = 1000, 860
CENTER_X, CENTER_Y = VP_W / 2, VP_H / 2
PAD = 80

def compute_positions(nodes, edges):
    """Compute x,y for each node. Seeds in an Archimedean spiral filling the viewport,
    neighbors placed near their connected seeds."""
    seeds = [n for n in nodes if n.get('is_seed')]
    neighbors = [n for n in nodes if not n.get('is_seed')]

    # Build adjacency from edges
    adj = {}
    for e in edges:
        s, d = e.get('src', e.get('s')), e.get('dst', e.get('d'))
        if s not in adj: adj[s] = []
        if d not in adj: adj[d] = []
        adj[s].append(d)
        adj[d].append(s)

    positions = {}

    # Seeds: Archimedean spiral that fills the viewport
    # Golden angle gives even coverage; radius grows linearly with index
    seeds.sort(key=lambda n: n['id'])
    max_r = min(VP_W, VP_H) / 2 - PAD
    golden_angle = math.pi * (3 - math.sqrt(5))
    for i, n in enumerate(seeds):
        frac = i / max(len(seeds) - 1, 1)
        r = max_r * math.sqrt(frac)  # sqrt gives even area density
        angle = i * golden_angle
        positions[n['id']] = {
            'x': round(CENTER_X + r * math.cos(angle), 1),
            'y': round(CENTER_Y + r * math.sin(angle), 1),
        }

    # Neighbors: place near connected seeds with angular offset
    neighbors.sort(key=lambda n: n['id'])
    for i, n in enumerate(neighbors):
        connected_seeds = [sid for sid in adj.get(n['id'], []) if sid in positions]
        if connected_seeds:
            ax = sum(positions[s]['x'] for s in connected_seeds) / len(connected_seeds)
            ay = sum(positions[s]['y'] for s in connected_seeds) / len(connected_seeds)
            # Push outward from center with angular offset to avoid overlap
            dx, dy = ax - CENTER_X, ay - CENTER_Y
            dist = math.sqrt(dx*dx + dy*dy) or 1
            base_angle = math.atan2(dy, dx)
            spread = (i * golden_angle) % (2 * math.pi) - math.pi
            push = 50 + 30 * (i % 3)
            positions[n['id']] = {
                'x': round(ax + push * math.cos(base_angle + spread * 0.3), 1),
                'y': round(ay + push * math.sin(base_angle + spread * 0.3), 1),
            }
        else:
            # No connections — place on outer ring
            angle = (2 * math.pi * i) / max(len(neighbors), 1)
            positions[n['id']] = {
                'x': round(CENTER_X + (max_r + 40) * math.cos(angle), 1),
                'y': round(CENTER_Y + (max_r + 40) * math.sin(angle), 1),
            }

    return positions


def load_node_urls():
    """Curated URLs keyed by numeric node id (as strings), plus the seed default."""
    try:
        with open(URLS_FILE) as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f'  (no {URLS_FILE}; nodes will have no source_url)')
        return {}, None
    return data.get('urls', {}), data.get('default_seed_url')


def node_url(n, urls, default_seed_url):
    u = urls.get(str(n['id']))
    if u:
        return u
    if n.get('is_seed') and default_seed_url:
        return default_seed_url
    return None


def slugify(content):
    words = re.sub(r"[^a-z0-9\s-]", "", content.lower()).split()
    return "-".join(words[:SLUG_WORDS])[:SLUG_MAXLEN]


def frame_to_graph_data(frame):
    """Latest frame -> the shared {nodes, edges} schema used by graph-data.json and the API.

    Node ids are content slugs (readable in URLs); `snapshot_id` keeps the numeric id
    the UI shows so a reader can cross-reference the two views. Positions are the
    frame's positions, so the API and the essay describe the same picture.
    """
    slug_by_id = {}
    nodes = []
    for n in frame['nodes']:
        slug = slugify(n['c'])
        if slug in slug_by_id.values():
            slug = f"{slug}-{n['id']}"
        slug_by_id[n['id']] = slug
        node = {
            'id': slug,
            'snapshot_id': n['id'],
            'type': n['t'],
            'summary': n['c'],
            'origin': 'agentworld' if n['seed'] else 'loom-kg',
            'x': n['x'],
            'y': n['y'],
        }
        if n.get('u'):
            node['source_url'] = n['u']
        nodes.append(node)
    edges = []
    for e in frame['edges']:
        edges.append({
            'source': slug_by_id[e['s']],
            'target': slug_by_id[e['d']],
            'predicate': e['src_kind'],
            'edge_type': 'discovery' if e['disc'] else 'scaffold',
            'crosses_boundary': bool(e['cross']),
        })
    return {
        'meta': {
            'source': 'loom-snapshots/' + frame['file'],
            'dream_cycle': frame['cycle'],
            'taken': frame['taken'],
            'generated_by': 'rebuild-loom-frames.py',
            'frames': None,  # filled in by main()
            'caveat': 'Membership oscillates between snapshots; node_count is not a growth measure. '
                      'Node content before 2026-08-23 is capped at 500 characters.',
        },
        'nodes': nodes,
        'edges': edges,
    }


def convert_snapshot(filepath, urls, default_seed_url):
    """Convert a raw snapshot file to a FRAMES entry."""
    with open(filepath) as f:
        raw = json.load(f)

    fname = os.path.basename(filepath)

    # Parse cycle and timestamp from filename
    m = re.match(r'snapshot_(\d+)_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json', fname)
    cycle = raw.get('dream_cycle', int(m.group(1)) if m else 0)
    taken = raw.get('exported_at', '')
    if not taken and m:
        taken = f"{m.group(2)}-{m.group(3)}-{m.group(4)} {m.group(5)}:{m.group(6)}:{m.group(7)} UTC"

    raw_nodes = raw.get('nodes', [])
    raw_edges = raw.get('edges', [])

    # Compute positions
    positions = compute_positions(raw_nodes, raw_edges)

    # Convert nodes
    nodes = []
    for n in raw_nodes:
        pos = positions.get(n['id'], {'x': CENTER_X, 'y': CENTER_Y})
        node = {
            'id': n['id'],
            'x': pos['x'],
            'y': pos['y'],
            'seed': bool(n.get('is_seed', False)),
            't': n.get('type', 'unknown'),
            'c': n.get('content', ''),
        }
        u = node_url(n, urls, default_seed_url)
        if u:
            node['u'] = u
        nodes.append(node)

    # Convert edges
    edges = []
    for e in raw_edges:
        edges.append({
            's': e.get('src', e.get('s')),
            'd': e.get('dst', e.get('d')),
            'disc': bool(e.get('is_discovery', False)),
            'cross': bool(e.get('crosses_boundary', False)),
            'src_kind': e.get('type', e.get('src_kind', 'related')),
            'w': e.get('weight', 0),
        })

    # Interval info
    prev = raw.get('prev_snapshot')
    interval = {
        'has': prev is not None and prev != '',
        'total': raw.get('node_count', len(raw_nodes)),
        'alive': sum(1 for n in raw_nodes if n.get('active', True)),
        'died': sum(1 for n in raw_nodes if not n.get('active', True)),
        'since': str(prev) if prev else '',
    }

    return {
        'classified': False,
        'cycle': cycle,
        'taken': taken,
        'file': fname,
        'nodes': nodes,
        'edges': edges,
        'n_nodes': len(nodes),
        'n_edges': len(edges),
        'disc_now': raw.get('discovery_edges', 0) if isinstance(raw.get('discovery_edges'), int) else len([e for e in raw_edges if e.get('is_new')]),
        'cross_now': raw.get('discovery_edges_crossing', 0) if isinstance(raw.get('discovery_edges_crossing'), int) else len([e for e in raw_edges if e.get('crosses_boundary') and e.get('is_new')]),
        'scaffold': raw.get('scaffold_edges', 0) if isinstance(raw.get('scaffold_edges'), int) else 0,
        'interval': interval,
    }


def main():
    files = sorted(glob.glob(os.path.join(SNAPSHOT_DIR, 'snapshot_*.json')))
    print(f'Found {len(files)} snapshot files')
    urls, default_seed_url = load_node_urls()

    frames = []
    for filepath in files:
        print(f'  Converting {os.path.basename(filepath)}...')
        frame = convert_snapshot(filepath, urls, default_seed_url)
        frames.append(frame)
        print(f'    cycle={frame["cycle"]}, nodes={frame["n_nodes"]}, edges={frame["n_edges"]}')

    # Write output
    js_content = f'const FRAMES = {json.dumps(frames, separators=(",", ":"))};\n'
    with open(OUTPUT, 'w') as f:
        f.write(js_content)

    print(f'\nWrote {OUTPUT}: {len(frames)} frames, {len(js_content)} bytes')

    graph = frame_to_graph_data(frames[-1])
    graph['meta']['frames'] = len(frames)
    with open(GRAPH_OUTPUT, 'w') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
        f.write('\n')
    missing = sum(1 for n in graph['nodes'] if not n.get('source_url'))
    print(f'Wrote {GRAPH_OUTPUT}: {len(graph["nodes"])} nodes, {len(graph["edges"])} edges '
          f'from {frames[-1]["file"]} ({missing} nodes without source_url)')


if __name__ == '__main__':
    main()
