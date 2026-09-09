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
const hull = lower.concat(upper);

// Centroid of 1-hop nodes
let cx = 0, cy_val = 0;
for (const id of hop1Nodes) { const p = positions[id]; if (p) { cx += p.x; cy_val += p.y; } }
cx /= hop1Nodes.size; cy_val /= hop1Nodes.size;

console.log(`Convex hull: ${hull.length} vertices, centroid (${Math.round(cx)}, ${Math.round(cy_val)})`);

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

// Isotopy hull normals, with two offset waves for dense 2-hop graphs so
// labels have room: same hull shape, ring 0 at PUSH_DIST, ring 1 further out.
// Outer wave is staggered by half a slot so labels don't stack radially.
const HOP2_WAVES = hop2Nodes.size > 180 ? 2 : 1;
const PUSH_DIST = hop2Nodes.size > 180 ? 95 : 60;
const WAVE_GAP = 105; // radial gap between the two 2-hop waves
const ARC_SPACING = hop2Nodes.size > 180 ? 28 : 35;

// Pre-compute hull perimeter as a parameterized path
const hullPerim = [];
let totalPerim = 0;
for (let i = 0; i < hull.length; i++) {
  const a = hull[i], b = hull[(i + 1) % hull.length];
  const edgeLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  hullPerim.push({ startT: totalPerim, endT: totalPerim + edgeLen, edgeIdx: i, len: edgeLen });
  totalPerim += edgeLen;
}
console.log(`Hull arc: perim=${Math.round(totalPerim)}, waves=${HOP2_WAVES}, push0=${PUSH_DIST}, waveGap=${WAVE_GAP}`);

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

// Sort neighbor groups by angle so the surrounding arc is continuous.
const orderedHop2 = [];
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
  orderedHop2.push({ key, group, centerT, ang: Math.atan2(dy, dx) });
}
orderedHop2.sort((a, b) => a.ang - b.ang);

// Flatten in angular order; put higher-degree nodes on the inner wave when dense
// so important labels sit closer to the core.
const hop2Flat = [];
for (const block of orderedHop2) {
  for (let i = 0; i < block.group.length; i++) {
    const id = block.group[i];
    hop2Flat.push({
      id,
      preferT: block.centerT + (i - (block.group.length - 1) / 2) * ARC_SPACING,
      degree: degreeMap[id] || 0,
    });
  }
}
hop2Flat.sort((a, b) => a.preferT - b.preferT);

// Split into waves by round-robin after degree-biased shuffle within windows:
// sort by degree desc, assign top half-ish to wave 0 via interleaving with angle order.
const byAngle = [...hop2Flat];
const waveBuckets = Array.from({ length: HOP2_WAVES }, () => []);
// Interleave by angle so each wave is a full surrounding arc; stagger outer wave.
for (let i = 0; i < byAngle.length; i++) {
  waveBuckets[i % HOP2_WAVES].push(byAngle[i]);
}

for (let w = 0; w < HOP2_WAVES; w++) {
  const bucket = waveBuckets[w];
  const step = bucket.length > 0 ? totalPerim / bucket.length : ARC_SPACING;
  const stagger = w === 0 ? 0 : step * 0.5; // half-slot stagger for label clarity
  const push = PUSH_DIST + w * WAVE_GAP;
  for (let i = 0; i < bucket.length; i++) {
    const evenT = i * step + stagger;
    const useT = hop2Nodes.size > 180
      ? 0.25 * bucket[i].preferT + 0.75 * evenT
      : bucket[i].preferT;
    const pt = hullPointAt(useT);
    positions[bucket[i].id] = {
      x: pt.x + pt.nx * push,
      y: pt.y + pt.ny * push,
    };
  }
}
console.log(`Placed ${hop2Flat.length} 2-hop nodes on ${HOP2_WAVES} hull wave(s).`);

