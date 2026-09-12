#!/usr/bin/env node
/**
 * Pre-compute graph layout positions headlessly.
 * Writes x/y coordinates into graph-data.json so the browser
 * can use `preset` layout (instant, zero computation for readers).
 *
 * Usage:
 *   node precompute-layout.js                    # defaults to graph-data.json
 *   node precompute-layout.js path/to/data.json  # any graph file
 *   node precompute-layout.js data.json --layout fcose
 *   node precompute-layout.js data.json --width 1200 --height 800
 *
 * Reusable across graphs (Isotopy, Loom, Sammy, etc).
 */

const fs = require('fs');
const path = require('path');
const cytoscape = require('cytoscape');

const args = process.argv.slice(2);
let inputFile = 'graph-data.json';
let layoutName = 'cose';
let width = 1400;
let height = 900;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--layout' && args[i + 1]) { layoutName = args[++i]; }
  else if (args[i] === '--width' && args[i + 1]) { width = parseInt(args[++i]); }
  else if (args[i] === '--height' && args[i + 1]) { height = parseInt(args[++i]); }
  else if (!args[i].startsWith('--')) { inputFile = args[i]; }
}

const filePath = path.resolve(inputFile);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
console.log(`Loaded ${data.nodes.length} nodes, ${data.edges.length} edges from ${inputFile}`);

const elements = [];
const degreeMap = {};

for (const e of data.edges) {
  degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
  degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
}

for (const n of data.nodes) {
  elements.push({ data: { id: n.id, degree: degreeMap[n.id] || 0 } });
}
for (const e of data.edges) {
  elements.push({ data: { source: e.source, target: e.target } });
}

const layoutOptions = {
  cose: {
    name: 'cose',
    animate: false,
    nodeRepulsion: () => 280000,
    idealEdgeLength: () => 55,
    gravity: 0.25,
    gravityRange: 3.8,
    numIter: 800,
    randomize: true,
    fit: true,
    padding: 20,
    nestingFactor: 1.2,
    edgeElasticity: () => 45,
    boundingBox: { x1: 0, y1: 0, w: width, h: height },
  },
};

const layoutOpts = layoutOptions[layoutName] || { name: layoutName, animate: false, fit: true, boundingBox: { x1: 0, y1: 0, w: width, h: height } };

// === TWO-PASS LAYOUT (when AGENTWORLD seeds exist) or SINGLE-PASS (otherwise) ===

const adjList = {};
for (const e of data.edges) {
  if (!adjList[e.source]) adjList[e.source] = [];
  if (!adjList[e.target]) adjList[e.target] = [];
  adjList[e.source].push(e.target);
  adjList[e.target].push(e.source);
}

const hopDist = {};
const seeds = data.nodes.filter(n => n.origin === 'agentworld').map(n => n.id);
const singlePass = seeds.length === 0;

