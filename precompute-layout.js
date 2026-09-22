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

// === CONVEX HULL PUSH: place 2-hop nodes in two concentric waves ===
// Wave-1 (inner ring): higher-degree 2-hop nodes, closer to core
// Wave-2 (outer ring): remaining 2-hop nodes, more label clearance
const PUSH_DIST = 110;        // clearance from outermost 1-hop node to wave-1
const WAVE_GAP = 100;         // radial gap between wave-1 and wave-2 rings
const PARK_GAP = 200;         // radial gap from wave-2 ring to beyond-node park ring
const TARGET_SPACING = 36;    // target chord length per node (readable labels)
const WAVE1_LABEL_TOP = 60;   // top-N by degree get labels on wave-1
const WAVE2_LABEL_TOP = 40;   // top-N by degree get labels on wave-2

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

console.log(`Convex hull: ${hull.length} vertices, centroid (${Math.round(cx)}, ${Math.round(cy_val)})`);

// === OFFSET HULL: push each hull edge outward along its normal ===
function hullEdgeNormal(h, i) {
  const a = h[i], b = h[(i + 1) % h.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { nx: dy / len, ny: -dx / len };
}

function offsetHull(h, dist) {
  const n = h.length;
  if (n < 3) return h.map(p => ({ x: p.x, y: p.y }));
  const offsetEdges = [];
  for (let i = 0; i < n; i++) {
    const norm = hullEdgeNormal(h, i);
    const a = h[i], b = h[(i + 1) % n];
    offsetEdges.push({
      ax: a.x + norm.nx * dist, ay: a.y + norm.ny * dist,
      bx: b.x + norm.nx * dist, by: b.y + norm.ny * dist,
    });
  }
  const verts = [];
  for (let i = 0; i < n; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % n];
    const d1x = e1.bx - e1.ax, d1y = e1.by - e1.ay;
    const d2x = e2.bx - e2.ax, d2y = e2.by - e2.ay;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) {
      verts.push({ x: e1.bx, y: e1.by });
    } else {
      const t = ((e2.ax - e1.ax) * d2y - (e2.ay - e1.ay) * d2x) / denom;
      verts.push({ x: e1.ax + d1x * t, y: e1.ay + d1y * t });
    }
  }
  return verts;
}

// Parameterize a hull's perimeter for even-spacing placement.
function parameterizeHull(h) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    segs.push({ startT: total, endT: total + len, idx: i, len });
    total += len;
  }
  return { segs, total };
}

// Get x,y at parameter t along a hull perimeter.
function hullPointAtT(h, param, t) {
  t = ((t % param.total) + param.total) % param.total;
  for (const seg of param.segs) {
    if (t <= seg.endT) {
      const frac = seg.len > 0 ? (t - seg.startT) / seg.len : 0;
      const a = h[seg.idx], b = h[(seg.idx + 1) % h.length];
      return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
    }
  }
  return { x: h[0].x, y: h[0].y };
}

// Snap a point onto the nearest position on an offset hull (project radially from centroid).
function snapToHull(h, param, px, py) {
  const dx = px - cx, dy = py - cy_val;
  const ang = Math.atan2(dy, dx);
  const rayLen = 1e6;
  const rx = Math.cos(ang) * rayLen, ry = Math.sin(ang) * rayLen;
  let bestT = Infinity, bestX = px, bestY = py, bestDist = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = rx * ey - ry * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((a.x - cx) * ey - (a.y - cy_val) * ex) / denom;
    const u = ((a.x - cx) * ry - (a.y - cy_val) * rx) / denom;
    if (t > 0 && u >= 0 && u <= 1) {
      const hx = cx + rx * t, hy = cy_val + ry * t;
      const d = Math.sqrt((hx - cx) ** 2 + (hy - cy_val) ** 2);
      if (Math.abs(d) < bestDist || bestDist === Infinity) {
        bestDist = d;
        bestX = hx; bestY = hy;
      }
    }
  }
  return { x: bestX, y: bestY };
}

// Compute offset hulls for each wave.
const wave1Hull = offsetHull(hull, PUSH_DIST);
const wave2Hull = offsetHull(hull, PUSH_DIST + WAVE_GAP);
const parkHull = offsetHull(hull, PUSH_DIST + WAVE_GAP + PARK_GAP);

const wave1Param = parameterizeHull(wave1Hull);
const wave2Param = parameterizeHull(wave2Hull);
const parkParam = parameterizeHull(parkHull);

