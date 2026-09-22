#!/usr/bin/env python3
"""
Push 2-hop+ Sammy nodes outside the concave hull of the 1-hop core.

Three-phase algorithm (see DESIGN.md):
1. Concave hull (alpha shape) of 1-hop core positions
2. Equal-area radial mapping — preserves angular position, redistributes
   radial distance so nodes spread evenly by area
3. Tangential repulsion — slides nodes around circumference into empty
   sectors without disrupting radial distribution
"""

import json
import math
import numpy as np
from scipy.spatial import Delaunay, ConvexHull
from collections import defaultdict

INFILE = 'sammy-graph-data-v2.json.backup-pre-hull'
OUTFILE = 'sammy-graph-data-v2.json'

ALPHA = 200
GAP = 200
R_OUTER = 3000
TANGENTIAL_SEP = 80
HULL_CLEARANCE = 180
REPULSION_ITERS = 200


def build_adj(data):
    adj = defaultdict(set)
    for e in data['edges']:
        adj[e['source']].add(e['target'])
        adj[e['target']].add(e['source'])
    return adj


def get_1hop_set(data):
    adj = build_adj(data)
    seeds = {n['id'] for n in data['nodes'] if n.get('origin') == 'agentworld'}
    hop1 = set(seeds)
    for s in seeds:
        hop1 |= adj[s]
    return hop1


def alpha_shape_boundary(points, alpha):
    if len(points) < 3:
        return points

    tri = Delaunay(points)

    edge_count = defaultdict(int)
    for simplex in tri.simplices:
        pts = points[simplex]
        a = np.linalg.norm(pts[0] - pts[1])
        b = np.linalg.norm(pts[1] - pts[2])
        c = np.linalg.norm(pts[2] - pts[0])
        s = (a + b + c) / 2
        area_sq = s * (s-a) * (s-b) * (s-c)
        if area_sq <= 0:
            continue
        area = np.sqrt(area_sq)
        circum_r = (a * b * c) / (4 * area)
        if circum_r < alpha:
            for i, j in [(0,1), (1,2), (2,0)]:
                edge = tuple(sorted([simplex[i], simplex[j]]))
                edge_count[edge] += 1

    boundary_edges = [e for e, c in edge_count.items() if c == 1]

    if not boundary_edges:
        ch = ConvexHull(points)
        return points[ch.vertices]

    adj = defaultdict(list)
    for a, b in boundary_edges:
        adj[a].append(b)
        adj[b].append(a)

    start = boundary_edges[0][0]
    ordered = [start]
    visited = {start}
    current = start
    while True:
        found = False
        for nxt in adj[current]:
            if nxt not in visited:
                ordered.append(nxt)
                visited.add(nxt)
                current = nxt
                found = True
                break
        if not found:
            break

    return points[ordered]


def point_in_polygon(px, py, poly):
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def hull_radius_at_angle(centroid, hull_poly, angle):
    """Find the distance from centroid to the hull boundary at a given angle."""
    cx, cy = centroid
    far = 10000
    ray_end_x = cx + far * math.cos(angle)
    ray_end_y = cy + far * math.sin(angle)

    best_dist = float('inf')
    n = len(hull_poly)
    for i in range(n):
        ax, ay = hull_poly[i]
        bx, by = hull_poly[(i + 1) % n]

        dx_r, dy_r = ray_end_x - cx, ray_end_y - cy
        dx_s, dy_s = bx - ax, by - ay
        denom = dx_r * dy_s - dy_r * dx_s
        if abs(denom) < 1e-10:
            continue

        dx_ca, dy_ca = ax - cx, ay - cy
        t = (dx_ca * dy_s - dy_ca * dx_s) / denom
        u = (dx_ca * dy_r - dy_ca * dx_r) / denom

        if t > 0 and 0 <= u <= 1:
            hit_x = cx + t * dx_r
            hit_y = cy + t * dy_r
            d = math.sqrt((hit_x - cx)**2 + (hit_y - cy)**2)
            if d < best_dist:
                best_dist = d

    return best_dist if best_dist < far else 300