if (singlePass) {
  // No AGENTWORLD seeds — single-pass cose on full graph
  console.log(`No AGENTWORLD seeds — single-pass ${layoutName} on all ${elements.filter(e => !e.data.source).length} nodes...`);
  const cy = cytoscape({ headless: true, styleEnabled: false, elements });
  cy.layout({
    ...layoutOpts,
    nodeRepulsion: () => 180000,
    idealEdgeLength: () => 65,
    gravity: 0.35,
    numIter: 1000,
  }).run();

  const positions = {};
  let updated = 0;
  cy.nodes().forEach(n => {
    const pos = n.position();
    positions[n.id()] = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 };
  });

  for (const node of data.nodes) {
    const pos = positions[node.id];
    if (pos) { node.x = pos.x; node.y = pos.y; updated++; }
  }

  // Label placement (same as two-pass version)
  const LABEL_FONT_SIZE = 10;
  const CHAR_WIDTH = 6;
  const LABEL_HEIGHT = 14;
  const LABEL_PAD = 4;
  const MIN_DEGREE_FOR_LABEL = 2;

  function nodeRadius(id) {
    const d = degreeMap[id] || 0;
    return 9 + (d / 20) * 12;
  }
  function labelWidth(id) {
    const text = id.length > 35 ? id.slice(0, 33) + '…' : id;
    return text.length * CHAR_WIDTH + LABEL_PAD * 2;
  }
  const ANGLES = [0, -Math.PI/4, -Math.PI/2, -3*Math.PI/4, Math.PI, 3*Math.PI/4, Math.PI/2, Math.PI/4];
  function rectsOverlap(a, b) { return !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1); }
  function overlapArea(a, b) {
    if (!rectsOverlap(a, b)) return 0;
    return (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * (Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  }
  function circleRectOverlap(circle, rect) {
    const cx2 = Math.max(rect.x1, Math.min(circle.cx, rect.x2));
    const cy2 = Math.max(rect.y1, Math.min(circle.cy, rect.y2));
    return ((circle.cx - cx2) ** 2 + (circle.cy - cy2) ** 2) < circle.r ** 2 ? 1 : 0;
  }

  const labeledNodes = data.nodes
    .filter(n => (degreeMap[n.id] || 0) >= MIN_DEGREE_FOR_LABEL && n.x !== undefined)
    .sort((a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0));
  const placedLabels = [];
  const nodeCircles = data.nodes.filter(n => n.x !== undefined).map(n => ({ cx: n.x, cy: n.y, r: nodeRadius(n.id) }));

  for (const node of labeledNodes) {
    const lw = labelWidth(node.id);
    const r = nodeRadius(node.id);
    const gap = r + 8;
    let bestScore = Infinity, bestDx = gap + 4, bestDy = 3;

    for (const angle of ANGLES) {
      const dx = Math.cos(angle) * gap, dy = Math.sin(angle) * gap;
      let lx1 = Math.abs(Math.cos(angle)) > 0.3 ? (Math.cos(angle) > 0 ? node.x + dx : node.x + dx - lw) : node.x - lw / 2;
      const ly1 = node.y + dy - LABEL_HEIGHT / 2;
      const rect = { x1: lx1, y1: ly1, x2: lx1 + lw, y2: ly1 + LABEL_HEIGHT };
      let score = 0;
      for (const pl of placedLabels) score += overlapArea(rect, pl) * 10;
      for (const nc of nodeCircles) score += circleRectOverlap(nc, rect) * 50;
      if (score < bestScore) {
        bestScore = score;
        bestDx = Math.round((lx1 - node.x + lw/2) * 100) / 100;
        bestDy = Math.round((ly1 - node.y + LABEL_HEIGHT/2) * 100) / 100;
        if (score === 0) break;
      }
    }
    placedLabels.push({ x1: node.x + bestDx - lw/2, y1: node.y + bestDy - LABEL_HEIGHT/2, x2: node.x + bestDx + lw/2, y2: node.y + bestDy + LABEL_HEIGHT/2 });
    node.labelDx = bestDx;
    node.labelDy = bestDy;
  }

  console.log(`Label positions computed for ${labeledNodes.length} nodes.`);
  data._layout = { algorithm: layoutName, width, height, computed: new Date().toISOString(), nodeCount: data.nodes.length, edgeCount: data.edges.length, labeledNodes: labeledNodes.length };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Wrote positions for ${updated}/${data.nodes.length} nodes to ${inputFile}`);
  process.exit(0);
}

// Two-pass layout with AGENTWORLD seeds
for (const s of seeds) hopDist[s] = 0;
let frontier = [...seeds];
for (let d = 1; d <= 2; d++) {
  const nxt = [];
  for (const nd of frontier) {
    for (const nb of (adjList[nd] || [])) {
      if (!(nb in hopDist)) { hopDist[nb] = d; nxt.push(nb); }
    }
  }
  frontier = nxt;
}

const hop1Nodes = new Set(Object.keys(hopDist).filter(id => hopDist[id] <= 1));
const hop2Nodes = new Set(Object.keys(hopDist).filter(id => hopDist[id] === 2));
const nodeSet = new Set(data.nodes.map(n => n.id));

console.log(`Hop counts: ${seeds.length} seeds, ${hop1Nodes.size} at 1-hop, ${hop2Nodes.size} at 2-hop`);

// Pass 1: layout only 1-hop nodes
const elements1 = [];
for (const n of data.nodes) {
  if (hop1Nodes.has(n.id)) {
    elements1.push({ data: { id: n.id, degree: degreeMap[n.id] || 0 } });
  }
}
for (const e of data.edges) {
  if (hop1Nodes.has(e.source) && hop1Nodes.has(e.target)) {
    elements1.push({ data: { source: e.source, target: e.target } });
  }
}

// Pass 1: Iso-style cose on 1-hop. For sparse cores (Sammy), use a mid-size
// bbox so the hull perimeter is long enough for an even surrounding arc.
const hop1Count = elements1.filter(e => !e.data.source).length;
const coreScale = hop1Count < 80 ? 0.72 : 1;
const coreW = Math.round(width * coreScale);
const coreH = Math.round(height * coreScale);
const coreBB = {
  x1: Math.round((width - coreW) / 2),
  y1: Math.round((height - coreH) / 2),
  w: coreW,
  h: coreH,
};
const pass1Opts = {
  ...layoutOpts,
  nodeRepulsion: () => hop1Count < 80 ? 220000 : 280000,
  idealEdgeLength: () => hop1Count < 80 ? 58 : 55,
  gravity: hop1Count < 80 ? 0.35 : 0.25,
  gravityRange: hop1Count < 80 ? 3.0 : 3.8,
  boundingBox: coreBB,
};
console.log(`Pass 1: ${layoutName} on ${hop1Count} nodes (1-hop), core bbox ${coreW}x${coreH}...`);

const cy1 = cytoscape({ headless: true, styleEnabled: false, elements: elements1 });
cy1.layout(pass1Opts).run();

const positions = {};
cy1.nodes().forEach(n => {
  const pos = n.position();
  positions[n.id()] = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 };
});

// Pass 2: Iso knobs — longer ideal edges so 2-hop spreads before hull push
console.log(`Pass 2: adding ${hop2Nodes.size} 2-hop nodes with 1-hop locked...`);

const cy2 = cytoscape({ headless: true, styleEnabled: false, elements });

cy2.nodes().forEach(n => {
  const p = positions[n.id()];
  if (p) {
    n.position(p);
    n.lock();
  }
});

const pass2Opts = {
  ...layoutOpts,
  nodeRepulsion: () => 220000,
  idealEdgeLength: () => 85, // Iso used 70; slightly longer for Sammy density
  gravity: 0.12,
  numIter: 700,
  randomize: false,
};
cy2.layout(pass2Opts).run();

// Collect pass-2 positions for 2-hop nodes
cy2.nodes().forEach(n => {
  if (hop2Nodes.has(n.id())) {
    const pos = n.position();
    positions[n.id()] = { x: pos.x, y: pos.y };
  }
});

// === CONVEX HULL PUSH: place 2-hop nodes outside the 1-hop convex hull ===
// Layer-1 tuning knobs (declared early — hull may scale to fit LAYER1_CAP spacing).
const LAYER1_CAP = 200;
const PUSH_DIST = 140; // outward offset of the 1-hop convex hull (hug the core)
const PARK_PUSH = 800; // extra offset for deferred park path
const LAYER1_MIN_SPACING = 28; // only inflate the path if natural step falls below this
const LAYER1_LABEL_TOP = 48; // only top-N by degree get labels on the dense ring
// Layer-1 follows a rounded offset of the 1-hop convex hull (Sam's outline),
// with even arc-length spacing — not a circle, and not raw polygonal edges.

// Compute convex hull of 1-hop nodes (Andrew's monotone chain)
const hop1Points = [];
for (const id of hop1Nodes) {
  const p = positions[id];
  if (p) hop1Points.push({ x: p.x, y: p.y, id });
}
hop1Points.sort((a, b) => a.x - b.x || a.y - b.y);

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

const lower = [];
for (const p of hop1Points) {
  while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
  lower.push(p);
}
const upper = [];
for (let i = hop1Points.length - 1; i >= 0; i--) {
  const p = hop1Points[i];
  while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
  upper.push(p);
}
lower.pop(); upper.pop();
let hull = lower.concat(upper);

// Centroid of 1-hop nodes
let cx = 0, cy_val = 0;
for (const id of hop1Nodes) { const p = positions[id]; if (p) { cx += p.x; cy_val += p.y; } }
cx /= hop1Nodes.size; cy_val /= hop1Nodes.size;

// Keep the 1-hop core at its natural cose size. Spacing budget is absorbed by
// scaling the *offset path* from the centroid (shape preserved, core untouched).
let maxHop1R = 0;
for (const id of hop1Nodes) {
  const p = positions[id];
  if (!p) continue;
  maxHop1R = Math.max(maxHop1R, Math.sqrt((p.x - cx) ** 2 + (p.y - cy_val) ** 2));
}

console.log(`Convex hull: ${hull.length} vertices, centroid (${Math.round(cx)}, ${Math.round(cy_val)}), maxHop1R=${Math.round(maxHop1R)}`);

// For each hull edge, compute outward normal
function hullEdgeNormal(i) {
  const a = hull[i], b = hull[(i + 1) % hull.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { nx: dy / len, ny: -dx / len }; // outward normal (CCW hull)
}

// Ray-hull intersection: shoot ray from point along direction, find where it exits the hull
function rayHullExit(px, py, dx, dy) {
  let bestT = Infinity, bestEdgeIdx = -1, bestHitX = px, bestHitY = py;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((a.x - px) * ey - (a.y - py) * ex) / denom;
    const u = ((a.x - px) * dy - (a.y - py) * dx) / denom;
    if (t > 0 && u >= 0 && u <= 1) {
      if (t < bestT) {
        bestT = t;
        bestEdgeIdx = i;
        bestHitX = px + dx * t;
        bestHitY = py + dy * t;
      }
    }
  }
  return { hitX: bestHitX, hitY: bestHitY, edgeIdx: bestEdgeIdx, t: bestT };
}

// Group 2-hop nodes by their 1-hop neighbor(s) for fan-out
const neighborGroups = {};
for (const id of hop2Nodes) {
  const neighbors1 = (adjList[id] || []).filter(nb => hop1Nodes.has(nb) && positions[nb]);
  const key = neighbors1.length > 0
    ? neighbors1.sort().join('|')
    : '__orphan__';
  if (!neighborGroups[key]) neighborGroups[key] = [];
  neighborGroups[key].push(id);
}

// Layer-1 pass: ~200 nodes evenly around the 1-hop convex hull (Iso normals).
// Get the ring geometry right first; deferred nodes park far out for later layers.

// Pre-compute hull perimeter as a parameterized path
const hullPerim = [];
let totalPerim = 0;
for (let i = 0; i < hull.length; i++) {
  const a = hull[i], b = hull[(i + 1) % hull.length];
  const edgeLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  hullPerim.push({ startT: totalPerim, endT: totalPerim + edgeLen, edgeIdx: i, len: edgeLen });
  totalPerim += edgeLen;
}

// Get hull point + outward normal at parameter t (wraps around)
function hullPointAt(t) {
  t = ((t % totalPerim) + totalPerim) % totalPerim;
  for (const seg of hullPerim) {
    if (t <= seg.endT) {
      const frac = seg.len > 0 ? (t - seg.startT) / seg.len : 0;
      const a = hull[seg.edgeIdx], b = hull[(seg.edgeIdx + 1) % hull.length];
      const n = hullEdgeNormal(seg.edgeIdx);
      return {
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
        nx: n.nx, ny: n.ny,
      };
    }
  }
  return hullPointAt(0);
}

// Find parameter t for a hull exit point
function hullParamFor(hitX, hitY, edgeIdx) {
  if (edgeIdx < 0) return 0;
  const seg = hullPerim[edgeIdx];
  const a = hull[edgeIdx], b = hull[(edgeIdx + 1) % hull.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const frac = Math.abs(dx) > Math.abs(dy)
    ? (hitX - a.x) / (dx || 1)
    : (hitY - a.y) / (dy || 1);
  return seg.startT + Math.max(0, Math.min(1, frac || 0)) * seg.len;
}

// Candidate pool for surrounding layers: true 2-hop first, then beyond.
const beyondIdsAll = data.nodes.map(n => n.id).filter(id => !(id in hopDist));
const layerCandidates = [];
for (const [key, group] of Object.entries(neighborGroups)) {
  let anchorX, anchorY;
  if (key === '__orphan__') {
    anchorX = cx; anchorY = cy_val;
  } else {
    const nbs = key.split('|');
    anchorX = 0; anchorY = 0;
    for (const nb of nbs) { anchorX += positions[nb].x; anchorY += positions[nb].y; }
    anchorX /= nbs.length; anchorY /= nbs.length;
  }
  let dx = anchorX - cx, dy = anchorY - cy_val;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const { hitX, hitY, edgeIdx } = rayHullExit(cx, cy_val, dx, dy);
  const centerT = hullParamFor(hitX, hitY, edgeIdx);
  const ang = Math.atan2(dy, dx);
  for (const id of group) {
    layerCandidates.push({ id, preferT: centerT, ang, degree: degreeMap[id] || 0, pool: 'hop2' });
  }
}
// Beyond nodes: angle from centroid via any positioned neighbor, else hash angle
for (const id of beyondIdsAll) {
  const nbs = (adjList[id] || []).filter(nb => positions[nb]);
  let ang = 0, preferT = 0;
  if (nbs.length > 0) {
    let ax = 0, ay = 0;
    for (const nb of nbs) { ax += positions[nb].x; ay += positions[nb].y; }
    ax /= nbs.length; ay /= nbs.length;
    const dx = ax - cx, dy = ay - cy_val;
    ang = Math.atan2(dy, dx);
    preferT = ((ang + Math.PI) / (2 * Math.PI)) * totalPerim;
  } else {
    // Stable pseudo-angle from id so parks don't all stack
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    ang = (h / 0xffffffff) * Math.PI * 2 - Math.PI;
    preferT = ((ang + Math.PI) / (2 * Math.PI)) * totalPerim;
  }
  layerCandidates.push({ id, preferT, ang, degree: degreeMap[id] || 0, pool: 'beyond' });
}

// Layer 1: top LAYER1_CAP by degree (prefer hop2), then even perimeter slots.
const layer1Pool = layerCandidates
  .filter(c => c.pool === 'hop2')
  .sort((a, b) => b.degree - a.degree || a.ang - b.ang);
const layer1 = layer1Pool.slice(0, Math.min(LAYER1_CAP, layer1Pool.length));
const deferred = [
  ...layer1Pool.slice(layer1.length),
  ...layerCandidates.filter(c => c.pool === 'beyond'),
];

// Rounded outward offset of the convex hull: straight segments parallel to each
// hull edge, circular arcs at vertices (Minkowski sum with a disk). Even
// arc-length samples → hull-shaped ring without polygonal line-clumps.
function buildRoundedOffsetPath(poly, dist) {
  const segs = [];
  const n = poly.length;
  if (n < 3 || dist < 0) return segs;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    normals.push({ nx: dy / len, ny: -dx / len }); // outward for CCW
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const nrm = normals[i];
    const x0 = a.x + nrm.nx * dist, y0 = a.y + nrm.ny * dist;
    const x1 = b.x + nrm.nx * dist, y1 = b.y + nrm.ny * dist;
    const lineLen = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    segs.push({ type: 'line', x0, y0, x1, y1, len: lineLen, nx: nrm.nx, ny: nrm.ny });

    const nNext = normals[(i + 1) % n];
    const a0 = Math.atan2(nrm.ny, nrm.nx);
    const a1 = Math.atan2(nNext.ny, nNext.nx);
    let sweep = a1 - a0;
    while (sweep < 0) sweep += 2 * Math.PI;
    while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
    segs.push({
      type: 'arc',
      cx: b.x, cy: b.y, r: dist,
      a0, sweep,
      len: dist * sweep,
    });
  }
  return segs;
}

function pathTotalLength(segs) {
  return segs.reduce((s, seg) => s + seg.len, 0);
}

function pointOnOffsetPath(segs, t) {
  const total = pathTotalLength(segs);
  if (total <= 0 || segs.length === 0) return { x: cx, y: cy_val, nx: 1, ny: 0 };
  t = ((t % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const atEnd = i === segs.length - 1;
    if (t <= acc + seg.len || atEnd) {
      const u = seg.len > 0 ? Math.min(1, Math.max(0, (t - acc) / seg.len)) : 0;
      if (seg.type === 'line') {
        return {
          x: seg.x0 + (seg.x1 - seg.x0) * u,
          y: seg.y0 + (seg.y1 - seg.y0) * u,
          nx: seg.nx, ny: seg.ny,
        };
      }
      const ang = seg.a0 + seg.sweep * u;
      return {
        x: seg.cx + Math.cos(ang) * seg.r,
        y: seg.cy + Math.sin(ang) * seg.r,
        nx: Math.cos(ang), ny: Math.sin(ang),
      };
    }
    acc += seg.len;
  }
  return pointOnOffsetPath(segs, 0);
}

function scaleFromCentroid(pt, s) {
  return {
    x: cx + (pt.x - cx) * s,
    y: cy_val + (pt.y - cy_val) * s,
    nx: pt.nx,
    ny: pt.ny,
  };
}

const offsetPath = buildRoundedOffsetPath(hull, PUSH_DIST);
const offsetLen0 = pathTotalLength(offsetPath);
// Prefer true hull offset (scale≈1) so the ring keeps the core's irregular shape.
// Inflate only when nodes would pack tighter than LAYER1_MIN_SPACING.
const naturalStep = LAYER1_CAP > 0 ? offsetLen0 / LAYER1_CAP : offsetLen0;
const targetPerim = naturalStep >= LAYER1_MIN_SPACING
  ? offsetLen0
  : LAYER1_CAP * LAYER1_MIN_SPACING;
const pathScale = offsetLen0 > 1 ? targetPerim / offsetLen0 : 1;
const parkPath = buildRoundedOffsetPath(hull, PUSH_DIST + PARK_PUSH);
const parkLen0 = pathTotalLength(parkPath);
const parkScale = Math.max(pathScale * 1.2, parkLen0 > 1 ? (Math.max(parkLen0, targetPerim * 1.4)) / parkLen0 : pathScale);

console.log(`Rounded-hull offset: rawPerim=${Math.round(offsetLen0)}, naturalStep≈${Math.round(naturalStep)}px, scale×${pathScale.toFixed(2)} → perim ${Math.round(targetPerim)}.`);

layer1.sort((a, b) => a.ang - b.ang);
const layer1Ids = new Set();
const layer1Step = layer1.length > 0 ? offsetLen0 / layer1.length : 1;
for (let i = 0; i < layer1.length; i++) {
  const raw = pointOnOffsetPath(offsetPath, (i + 0.5) * layer1Step);
  const pt = scaleFromCentroid(raw, pathScale);
  positions[layer1[i].id] = { x: pt.x, y: pt.y };
  layer1Ids.add(layer1[i].id);
}
const layer1Chord = pathScale * layer1Step; // arc length on scaled path
console.log(`Layer 1: ${layer1.length} nodes on rounded-hull path (step≈${Math.round(layer1Chord)}px).`);
console.log(`Deferred for later layers: ${deferred.length} (hop2 left=${layer1Pool.length - layer1.length}, beyond=${beyondIdsAll.length}).`);

deferred.sort((a, b) => a.ang - b.ang);
const parkStep = deferred.length > 0 ? parkLen0 / deferred.length : 1;
for (let i = 0; i < deferred.length; i++) {
  const raw = pointOnOffsetPath(parkPath, (i + 0.5) * parkStep);
  const pt = scaleFromCentroid(raw, parkScale);
  positions[deferred[i].id] = { x: pt.x, y: pt.y };
}

// Light tangential separation, then re-slot to exact equal arc-length on the path.
const hop2Ids = [...layer1Ids].filter(id => positions[id]);
const anchorPositions = {};
for (const id of hop2Ids) {
  anchorPositions[id] = { x: positions[id].x, y: positions[id].y };
}

function nearestPathParam(px, py) {
  // Sample the scaled path; good enough for snap (path is smooth).
  const samples = Math.max(64, hop2Ids.length * 2);
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i < samples; i++) {
    const raw = pointOnOffsetPath(offsetPath, (i / samples) * offsetLen0);
    const pt = scaleFromCentroid(raw, pathScale);
    const d = (pt.x - px) ** 2 + (pt.y - py) ** 2;
    if (d < bestD) { bestD = d; bestT = (i / samples) * offsetLen0; }
  }
  return bestT;
}

function snapToLayer1Ring(id) {
  const p = positions[id];
  const t = nearestPathParam(p.x, p.y);
  const pt = scaleFromCentroid(pointOnOffsetPath(offsetPath, t), pathScale);
  positions[id] = { x: pt.x, y: pt.y };
}

const REPEL_RADIUS = Math.max(layer1Chord * 1.25, 50);
const REPEL_STRENGTH = 12;
const SPRING_STRENGTH = 0.2;
const ITERATIONS = 120;

console.log(`Layer-1 path repulsion: ${hop2Ids.length} nodes, repelR=${Math.round(REPEL_RADIUS)}...`);

for (let iter = 0; iter < ITERATIONS; iter++) {
  for (const id of hop2Ids) {
    let fx = 0, fy = 0;
    const p = positions[id];
    let rx = p.x - cx, ry = p.y - cy_val;
    const rlen = Math.sqrt(rx * rx + ry * ry) || 1;
    rx /= rlen; ry /= rlen;

    for (const otherId of hop2Ids) {
      if (otherId === id) continue;
      const o = positions[otherId];
      const dx = p.x - o.x, dy = p.y - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPEL_RADIUS && dist > 0.1) {
        const force = REPEL_STRENGTH * (1 - dist / REPEL_RADIUS);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }

    const anchor = anchorPositions[id];
    fx += (anchor.x - p.x) * SPRING_STRENGTH;
    fy += (anchor.y - p.y) * SPRING_STRENGTH;

    const radial = fx * rx + fy * ry;
    fx -= radial * rx;
    fy -= radial * ry;

    positions[id] = { x: p.x + fx, y: p.y + fy };
    snapToLayer1Ring(id);
  }
}

// Final equal arc-length reslot on the rounded-hull path (kills leftover clumps).
{
  const ordered = hop2Ids
    .map(id => ({ id, t: nearestPathParam(positions[id].x, positions[id].y) }))
    .sort((a, b) => a.t - b.t);
  for (let i = 0; i < ordered.length; i++) {
    const raw = pointOnOffsetPath(offsetPath, (i + 0.5) * layer1Step);
    const pt = scaleFromCentroid(raw, pathScale);
    positions[ordered[i].id] = { x: pt.x, y: pt.y };
    anchorPositions[ordered[i].id] = { ...positions[ordered[i].id] };
  }
  console.log(`Layer-1 equal-arc reslot: ${ordered.length} nodes on rounded hull (scale×${pathScale.toFixed(2)}).`);
}

// Round all positions
for (const id of hop1Nodes) {
  if (positions[id]) {
    positions[id].x = Math.round(positions[id].x * 100) / 100;
    positions[id].y = Math.round(positions[id].y * 100) / 100;
  }
}
for (const id of hop2Ids) {
  positions[id].x = Math.round(positions[id].x * 100) / 100;
  positions[id].y = Math.round(positions[id].y * 100) / 100;
}

let updated = 0;
for (const node of data.nodes) {
  const pos = positions[node.id];
  if (pos) {
    node.x = pos.x;
    node.y = pos.y;
    updated++;
  }
}

// === LABEL PLACEMENT (greedy 8-position with overlap avoidance) ===

const LABEL_FONT_SIZE = 10;
const CHAR_WIDTH = 6;
const LABEL_HEIGHT = 14;
const LABEL_PAD = 4;
const MIN_DEGREE_FOR_LABEL = 3;

// Layer-1 ring is dense — only the highest-degree ring nodes get labels.
const layer1LabelAllow = new Set(
  [...layer1Ids]
    .sort((a, b) => (degreeMap[b] || 0) - (degreeMap[a] || 0) || a.localeCompare(b))
    .slice(0, LAYER1_LABEL_TOP)
);

const labeledNodes = data.nodes
  .filter(n => {
    if (n.x === undefined) return false;
    if (layer1Ids.has(n.id)) return layer1LabelAllow.has(n.id);
    return (degreeMap[n.id] || 0) >= MIN_DEGREE_FOR_LABEL;
  })
  .sort((a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0));

// Drop stale offsets so skipped ring nodes don't keep old labelDx/Dy.
for (const n of data.nodes) {
  delete n.labelDx;
  delete n.labelDy;
}

console.log(`Placing labels for ${labeledNodes.length} nodes (layer1 top ${LAYER1_LABEL_TOP}, else degree >= ${MIN_DEGREE_FOR_LABEL})...`);

function nodeRadius(id) {
  const d = degreeMap[id] || 0;
  return 9 + (d / 20) * 12; // matches mapData(degree,0,20,18,42) / 2
}

function labelWidth(id) {
  const text = id.length > 35 ? id.slice(0, 33) + '…' : id;
  return text.length * CHAR_WIDTH + LABEL_PAD * 2;
}

// 8 candidate positions: R, UR, U, UL, L, LL, D, LR
const ANGLES = [0, -Math.PI/4, -Math.PI/2, -3*Math.PI/4, Math.PI, 3*Math.PI/4, Math.PI/2, Math.PI/4];

function rectsOverlap(a, b) {
  return !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
}

function overlapArea(a, b) {
  if (!rectsOverlap(a, b)) return 0;
  const dx = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const dy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return dx * dy;
}

const placedLabels = [];
const nodeCircles = data.nodes.filter(n => n.x !== undefined).map(n => ({
  cx: n.x, cy: n.y, r: nodeRadius(n.id)
}));

function circleRectOverlap(circle, rect) {
  const cx = Math.max(rect.x1, Math.min(circle.cx, rect.x2));
  const cy = Math.max(rect.y1, Math.min(circle.cy, rect.y2));
  const dx = circle.cx - cx;
  const dy = circle.cy - cy;
  return (dx * dx + dy * dy) < (circle.r * circle.r) ? 1 : 0;
}

for (const node of labeledNodes) {
  const lw = labelWidth(node.id);
  const r = nodeRadius(node.id);
  const gap = r + (layer1Ids.has(node.id) ? 14 : 8);

  let bestScore = Infinity;
  let bestDx = gap + 4;
  let bestDy = 3;

  // Prefer outward (away from core) for layer-1 labels so they don't fill the ring.
  let angleOrder = ANGLES;
  if (layer1Ids.has(node.id)) {
    const outAng = Math.atan2(node.y - cy_val, node.x - cx);
    angleOrder = [...ANGLES].sort((a, b) => {
      const da = Math.abs(Math.atan2(Math.sin(a - outAng), Math.cos(a - outAng)));
      const db = Math.abs(Math.atan2(Math.sin(b - outAng), Math.cos(b - outAng)));
      return da - db;
    });
  }

  for (const angle of angleOrder) {
    const dx = Math.cos(angle) * gap;
    const dy = Math.sin(angle) * gap;

    let lx1, ly1;
    if (Math.abs(Math.cos(angle)) > 0.3) {
      lx1 = Math.cos(angle) > 0 ? node.x + dx : node.x + dx - lw;
    } else {
      lx1 = node.x - lw / 2;
    }
    ly1 = node.y + dy - LABEL_HEIGHT / 2;

    const rect = { x1: lx1, y1: ly1, x2: lx1 + lw, y2: ly1 + LABEL_HEIGHT };

    let score = 0;
    for (const pl of placedLabels) {
      score += overlapArea(rect, pl) * 10;
    }
    for (const nc of nodeCircles) {
      score += circleRectOverlap(nc, rect) * 50;
    }
    // Soft penalty for inward labels on the ring
    if (layer1Ids.has(node.id)) {
      const labelCx = lx1 + lw / 2;
      const labelCy = ly1 + LABEL_HEIGHT / 2;
      const nodeDist = Math.hypot(node.x - cx, node.y - cy_val);
      const labelDist = Math.hypot(labelCx - cx, labelCy - cy_val);
      if (labelDist < nodeDist) score += 30;
    }

    if (score < bestScore) {
      bestScore = score;
      bestDx = Math.round((lx1 - node.x + lw/2) * 100) / 100;
      bestDy = Math.round((ly1 - node.y + LABEL_HEIGHT/2) * 100) / 100;
      if (score === 0) break; // perfect placement, stop searching
    }
  }

  // Skip hopeless overlaps on the ring rather than stacking illegible text
  if (layer1Ids.has(node.id) && bestScore > 80) {
    continue;
  }

  const finalLw = lw;
  placedLabels.push({
    x1: node.x + bestDx - finalLw/2,
    y1: node.y + bestDy - LABEL_HEIGHT/2,
    x2: node.x + bestDx + finalLw/2,
    y2: node.y + bestDy + LABEL_HEIGHT/2,
  });

  node.labelDx = bestDx;
  node.labelDy = bestDy;
}

console.log(`Label positions computed for ${labeledNodes.length} nodes.`);

data._layout = {
  algorithm: layoutName,
  width,
  height,
  computed: new Date().toISOString(),
  nodeCount: data.nodes.length,
  edgeCount: data.edges.length,
  labeledNodes: labeledNodes.length,
  layer1: {
    cap: LAYER1_CAP,
    count: layer1.length,
    push: PUSH_DIST,
    parkPush: PARK_PUSH,
    deferred: deferred.length,
    labelTop: LAYER1_LABEL_TOP,
    shape: 'rounded-hull',
    pathScale: Math.round(pathScale * 1000) / 1000,
    pathPerim: Math.round(targetPerim),
    step: Math.round(layer1Chord * 100) / 100,
    hullVertices: hull.length,
    ids: layer1.map(c => c.id),
  },
};

fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log(`Wrote positions for ${updated}/${data.nodes.length} nodes back to ${inputFile}`);
console.log(`Layout metadata saved to _layout field.`);
