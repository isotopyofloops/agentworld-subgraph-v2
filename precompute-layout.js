#!/usr/bin/env node
/** Offline deterministic graph layout. AGENTWORLD graphs get an organic
 * seed+1-hop CoSE core and connection-anchored 2-hop neighborhoods.
 * No convex hull or global rings. Saved x/y coordinates feed browser `preset`.
 * Usage: node precompute-layout.js data.json [--seed 53616]
 */
const fs=require('fs'),cytoscape=require('cytoscape');
let file='graph-data.json',seed=53616;const a=process.argv.slice(2);
for(let i=0;i<a.length;i++)if(a[i]==='--seed')seed=+a[++i];else if(!a[i].startsWith('--'))file=a[i];
const data=JSON.parse(fs.readFileSync(file,'utf8')),ids=new Set(data.nodes.map(n=>n.id));
const E=data.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),adj={},deg={};
for(const id of ids){adj[id]=new Set;deg[id]=0}for(const e of E){adj[e.source].add(e.target);adj[e.target].add(e.source);deg[e.source]++;deg[e.target]++}
function rng(a){return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}const R=rng(seed>>>0);
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function ctr(set,p){let x=0,y=0,n=0;for(const id of set)if(p[id]){x+=p[id].x;y+=p[id].y;n++}return{x:x/n,y:y/n}}
function unit(x,y){let m=Math.hypot(x,y)||1;return{x:x/m,y:y/m}}
function cose(set){const ee=E.filter(e=>set.has(e.source)&&set.has(e.target)),els=[...[...set].map(id=>({data:{id}})),...ee.map((e,i)=>({data:{id:'e'+i,source:e.source,target:e.target}}))];const old=Math.random;Math.random=R;const cy=cytoscape({headless:true,styleEnabled:false,elements:els});cy.layout({name:'cose',animate:false,randomize:true,numIter:1500,nodeRepulsion:()=>set.size<80?240000:290000,idealEdgeLength:()=>set.size<80?68:60,edgeElasticity:()=>50,gravity:.28,gravityRange:3.5,fit:false}).run();Math.random=old;const p={};cy.nodes().forEach(n=>p[n.id()]={...n.position()});return p}
const seeds=data.nodes.filter(n=>n.origin==='agentworld').map(n=>n.id),hop={};let f=[...seeds];for(const s of seeds)hop[s]=0;for(let d=1;d<=2;d++){let q=[];for(const id of f)for(const nb of adj[id])if(!(nb in hop)){hop[nb]=d;q.push(nb)}f=q}
const core=new Set(Object.keys(hop).filter(id=>hop[id]<=1)),peri=new Set(Object.keys(hop).filter(id=>hop[id]===2));
let p=seeds.length?cose(core):cose(ids),groups=0;
if(seeds.length){const cc=ctr(core,p),info=[];for(const id of peri){const anchors=[...adj[id]].filter(x=>core.has(x));if(!anchors.length)continue;const ac=ctr(anchors,p);let out=unit(ac.x-cc.x,ac.y-cc.y);if(Math.hypot(ac.x-cc.x,ac.y-cc.y)<15){const z=(hash(id)%6283)/1000;out={x:Math.cos(z),y:Math.sin(z)}}info.push({id,anchors,ac,out,key:anchors.slice().sort().join('|')})}
 const G=new Map;for(const x of info){if(!G.has(x.key))G.set(x.key,[]);G.get(x.key).push(x)}groups=G.size;
 for(const g of G.values()){g.sort((x,y)=>deg[y.id]-deg[x.id]||x.id.localeCompare(y.id));g.forEach((x,i)=>{const c=i-(g.length-1)/2,t={x:-x.out.y,y:x.out.x},rad=(x.anchors.length>1?100:125)+Math.floor(Math.abs(c)/7)*45+Math.min(30,g.length),lat=c*Math.max(20,40-Math.min(18,g.length));p[x.id]={x:x.ac.x+x.out.x*rad+t.x*lat+(R()-.5)*8,y:x.ac.y+x.out.y*rad+t.y*lat+(R()-.5)*8}})}
 // Relax collisions while springing each node back toward its anchor-derived target.
 const target={};for(const x of info)target[x.id]={...p[x.id]};const q=info.map(x=>x.id);for(let k=0;k<180;k++){const d={};for(const id of q)d[id]={x:(target[id].x-p[id].x)*.075,y:(target[id].y-p[id].y)*.075};for(let i=0;i<q.length;i++)for(let j=i+1;j<q.length;j++){const u=q[i],v=q[j],dx=p[v].x-p[u].x,dy=p[v].y-p[u].y,m=Math.hypot(dx,dy)||.01;if(m<34){const z=(34-m)*.1,ux=dx/m,uy=dy/m;d[u].x-=ux*z;d[u].y-=uy*z;d[v].x+=ux*z;d[v].y+=uy*z}}for(const id of q){p[id].x+=Math.max(-8,Math.min(8,d[id].x));p[id].y+=Math.max(-8,Math.min(8,d[id].y))}}
 // Any non-2-hop leftovers become small deterministic islands, never a ring.
 const rest=[...ids].filter(id=>!p[id]);let mx=Math.max(...Object.values(p).map(x=>x.x)),my=Math.min(...Object.values(p).map(x=>x.y));rest.sort().forEach((id,i)=>p[id]={x:mx+220+(i%8)*48,y:my+Math.floor(i/8)*48});
}
const V=Object.values(p),sx=70-Math.min(...V.map(x=>x.x)),sy=70-Math.min(...V.map(x=>x.y));for(const x of V){x.x+=sx;x.y+=sy}for(const n of data.nodes){if(p[n.id]){n.x=Math.round(p[n.id].x*100)/100;n.y=Math.round(p[n.id].y*100)/100;delete n.labelDx;delete n.labelDy}}
data._layout={mode:seeds.length?'anchored-periphery-v1':'single-pass-cose',seed,coreNodes:core.size,peripheralNodes:peri.size,anchorNeighborhoods:groups,computed:new Date().toISOString()};fs.writeFileSync(file,JSON.stringify(data,null,2));console.log(data._layout);