def main():
    with open(INFILE) as f:
        data = json.load(f)

    hop1_ids = get_1hop_set(data)
    print(f"1-hop core: {len(hop1_ids)} nodes")

    hop1_nodes = [n for n in data['nodes'] if n['id'] in hop1_ids]
    hop1_pts = np.array([[n['x'], n['y']] for n in hop1_nodes])
    centroid = hop1_pts.mean(axis=0)
    cx, cy = centroid
    print(f"Centroid: ({cx:.1f}, {cy:.1f})")

    # --- Phase 1: Concave hull ---
    hull_poly = alpha_shape_boundary(hop1_pts, ALPHA)
    print(f"Concave hull: {len(hull_poly)} vertices")

    # --- Phase 2: Equal-area radial mapping ---
    outer_nodes = [n for n in data['nodes'] if n['id'] not in hop1_ids]
    print(f"Outer nodes: {len(outer_nodes)}")

    # Compute angle and original distance from centroid for each outer node
    outer_info = []
    for n in outer_nodes:
        dx, dy = n['x'] - cx, n['y'] - cy
        angle = math.atan2(dy, dx)
        orig_dist = math.sqrt(dx*dx + dy*dy)
        hull_r = hull_radius_at_angle(centroid, hull_poly, angle)
        beyond = max(0, orig_dist - hull_r)
        outer_info.append({
            'node': n,
            'angle': angle,
            'orig_dist': orig_dist,
            'hull_r': hull_r,
            'beyond': beyond,
        })

    # Rank by how far beyond hull they originally sat
    outer_info.sort(key=lambda x: x['beyond'])

    # Equal-area radial mapping
    n_outer = len(outer_info)
    for rank, info in enumerate(outer_info):
        angle = info['angle']
        r_inner = info['hull_r'] + GAP
        rank_fraction = (rank + 0.5) / n_outer
        r = math.sqrt(r_inner**2 + rank_fraction * (R_OUTER**2 - r_inner**2))
        info['node']['x'] = cx + r * math.cos(angle)
        info['node']['y'] = cy + r * math.sin(angle)

    print(f"Phase 2: mapped {n_outer} nodes to equal-area ring [hull+{GAP}, {R_OUTER}]")

    # --- Phase 3: Tangential repulsion ---
    print(f"Phase 3: tangential repulsion ({REPULSION_ITERS} iterations, min sep {TANGENTIAL_SEP}px)...")

    for iteration in range(REPULSION_ITERS):
        moves = 0
        for i in range(len(outer_nodes)):
            for j in range(i + 1, len(outer_nodes)):
                dx = outer_nodes[i]['x'] - outer_nodes[j]['x']
                dy = outer_nodes[i]['y'] - outer_nodes[j]['y']
                d = math.sqrt(dx*dx + dy*dy)
                if d < TANGENTIAL_SEP and d > 0.01:
                    force = (TANGENTIAL_SEP - d) * 0.3

                    # Decompose into radial and tangential relative to centroid
                    # Unit vector between nodes
                    ux, uy = dx / d, dy / d

                    # For node i: radial direction from centroid
                    ri_x = outer_nodes[i]['x'] - cx
                    ri_y = outer_nodes[i]['y'] - cy
                    ri_len = math.sqrt(ri_x**2 + ri_y**2)
                    if ri_len < 0.01:
                        continue
                    ri_x /= ri_len
                    ri_y /= ri_len

                    # Radial component of repulsion force for node i
                    radial_dot_i = ux * ri_x + uy * ri_y
                    # Tangential component
                    tang_x_i = ux - radial_dot_i * ri_x
                    tang_y_i = uy - radial_dot_i * ri_y

                    # Apply tangential fully, radial only if outward
                    fx_i = tang_x_i * force
                    fy_i = tang_y_i * force
                    if radial_dot_i > 0:
                        fx_i += radial_dot_i * ri_x * force
                        fy_i += radial_dot_i * ri_y * force

                    outer_nodes[i]['x'] += fx_i
                    outer_nodes[i]['y'] += fy_i

                    # For node j: opposite direction
                    rj_x = outer_nodes[j]['x'] - cx
                    rj_y = outer_nodes[j]['y'] - cy
                    rj_len = math.sqrt(rj_x**2 + rj_y**2)
                    if rj_len < 0.01:
                        continue
                    rj_x /= rj_len
                    rj_y /= rj_len

                    radial_dot_j = -ux * rj_x + (-uy) * rj_y
                    tang_x_j = -ux - radial_dot_j * rj_x
                    tang_y_j = -uy - radial_dot_j * rj_y

                    fx_j = tang_x_j * force
                    fy_j = tang_y_j * force
                    if radial_dot_j > 0:
                        fx_j += radial_dot_j * rj_x * force
                        fy_j += radial_dot_j * rj_y * force

                    outer_nodes[j]['x'] += fx_j
                    outer_nodes[j]['y'] += fy_j

                    moves += 1

        # Hull clearance enforcement after each iteration
        enforced = 0
        for n in outer_nodes:
            dx, dy = n['x'] - cx, n['y'] - cy
            angle = math.atan2(dy, dx)
            dist = math.sqrt(dx*dx + dy*dy)
            hull_r = hull_radius_at_angle(centroid, hull_poly, angle)
            min_r = hull_r + HULL_CLEARANCE
            if dist < min_r:
                n['x'] = cx + min_r * math.cos(angle)
                n['y'] = cy + min_r * math.sin(angle)
                enforced += 1

        if iteration % 50 == 0:
            print(f"  iter {iteration}: {moves} repulsions, {enforced} hull-clearance enforcements")
        if moves == 0:
            print(f"  Converged at iteration {iteration}")
            break

    # --- Verification ---
    outer_pts = np.array([[n['x'], n['y']] for n in outer_nodes])
    outer_dists = np.sqrt(((outer_pts - centroid)**2).sum(axis=1))
    still_inside = sum(1 for n in outer_nodes if point_in_polygon(n['x'], n['y'], hull_poly))

    xs = [n['x'] for n in data['nodes']]
    ys = [n['y'] for n in data['nodes']]

    print(f"\nVerification:")
    print(f"  Outer nodes still inside hull: {still_inside}")
    print(f"  Outer centroid distance: [{outer_dists.min():.0f}, {outer_dists.max():.0f}]")
    print(f"  X range: [{min(xs):.0f}, {max(xs):.0f}]")
    print(f"  Y range: [{min(ys):.0f}, {max(ys):.0f}]")
    print(f"  0 nodes inside hull: {'PASS' if still_inside == 0 else 'FAIL'}")

    with open(OUTFILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\nWritten to {OUTFILE}")


if __name__ == '__main__':
    main()