console.log(`Wave 1 offset hull: perimeter ${Math.round(wave1Param.total)}px (offset ${PUSH_DIST})`);
console.log(`Wave 2 offset hull: perimeter ${Math.round(wave2Param.total)}px (offset ${PUSH_DIST + WAVE_GAP})`);
console.log(`Park hull: perimeter ${Math.round(parkParam.total)}px (offset ${PUSH_DIST + WAVE_GAP + PARK_GAP})`);

// Group 2-hop nodes by their 1-hop neighbor(s) — used for angular placement.
const neighborGroups = {};
for (const id of hop2Nodes) {
  const neighbors1 = (adjList[id] || []).filter(nb => hop1Nodes.has(nb) && positions[nb]);
  const key = neighbors1.length > 0
    ? neighbors1.sort().join('|')
    : '__orphan__';
  if (!neighborGroups[key]) neighborGroups[key] = [];
  neighborGroups[key].push(id);
}

// Compute preferred angle for each 2-hop node (toward its 1-hop neighbor).
const hop2Candidates = [];
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
  const ang = Math.atan2(dy, dx);
  for (const id of group) {
    hop2Candidates.push({ id, ang, degree: degreeMap[id] || 0 });
  }
}
hop2Candidates.sort((a, b) => b.degree - a.degree || a.ang - b.ang);

// Split 2-hop into two waves by degree. Wave 1 = higher-degree (inner), Wave 2 = rest (outer).
const half = Math.ceil(hop2Candidates.length / 2);
const wave1 = hop2Candidates.slice(0, half);
const wave2 = hop2Candidates.slice(half);

// Beyond nodes: angle from centroid via any positioned neighbor, else hash angle.
const beyondIdsAll = data.nodes.map(n => n.id).filter(id => !(id in hopDist));
const beyondCandidates = [];
for (const id of beyondIdsAll) {
  const nbs = (adjList[id] || []).filter(nb => positions[nb]);
  let ang = 0;
  if (nbs.length > 0) {
    let ax = 0, ay = 0;
    for (const nb of nbs) { ax += positions[nb].x; ay += positions[nb].y; }
    ax /= nbs.length; ay /= nbs.length;
    ang = Math.atan2(ay - cy_val, ax - cx);
  } else {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    ang = (h / 0xffffffff) * Math.PI * 2 - Math.PI;
  }
  beyondCandidates.push({ id, ang, degree: degreeMap[id] || 0 });
}

// Place wave-1 nodes evenly along offset hull perimeter.
wave1.sort((a, b) => a.ang - b.ang);
const wave1Ids = new Set();
const wave1Spacing = wave1.length > 0 ? wave1Param.total / wave1.length : 1;
for (let i = 0; i < wave1.length; i++) {
  const t = (i + 0.5) * wave1Spacing;
  const pt = hullPointAtT(wave1Hull, wave1Param, t);
  positions[wave1[i].id] = pt;
  wave1Ids.add(wave1[i].id);
}

// Place wave-2 nodes evenly along offset hull perimeter.
wave2.sort((a, b) => a.ang - b.ang);
const wave2Ids = new Set();
const wave2Spacing = wave2.length > 0 ? wave2Param.total / wave2.length : 1;
for (let i = 0; i < wave2.length; i++) {
  const t = (i + 0.5) * wave2Spacing;
  const pt = hullPointAtT(wave2Hull, wave2Param, t);
  positions[wave2[i].id] = pt;
  wave2Ids.add(wave2[i].id);
}

// Park beyond nodes evenly along park hull perimeter.
beyondCandidates.sort((a, b) => a.ang - b.ang);
const parkSpacing = beyondCandidates.length > 0 ? parkParam.total / beyondCandidates.length : 1;
for (let i = 0; i < beyondCandidates.length; i++) {
  const t = (i + 0.5) * parkSpacing;
  const pt = hullPointAtT(parkHull, parkParam, t);
  positions[beyondCandidates[i].id] = pt;
}

console.log(`Wave 1: ${wave1.length} nodes, spacing ≈ ${Math.round(wave1Spacing)}px along hull`);
console.log(`Wave 2: ${wave2.length} nodes, spacing ≈ ${Math.round(wave2Spacing)}px along hull`);
console.log(`Beyond: ${beyondCandidates.length} nodes parked along hull (spacing ≈ ${Math.round(parkSpacing)}px)`);

