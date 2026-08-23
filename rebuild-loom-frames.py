"""
Rebuild loom-frames.js from raw snapshot files in loom-snapshots/.

For each snapshot:
  1. Read the raw JSON
  2. Convert to FRAMES format (compact node/edge representation)
  3. Compute layout positions (spiral for seeds, spring from seeds for neighbors)
  4. Write consolidated loom-frames.js

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


def convert_snapshot(filepath):
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
        nodes.append({
            'id': n['id'],
            'x': pos['x'],
            'y': pos['y'],
            'seed': bool(n.get('is_seed', False)),
            't': n.get('type', 'unknown'),
            'c': n.get('content', ''),
        })

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

    frames = []
    for filepath in files:
        print(f'  Converting {os.path.basename(filepath)}...')
        frame = convert_snapshot(filepath)
        frames.append(frame)
        print(f'    cycle={frame["cycle"]}, nodes={frame["n_nodes"]}, edges={frame["n_edges"]}')

    # Write output
    js_content = f'const FRAMES = {json.dumps(frames, separators=(",", ":"))};\n'
    with open(OUTPUT, 'w') as f:
        f.write(js_content)

    print(f'\nWrote {OUTPUT}: {len(frames)} frames, {len(js_content)} bytes')


if __name__ == '__main__':
    main()
