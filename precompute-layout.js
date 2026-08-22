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

console.log(`Running ${layoutName} layout (${width}x${height})...`);

const cy = cytoscape({
  headless: true,
  styleEnabled: false,
  elements,
});

const layout = cy.layout(layoutOpts);
layout.run();

const positions = {};
cy.nodes().forEach(n => {
  const pos = n.position();
  positions[n.id()] = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 };
});

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