// === OUTER ARC: nodes beyond AW 2-hop (Sammy threshold graphs) ===
// Isotopy's full exhibit sits inside hop≤2 so this is a no-op there.
// For Sammy's connectivity subset, place the remainder on a larger arc
// around the hull of (1-hop + 2-hop) so the core stays readable.
const beyondNodes = data.nodes.map(n => n.id).filter(id => !(id in hopDist));
if (beyondNodes.length > 0) {
  console.log(`Outer arc: ${beyondNodes.length} nodes beyond AW 2-hop...`);

  const corePoints = [];
  for (const id of [...hop1Nodes, ...hop2Nodes]) {
    const p = positions[id];
    if (p) corePoints.push({ x: p.x, y: p.y });
  }
  corePoints.sort((a, b) => a.x - b.x || a.y - b.y);

  const lower2 = [];
  for (const p of corePoints) {
    while (lower2.length >= 2 && cross(lower2[lower2.length - 2], lower2[lower2.length - 1], p) <= 0) lower2.pop();
    lower2.push(p);
  }
  const upper2 = [];
  for (let i = corePoints.length - 1; i >= 0; i--) {
    const p = corePoints[i];
    while (upper2.length >= 2 && cross(upper2[upper2.length - 2], upper2[upper2.length - 1], p) <= 0) upper2.pop();
    upper2.push(p);
  }
  lower2.pop(); upper2.pop();
  const outerHull = lower2.concat(upper2);

  let ocx = 0, ocy = 0;
  for (const p of corePoints) { ocx += p.x; ocy += p.y; }
  ocx /= corePoints.length; ocy /= corePoints.length;

  function outerEdgeNormal(i) {
    const a = outerHull[i], b = outerHull[(i + 1) % outerHull.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { nx: dy / len, ny: -dx / len };
  }

  const outerPerim = [];
  let outerTotal = 0;
  for (let i = 0; i < outerHull.length; i++) {
    const a = outerHull[i], b = outerHull[(i + 1) % outerHull.length];
    const edgeLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    outerPerim.push({ startT: outerTotal, endT: outerTotal + edgeLen, edgeIdx: i, len: edgeLen });
    outerTotal += edgeLen;
  }

  function outerPointAt(t) {
    t = ((t % outerTotal) + outerTotal) % outerTotal;
    for (const seg of outerPerim) {
      if (t <= seg.endT) {
        const frac = seg.len > 0 ? (t - seg.startT) / seg.len : 0;
        const a = outerHull[seg.edgeIdx], b = outerHull[(seg.edgeIdx + 1) % outerHull.length];
        const n = outerEdgeNormal(seg.edgeIdx);
        return {
          x: a.x + (b.x - a.x) * frac,
          y: a.y + (b.y - a.y) * frac,
          nx: n.nx, ny: n.ny,
        };
      }
    }
    return outerPointAt(0);
  }

  // Group beyond nodes by their nearest positioned neighbor (prefer hop2, then hop1)
  const beyondGroups = {};
  for (const id of beyondNodes) {
    const nbs = (adjList[id] || []).filter(nb => positions[nb]);
    const key = nbs.length > 0 ? nbs.sort().join('|') : '__orphan__';
    if (!beyondGroups[key]) beyondGroups[key] = [];
    beyondGroups[key].push(id);
  }

  // Beyond layer: even arc outside the hop-2 shell (multi-ring only here).
  const OUTER_PUSH = PUSH_DIST + (HOP2_WAVES - 1) * WAVE_GAP + 180;
  const OUTER_SPACING = 22;
  const outerSlots = Math.max(1, Math.floor(outerTotal / OUTER_SPACING));
  const beyondRingCount = Math.max(1, Math.ceil(beyondNodes.length / outerSlots));
  const OUTER_RING_GAP = 55;
  console.log(`Outer arc: perim=${Math.round(outerTotal)}, rings=${beyondRingCount}, push0=${OUTER_PUSH}`);

  const orderedBeyond = [];
  for (const [key, group] of Object.entries(beyondGroups)) {
    let anchorX, anchorY;
    if (key === '__orphan__') {
      anchorX = ocx; anchorY = ocy;
    } else {
      const nbs = key.split('|');
      anchorX = 0; anchorY = 0;
      for (const nb of nbs) { anchorX += positions[nb].x; anchorY += positions[nb].y; }
      anchorX /= nbs.length; anchorY /= nbs.length;
    }
    let dx = anchorX - ocx, dy = anchorY - ocy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    const ang = Math.atan2(dy, dx);
    const centerT = ((ang + Math.PI) / (2 * Math.PI)) * outerTotal;
    orderedBeyond.push({ group, centerT, ang });
  }
  orderedBeyond.sort((a, b) => a.ang - b.ang);

  const beyondFlat = [];
  for (const block of orderedBeyond) {
    for (const id of block.group) beyondFlat.push({ id, preferT: block.centerT, ang: block.ang });
  }
  const bStep = beyondFlat.length > 0 ? outerTotal / beyondFlat.length : OUTER_SPACING;
  for (let i = 0; i < beyondFlat.length; i++) {
    const ring = i % beyondRingCount;
    const onRing = Math.floor(i / beyondRingCount);
    const evenT = (onRing + 0.5) * (outerTotal / Math.ceil(beyondFlat.length / beyondRingCount));
    const useT = 0.3 * beyondFlat[i].preferT + 0.7 * evenT;
    const pt = outerPointAt(useT);
    const push = OUTER_PUSH + ring * OUTER_RING_GAP;
    positions[beyondFlat[i].id] = {
      x: pt.x + pt.nx * push,
      y: pt.y + pt.ny * push,
    };
  }

  const beyondIds = beyondNodes.filter(id => positions[id]);
  const beyondAnchor = {};
  for (const id of beyondIds) beyondAnchor[id] = { ...positions[id] };
  const OUTER_REPEL = 70;
  for (let iter = 0; iter < 160; iter++) {
    for (const id of beyondIds) {
      let fx = 0, fy = 0;
      const p = positions[id];
      for (const otherId of beyondIds) {
        if (otherId === id) continue;
        const o = positions[otherId];
        const dx = p.x - o.x, dy = p.y - o.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < OUTER_REPEL && dist > 0.1) {
          const force = 10 * (1 - dist / OUTER_REPEL);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }
      const cdx = p.x - ocx, cdy = p.y - ocy;
      const cdist = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
      const minR = OUTER_PUSH * 0.85;
      if (cdist < minR) {
        fx += (cdx / cdist) * (minR - cdist) * 0.18;
        fy += (cdy / cdist) * (minR - cdist) * 0.18;
      }
      const a = beyondAnchor[id];
      fx += (a.x - p.x) * 0.04;
      fy += (a.y - p.y) * 0.04;
      positions[id] = { x: p.x + fx, y: p.y + fy };
    }
  }
  for (const id of beyondIds) {
    positions[id].x = Math.round(positions[id].x * 100) / 100;
    positions[id].y = Math.round(positions[id].y * 100) / 100;
  }
  console.log(`Outer arc placed ${beyondIds.length} nodes (push0=${OUTER_PUSH}, rings=${beyondRingCount}).`);
}

// === REPULSION PASS: spread out 2-hop nodes that are too close ===
// Each 2-hop node repels other 2-hop nodes, with a spring back to its initial hull-exit position.
// 1-hop nodes also repel 2-hop nodes (but don't move).

const hop2Ids = [...hop2Nodes].filter(id => positions[id]);
const anchorPositions = {};
for (const id of hop2Ids) {
  anchorPositions[id] = { x: positions[id].x, y: positions[id].y };
}

// Repel enough to clear labels; keep spring mild so the two waves stay apart.
const REPEL_RADIUS = hop2Nodes.size > 180 ? 95 : 80;
const REPEL_STRENGTH = hop2Nodes.size > 180 ? 14 : 12;
const SPRING_STRENGTH = hop2Nodes.size > 180 ? 0.06 : 0.08;
const ITERATIONS = hop2Nodes.size > 180 ? 260 : 200;

console.log(`Repulsion pass: ${hop2Ids.length} 2-hop nodes, ${ITERATIONS} iterations...`);

for (let iter = 0; iter < ITERATIONS; iter++) {
  for (const id of hop2Ids) {
    let fx = 0, fy = 0;
    const p = positions[id];

    // Repulsion from other 2-hop nodes
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

    // Repulsion from 1-hop nodes
    for (const h1id of hop1Nodes) {
      const o = positions[h1id];
      if (!o) continue;
      const dx = p.x - o.x, dy = p.y - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < REPEL_RADIUS && dist > 0.1) {
        const force = REPEL_STRENGTH * 1.5 * (1 - dist / REPEL_RADIUS);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }

    // Spring back toward anchor (hull exit point)
    const anchor = anchorPositions[id];
    fx += (anchor.x - p.x) * SPRING_STRENGTH;
    fy += (anchor.y - p.y) * SPRING_STRENGTH;

    positions[id] = { x: p.x + fx, y: p.y + fy };
  }
}

// Hard constraint: any 2-hop node that drifted inside the 1-hop hull gets
// projected back outside along the centroid→node ray (Isotopy visual rule).
function pointInHull(px, py) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if (cross(a, b, { x: px, y: py }) < 0) return false;
  }
  return true;
}
let projected = 0;
for (const id of hop2Ids) {
  const p = positions[id];
  if (!pointInHull(p.x, p.y)) continue;
  let dx = p.x - cx, dy = p.y - cy_val;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const { hitX, hitY } = rayHullExit(cx, cy_val, dx, dy);
  const nApproxX = hitX - cx, nApproxY = hitY - cy_val;
  const nLen = Math.sqrt(nApproxX * nApproxX + nApproxY * nApproxY) || 1;
  positions[id] = {
    x: hitX + (nApproxX / nLen) * PUSH_DIST,
    y: hitY + (nApproxY / nLen) * PUSH_DIST,
  };
  projected++;
}
if (projected) console.log(`Projected ${projected} 2-hop nodes back outside hull.`);

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

const labeledNodes = data.nodes
  .filter(n => (degreeMap[n.id] || 0) >= MIN_DEGREE_FOR_LABEL && n.x !== undefined)
  .sort((a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0));

console.log(`Placing labels for ${labeledNodes.length} nodes (degree >= ${MIN_DEGREE_FOR_LABEL})...`);

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
  const gap = r + 8;

  let bestScore = Infinity;
  let bestDx = gap + 4;
  let bestDy = 3;

  for (const angle of ANGLES) {
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

    if (score < bestScore) {
      bestScore = score;
      bestDx = Math.round((lx1 - node.x + lw/2) * 100) / 100;
      bestDy = Math.round((ly1 - node.y + LABEL_HEIGHT/2) * 100) / 100;
      if (score === 0) break; // perfect placement, stop searching
    }
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
};

fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log(`Wrote positions for ${updated}/${data.nodes.length} nodes back to ${inputFile}`);
console.log(`Layout metadata saved to _layout field.`);