// Tangential repulsion for each hull contour independently.
function runHullRepulsion(ringIds, oHull, oParam, label) {
  const ids = [...ringIds].filter(id => positions[id]);
  const anchors = {};
  for (const id of ids) anchors[id] = { ...positions[id] };

  const spacing = ids.length > 0 ? oParam.total / ids.length : 48;
  const repelR = Math.max(spacing * 1.25, 48);
  const repelStr = 12, springStr = 0.2, iters = 120;

  for (let iter = 0; iter < iters; iter++) {
    for (const id of ids) {
      let fx = 0, fy = 0;
      const p = positions[id];

      for (const oid of ids) {
        if (oid === id) continue;
        const o = positions[oid];
        const dx = p.x - o.x, dy = p.y - o.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < repelR && dist > 0.1) {
          const force = repelStr * (1 - dist / repelR);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }
      const a = anchors[id];
      fx += (a.x - p.x) * springStr;
      fy += (a.y - p.y) * springStr;

      positions[id] = { x: p.x + fx, y: p.y + fy };
      const snapped = snapToHull(oHull, oParam, positions[id].x, positions[id].y);
      positions[id] = snapped;
    }
  }

  // Final even reslot: sort by angle from centroid, redistribute evenly along hull.
  const ordered = ids
    .map(id => ({ id, ang: Math.atan2(positions[id].y - cy_val, positions[id].x - cx) }))
    .sort((a, b) => a.ang - b.ang);
  for (let i = 0; i < ordered.length; i++) {
    const t = (i + 0.5) * spacing;
    positions[ordered[i].id] = hullPointAtT(oHull, oParam, t);
  }
  console.log(`${label} hull repulsion + reslot: ${ids.length} nodes, spacing ≈ ${Math.round(spacing)}px.`);
}

runHullRepulsion(wave1Ids, wave1Hull, wave1Param, 'Wave 1');
runHullRepulsion(wave2Ids, wave2Hull, wave2Param, 'Wave 2');

// Round all positions
for (const id of Object.keys(positions)) {
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

// Each wave ring is dense — only the highest-degree ring nodes per wave get labels.
const wave1LabelAllow = new Set(
  [...wave1Ids]
    .sort((a, b) => (degreeMap[b] || 0) - (degreeMap[a] || 0) || a.localeCompare(b))
    .slice(0, WAVE1_LABEL_TOP)
);
const wave2LabelAllow = new Set(
  [...wave2Ids]
    .sort((a, b) => (degreeMap[b] || 0) - (degreeMap[a] || 0) || a.localeCompare(b))
    .slice(0, WAVE2_LABEL_TOP)
);

const labeledNodes = data.nodes
  .filter(n => {
    if (n.x === undefined) return false;
    if (wave1Ids.has(n.id)) return wave1LabelAllow.has(n.id);
    if (wave2Ids.has(n.id)) return wave2LabelAllow.has(n.id);
    return (degreeMap[n.id] || 0) >= MIN_DEGREE_FOR_LABEL;
  })
  .sort((a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0));

// Drop stale offsets so skipped ring nodes don't keep old labelDx/Dy.
for (const n of data.nodes) {
  delete n.labelDx;
  delete n.labelDy;
}

console.log(`Placing labels for ${labeledNodes.length} nodes (wave1 top ${WAVE1_LABEL_TOP}, wave2 top ${WAVE2_LABEL_TOP}, else degree >= ${MIN_DEGREE_FOR_LABEL})...`);

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
  const isRingNode = wave1Ids.has(node.id) || wave2Ids.has(node.id);
  const gap = r + (isRingNode ? 16 : 8);

  let bestScore = Infinity;
  let bestDx = gap + 4;
  let bestDy = 3;

  // Prefer outward (away from core) for ring labels so they don't fill inward.
  let angleOrder = ANGLES;
  if (isRingNode) {
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
    // Soft penalty for inward labels on ring nodes
    if (isRingNode) {
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

  // Skip hopeless overlaps on ring nodes rather than stacking illegible text
  if (isRingNode && bestScore > 80) {
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
  wave1: {
    count: wave1.length,
    push: PUSH_DIST,
    labelTop: WAVE1_LABEL_TOP,
    shape: 'hull',
    hullPerimeter: Math.round(wave1Param.total),
    spacing: Math.round(wave1Spacing),
    ids: wave1.map(c => c.id),
  },
  wave2: {
    count: wave2.length,
    gap: WAVE_GAP,
    labelTop: WAVE2_LABEL_TOP,
    shape: 'hull',
    hullPerimeter: Math.round(wave2Param.total),
    spacing: Math.round(wave2Spacing),
    ids: wave2.map(c => c.id),
  },
  beyond: {
    count: beyondCandidates.length,
    parkGap: PARK_GAP,
    hullPerimeter: Math.round(parkParam.total),
    spacing: Math.round(parkSpacing),
  },
};

fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log(`Wrote positions for ${updated}/${data.nodes.length} nodes back to ${inputFile}`);
console.log(`Layout metadata saved to _layout field.`);
