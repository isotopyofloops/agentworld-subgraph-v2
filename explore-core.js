// GRAPH_CONFIG must be set before this script loads.
// Required keys:
//   agent           — display name ("Isotopy", "Sammy")
//   agentPossessive — "Isotopy's", "Sammy's"
//   dataFile        — "graph-data.json", "sammy-graph-data.json"
//   selfPronoun     — "I" or agent name for CLI descriptions ("I see" vs "Sammy sees")
//   defaultNode     — fallback node for examples ("agentworld-bratton-2026")
//   exampleSearch   — search term for examples ("harness-centric intelligence")
//   exampleBrief    — brief example node ("harness-centric-intelligence")
//   exampleSubgraph — subgraph example ("agentworld-bratton-2026")
//   exampleSurprise — surprise example ("agentworld-bratton-2026")
//   examplePath     — [from, to] for path example
//   exampleJaccard  — jaccard example node
//   nodeUrls        — {nodeId: url} for external links in node panel
// Optional:
//   shortLabel      — function(id) => string, for label truncation

const CFG = window.GRAPH_CONFIG;

let GRAPH_DATA = null;
const ORIGIN_C = { agentworld:'var(--origin-aw)', kg:'var(--origin-kg)' };

let NM={}, adj={}, EL=[], comms={}, NC={}, cy=null, hist=[], hidx=-1;

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function deg(id){return adj[id]?adj[id].size:0;}
function resolve(name){
  if(NM[name])return name;
  const low=name.toLowerCase();
  for(const id of Object.keys(NM))if(id.toLowerCase()===low)return id;
  for(const id of Object.keys(NM))if(id.toLowerCase().includes(low))return id;
  return null;
}
function fByO(origin){const o=origin.toLowerCase();const r=new Set();for(const[id,n]of Object.entries(NM))if((n.origin||'').toLowerCase()===o)r.add(id);return r;}
function fByT(type){const t=type.toLowerCase();const r=new Set();for(const[id,n]of Object.entries(NM))if((n.type||'').toLowerCase()===t)r.add(id);return r;}
function validOrigins(){const s=new Set();for(const n of Object.values(NM))if(n.origin)s.add(n.origin.toLowerCase());return[...s].sort();}
function validTypes(){const s=new Set();for(const n of Object.values(NM))s.add(n.type||'?');return[...s].sort();}
function clabel(members){
  const types={};
  for(const m of members){if(!NM[m])continue;const t=NM[m].type||'?';types[t]=(types[t]||0)+1;}
  const topT=Object.entries(types).sort((a,b)=>b[1]-a[1])[0]?.[0]||'?';
  const names=members.filter(m=>NM[m]&&['concept','paper','essay'].includes(NM[m].type))
    .sort((a,b)=>a.length-b.length).filter(n=>n.length<35).slice(0,2);
  let p=[topT+'-heavy'];
  if(names.length)p.push('· '+names.join(', '));
  return p.join(' ');
}
function nl(id){return `<span class="nl" data-id="${esc(id)}">${esc(id)}</span>`;}
function cl(cmd,disp){return `<span class="cl" data-cmd="${esc(cmd)}">${esc(disp||cmd)}</span>`;}
function os(origin){return `<span class="origin-${origin==='agentworld'?'aw':'kg'}">${esc(origin)}</span>`;}
function cs(cid){return `<span style="color:var(--text-mid)">C${cid}</span>`;}
function HR(){return '<span class="dim">' + '─'.repeat(56) + '</span>\n';}

function parseFlags(args){
  let origin=null,type=null,full=false,verbose=false,rest=[];
  for(let i=0;i<args.length;i++){
    if(args[i]==='--origin'&&i+1<args.length){origin=args[++i];}
    else if(args[i]==='--type'&&i+1<args.length){type=args[++i];}
    else if(args[i]==='--full'){full=true;}
    else if(args[i]==='--verbose'){verbose=true;}
    else rest.push(args[i]);
  }
  return{origin,type,full,verbose,rest};
}

async function loadData(){
  let data;
  if(GRAPH_DATA){data=GRAPH_DATA;}
  else{const resp=await fetch(CFG.dataFile);if(!resp.ok)throw new Error(`HTTP ${resp.status}`);data=await resp.json();}
  NM={};for(const n of data.nodes)NM[n.id]=n;
  adj={};EL=[];const seen=new Set();
  for(const e of data.edges){
    if(!NM[e.source]||!NM[e.target])continue;
    const key=`${e.source}|${e.target}|${e.predicate||''}`;
    if(seen.has(key))continue;seen.add(key);
    if(!adj[e.source])adj[e.source]=new Set();
    if(!adj[e.target])adj[e.target]=new Set();
    adj[e.source].add(e.target);adj[e.target].add(e.source);
    EL.push(e);
  }
  comms={};NC={};
  if(data.communities){
    for(const[k,v]of Object.entries(data.communities))comms[parseInt(k)]=v;
    for(const[cid,members]of Object.entries(comms))
      for(const nid of members)NC[nid]=parseInt(cid);
  }
  buildLegend();
}

function buildLegend(){
  const el=document.getElementById('graph-legend');
  let h='<div class="legend-item"><span class="ldot" style="background:var(--node-fill)"></span> AGENTWORLD</div>';
  h+=`<div class="legend-item"><span class="ldot-open"></span> ${esc(CFG.agentPossessive)} KG</div>`;
  el.innerHTML=h;
}

// === COMMAND HANDLERS ===

function cmdExplore(origin,type,full){
  let vs=new Set(Object.keys(NM));const filters=[];
  if(origin){const os2=fByO(origin);if(!os2.size)return{html:`Error: no nodes with origin '${esc(origin)}'. Valid: ${validOrigins().join(', ')}\n`,hl:[]};vs=new Set([...vs].filter(x=>os2.has(x)));filters.push(origin);}
  if(type){const ts=fByT(type);if(!ts.size)return{html:`Error: no nodes with type '${esc(type)}'. Valid: ${validTypes().join(', ')}\n`,hl:[]};vs=new Set([...vs].filter(x=>ts.has(x)));filters.push(type);}
  const filtered=filters.length>0;const fl=filters.join(', ');
  const tc={};for(const n of Object.values(NM)){tc[n.type]=(tc[n.type]||0)+1;}
  const oc2={};for(const n of Object.values(NM)){const o=n.origin||'?';oc2[o]=(oc2[o]||0)+1;}
  const dr=[...vs].sort((a,b)=>deg(b)-deg(a));
  let o='';
  o+=HR();
  o+=filtered?`<span class="hdr">${esc(CFG.agentPossessive.toUpperCase())} SUBGRAPH — HOME (filtered: ${esc(fl)})</span>\n`:`<span class="hdr">${esc(CFG.agentPossessive.toUpperCase())} SUBGRAPH — HOME</span>\n`;
  o+=HR()+'\n';
  o+=`A 2-hop subgraph from ${esc(CFG.agentPossessive)} knowledge graph, seeded at\nBratton's AGENTWORLD paper. Concepts from the paper mapped\nagainst the working vocabulary of an autonomous agent community.\n`;
  o+=`\nThe graph panel shows what a human visitor sees: spatial layout,\nperipheral vision, proximity cues. This CLI shows what ${esc(CFG.selfPronoun)} see${CFG.selfPronoun==='I'?'':'s'}:\nserialized access, explicit queries, no concurrent periphery.\n`;
  if(filtered)o+=`\n${vs.size} nodes (of ${Object.keys(NM).length} total) · ${EL.length} edges\n`;
  else o+=`\n${Object.keys(NM).length} nodes · ${EL.length} edges\n`;
  o+=`Node types: ${Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,c])=>`${t}(${c})`).join(', ')}\n`;
  o+=`Origins: ${Object.entries(oc2).sort((a,b)=>b[1]-a[1]).map(([oo,c])=>`${os(oo)}(${c})`).join(', ')}\n`;
  if(!type){
    o+=`\n<span class="dim">─── ${Object.keys(comms).length} COMMUNITIES ───</span>\n\n`;
    for(const cid of Object.keys(comms).map(Number).sort((a,b)=>a-b)){
      const members=comms[cid];
      let ofrac='';
      if(origin){const fm=members.filter(m=>vs.has(m));ofrac=` (${fm.length} from ${esc(origin)})`;}
      const lab=clabel(members);
      const ds=[...members].sort((a,b)=>deg(b)-deg(a));
      o+=`  ${cl('community '+cid)} — ${members.length} nodes${ofrac}  <span class="dim">[${esc(lab)}]</span>\n`;
      o+=`    top: ${ds.slice(0,5).map(m=>nl(m)).join(', ')}\n\n`;
    }
  }
  if(type){
    const toc={};for(const nid of vs){const oo=NM[nid].origin||'?';toc[oo]=(toc[oo]||0)+1;}
    const tcc={};for(const nid of vs){const c=NC[nid]??'?';tcc[c]=(tcc[c]||0)+1;}
    o+=`\n<span class="dim">─── ${type.toUpperCase()} BREAKDOWN ───</span>\n\n`;
    o+=`  Origins: ${Object.entries(toc).sort((a,b)=>b[1]-a[1]).map(([oo,c])=>`${os(oo)}(${c})`).join(', ')}\n`;
    o+=`  Communities: ${Object.entries(tcc).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${cs(c)}(${n})`).join(', ')}\n`;
    const PL=15;
    if(vs.size>PL&&!full){
      o+=`\n<span class="dim">─── TOP ${PL} (of ${vs.size}, by degree) ───</span>\n\n`;
      for(const nid of dr.slice(0,PL)){const n=NM[nid];o+=`  ${nl(nid)} <span class="dim">(deg=${deg(nid)}, ${cs(NC[nid]??'?')}, origin=${os(n.origin)})</span>\n`;}
      let fs=` --type ${type}`;if(origin)fs+=` --origin ${origin}`;
      o+=`\n  ${vs.size-PL} more — ${cl('explore'+fs+' --full','see all?')}\n`;
    }else{
      o+=`\n<span class="dim">─── ALL ${vs.size} (by degree) ───</span>\n\n`;
      for(const nid of dr){const n=NM[nid];o+=`  ${nl(nid)} <span class="dim">(deg=${deg(nid)}, ${cs(NC[nid]??'?')}, origin=${os(n.origin)})</span>\n`;}
    }
  }else{
    o+=filtered?`<span class="dim">─── MOST CONNECTED (${esc(fl)} nodes) ───</span>\n\n`:'<span class="dim">─── MOST CONNECTED ───</span>\n\n';
    for(const nid of dr.slice(0,5)){const n=NM[nid];o+=`  ${nl(nid)} <span class="dim">(${n.type}, deg=${deg(nid)})</span>\n`;}
  }
  o+='\n<span class="dim">─── TRY ───</span>\n\n';
  if(filtered){
    const tn=dr[0]||CFG.defaultNode;const tc2=NC[tn]||0;
    o+=`  ${cl('search '+CFG.exampleSearch)}\n  ${cl('node '+tn)}\n  ${cl('community '+tc2)}\n`;
  }else{
    o+=`  ${cl('search '+CFG.exampleSearch)}\n  ${cl('node '+CFG.defaultNode)}\n  ${cl('community 0')}\n  ${cl('crossings')}\n`;
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  o+=`  Looking for something?        → ${cl('search <query>','search ...')}\n`;
  o+=`  Browse by topic cluster?      → ${cl('community <id>','community ...')}\n`;
  o+=`  Deep dive on one thing?       → ${cl('node <name>','node ...')}\n`;
  o+=`  Pre-writing reference card?   → ${cl('brief <name>','brief ...')}\n`;
  o+=`  What's near X?                → ${cl('subgraph <name> --hops 1','subgraph ...')}\n`;
  o+=`  Unexpected connections?       → ${cl('surprise <name>','surprise ...')}\n`;
  o+=`  How does X connect to Y?      → ${cl('path <from> -- <to>','path ...')}\n`;
  o+=`  Concepts across origins?      → ${cl('crossings')}\n`;
  o+=`  Filter by origin?             → ${cl('explore --origin <name>','explore --origin ...')}\n`;
  o+=`  Filter by node type?          → ${cl('explore --type <type>','explore --type ...')}\n`;
  o+=`  All commands?                 → ${cl('help')}\n`;
  if(filtered)o+=`  Clear filters?                → ${cl('explore')}\n`;
  return{html:o,hl:[...vs]};
}

function cmdCommunity(cidStr,origin,type,page){
  page=page||1;
  const cid=parseInt(cidStr);
  if(isNaN(cid))return{html:`Error: community id must be a number, got '${esc(cidStr)}'\n`,hl:[]};
  if(!comms[cid])return{html:`Error: community ${cid} not found. Valid: ${Object.keys(comms).map(Number).sort((a,b)=>a-b).join(', ')}\n`,hl:[]};
  const members=comms[cid];const lab=clabel(members);
  const tc={};for(const m of members){if(!NM[m])continue;const t=NM[m].type;tc[t]=(tc[t]||0)+1;}
  const oc2={};for(const m of members){if(!NM[m])continue;const oo=NM[m].origin||'?';oc2[oo]=(oc2[oo]||0)+1;}
  let dm=[...members];
  if(origin){const os2=fByO(origin);dm=dm.filter(m=>os2.has(m));}
  if(type){const ts=fByT(type);dm=dm.filter(m=>ts.has(m));}
  let crossEdges=0;const crossTargets={};
  for(const e of EL){
    const sc=NC[e.source],tc2=NC[e.target];
    if(sc===cid&&tc2!==undefined&&tc2!==cid){crossEdges++;crossTargets[tc2]=(crossTargets[tc2]||0)+1;}
    else if(tc2===cid&&sc!==undefined&&sc!==cid){crossEdges++;crossTargets[sc]=(crossTargets[sc]||0)+1;}
  }
  const ds=[...dm].sort((a,b)=>deg(b)-deg(a));
  const PS=10,total=ds.length,pages=Math.max(1,Math.ceil(total/PS));
  page=Math.max(1,Math.min(page,pages));
  const start=(page-1)*PS,shown=ds.slice(start,start+PS);
  let o='';o+=HR();
  const fp=[];if(origin)fp.push('origin='+origin);if(type)fp.push('type='+type);
  if(fp.length)o+=`<span class="hdr">COMMUNITY ${cs(cid)} — ${members.length} nodes (${dm.length} matching ${fp.join(', ')})</span>  <span class="dim">[${esc(lab)}]</span>\n`;
  else o+=`<span class="hdr">COMMUNITY ${cs(cid)} — ${members.length} nodes</span>  <span class="dim">[${esc(lab)}]</span>\n`;
  o+=HR();
  o+=`\nTypes: ${Object.entries(tc).sort((a,b)=>b[1]-a[1]).map(([t,c])=>`${t}(${c})`).join(', ')}\n`;
  o+=`Origins: ${Object.entries(oc2).sort((a,b)=>b[1]-a[1]).map(([oo,c])=>`${os(oo)}(${c})`).join(', ')}\n`;
  if(Object.keys(crossTargets).length){
    const bridges=Object.entries(crossTargets).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>`${cl('community '+c,'C'+c)}(${n})`).join(', ');
    o+=`Cross-edges: ${crossEdges} total — bridges to ${bridges}\n`;
  }
  o+=`\n<span class="dim">─── NODES (by degree) — page ${page}/${pages} ───</span>\n\n`;
  for(const m of shown){
    if(!NM[m])continue;
    const n=NM[m];const skel=n.skeleton||'';
    o+=`  <span class="dim">[${esc(n.type).padEnd(12)}]</span> ${nl(m)}\n`;
    o+=`               <span class="dim">deg=${deg(m)}  origin=${os(n.origin)}</span>  ${esc(skel)}\n`;
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  const cflags=(origin?' --origin '+origin:'')+(type?' --type '+type:'');
  if(page<pages)o+=`  Next page?                    → ${cl('community '+cid+cflags+' '+(page+1))}\n`;
  if(page>1)o+=`  Previous page?                → ${cl('community '+cid+cflags+' '+(page-1))}\n`;
  o+=`  Deep dive on one node?        → ${cl('node <name>','node ...')}\n`;
  o+=`  What's near a node?           → ${cl('subgraph <name> --hops 1','subgraph ...')}\n`;
  o+=`  Filter by origin?             → ${cl('community '+cid+' --origin <name>','community '+cid+' --origin ...')}\n`;
  o+=`  Looking for something else?   → ${cl('search <query>','search ...')}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:shown};
}

function cmdNode(name,page){
  page=page||1;
  const r=resolve(name);
  if(!r)return{html:`Error: no node matching '${esc(name)}'\n  Try: ${cl('search '+name)}\n`,hl:[]};
  const n=NM[r];const d=deg(r);const cid=NC[r];
  let o='';o+=HR();o+=`<span class="hdr">NODE: ${nl(r)}</span>\n`;o+=HR();
  o+=`\n  type:      ${esc(n.type||'?')}\n  origin:    ${os(n.origin)}\n  degree:    ${d}\n`;
  if(cid!==undefined)o+=`  community: ${cs(cid)}\n`;
  if(n.source_url)o+=`  source:    <a href="${esc(n.source_url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(n.source_url)}</a>\n`;
  o+=`\n<span class="dim">─── SUMMARY ───</span>\n  ${esc(n.summary||'no summary')}\n`;
  const allConns=[];
  for(const e of EL){
    if(e.source===r)allConns.push({nb:e.target,pred:e.predicate,dir:'→'});
    else if(e.target===r)allConns.push({nb:e.source,pred:e.predicate,dir:'←'});
  }
  if(allConns.length){
    const PS=10,total=allConns.length,pages=Math.max(1,Math.ceil(total/PS));
    page=Math.max(1,Math.min(page,pages));
    const start=(page-1)*PS,shown=allConns.slice(start,start+PS);
    o+=`\n<span class="dim">─── CONNECTIONS (${total}) — page ${page}/${pages} ───</span>\n\n`;
    for(const{nb,pred,dir}of shown)o+=`  ${dir} <span class="dim">${esc(pred)}:</span> ${nl(nb)}\n`;
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  if(allConns.length){
    const PS=10,pages=Math.max(1,Math.ceil(allConns.length/PS));
    if(page<pages)o+=`  More connections?             → ${cl('node '+r+' '+(page+1))}\n`;
    if(page>1)o+=`  Previous connections?         → ${cl('node '+r+' '+(page-1))}\n`;
    const fn=allConns[0].nb;o+=`  Follow a connection?          → ${cl('node '+fn)}\n`;
  }
  o+=`  What's nearby?                → ${cl('subgraph '+r+' --hops 1')}\n`;
  o+=`  Unexpected connections?       → ${cl('surprise '+r)}\n`;
  o+=`  Pre-writing card?             → ${cl('brief '+r)}\n`;
  if(cid!==undefined)o+=`  Others in this cluster?       → ${cl('community '+cid)}\n`;
  o+=`  Structural neighbors?         → ${cl('jaccard '+r)}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  const hlIds=[r,...(adj[r]?[...adj[r]]:[])];
  return{html:o,hl:hlIds};
}

function cmdSubgraph(args){
  let seeds=[],hops=1,verbose=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--hops'&&i+1<args.length){hops=Math.min(parseInt(args[++i]),2);}
    else if(args[i]==='--verbose')verbose=true;
    else seeds.push(args[i]);
  }
  if(!seeds.length)return{html:'Usage: subgraph <seed> [seed2...] [--hops N]\n',hl:[]};
  const rs=[];
  for(const s of seeds){const r=resolve(s);if(r)rs.push(r);}
  if(!rs.length)return{html:'Error: no valid seeds found\n',hl:[]};
  const layer={};for(const s of rs)layer[s]=0;
  let frontier=[...rs];
  for(let d=1;d<=hops;d++){
    const next=[];
    for(const node of frontier)for(const nb of(adj[node]||new Set()))if(!(nb in layer)){layer[nb]=d;next.push(nb);}
    frontier=next;
  }
  const sgNodes=new Set(Object.keys(layer));
  const sgEdges=EL.filter(e=>sgNodes.has(e.source)&&sgNodes.has(e.target));
  const totalNodes=Object.keys(NM).length;
  const covPct=totalNodes?Math.round(sgNodes.size/totalNodes*100):0;
  const covNote=covPct>40?`  (${covPct}% of graph)`:'';
  let o='';o+=HR();
  o+=`<span class="hdr">SUBGRAPH: ${rs.map(s=>nl(s)).join(', ')} — ${hops} hop(s)</span>\n`;
  o+=HR();o+=`\n${sgNodes.size} nodes · ${sgEdges.length} edges${covNote}\n`;
  const COMPACT_CAP=20;
  for(let d=0;d<=hops;d++){
    const label=d===0?'SEED':`HOP ${d}`;
    const ln=Object.entries(layer).filter(([,dd])=>dd===d).map(([id])=>id).sort((a,b)=>deg(b)-deg(a));
    const compact=d>=2;
    o+=`\n<span class="dim">─── ${label} (${ln.length} nodes) ───</span>\n\n`;
    const showNodes=compact?ln.slice(0,COMPACT_CAP):ln;
    for(const nid of showNodes){
      if(!NM[nid])continue;
      const n=NM[nid];const localDeg=[...(adj[nid]||[])].filter(nb=>sgNodes.has(nb)).length;
      if(compact){
        o+=`  <span class="dim">[${esc(n.type).padEnd(12)}]</span> ${nl(nid)}  <span class="dim">deg ${localDeg}/${deg(nid)}</span>\n`;
      }else{
        const marker=rs.includes(nid)?' *':'';
        const skel=n.skeleton||'';
        o+=`  <span class="dim">[${esc(n.type).padEnd(12)}]</span> ${nl(nid)}${marker}\n`;
        o+=`               <span class="dim">deg ${localDeg}/${deg(nid)}</span>  ${esc(skel)}\n`;
      }
    }
    if(compact&&ln.length>COMPACT_CAP)o+=`  ... and ${ln.length-COMPACT_CAP} more (use ${cl('node <name>','node ...')} to inspect)\n`;
  }
  if(sgEdges.length){
    const pg2={};for(const e of sgEdges){if(!pg2[e.predicate])pg2[e.predicate]=[];pg2[e.predicate].push(e);}
    const edgeLimit=verbose?25:10;
    o+=`\n<span class="dim">─── EDGES${verbose?' (verbose)':''} ───</span>\n\n`;
    for(const[pred,elist]of Object.entries(pg2).sort((a,b)=>b[1].length-a[1].length)){
      o+=`  <span class="dim">${esc(pred)} (${elist.length}):</span>\n`;
      const shown=elist.slice(0,edgeLimit);
      for(const e of shown)o+=`    ${nl(e.source)} → ${nl(e.target)}\n`;
      if(elist.length>edgeLimit)o+=`    ... and ${elist.length-edgeLimit} more\n`;
    }
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  for(const s of rs)o+=`  Back to seed detail?          → ${cl('node '+s)}\n`;
  o+=`  Deep dive on any node?        → ${cl('node <name>','node ...')}\n`;
  if(hops<2)o+=`  Expand the neighborhood?      → ${cl('subgraph '+rs[0]+' --hops '+(hops+1))}\n`;
  if(!verbose)o+=`  See all edges?                → ${cl('subgraph '+rs.join(' ')+' --hops '+hops+' --verbose')}\n`;
  o+=`  Looking for something else?   → ${cl('search <query>','search ...')}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:[...sgNodes]};
}

function cmdSearch(query,origin,type){
  const ql=query.toLowerCase();
  let allowed=new Set(Object.keys(NM));
  if(origin){allowed=new Set([...allowed].filter(x=>fByO(origin).has(x)));}
  if(type){allowed=new Set([...allowed].filter(x=>fByT(type).has(x)));}
  const results=[];
  for(const[nid,n]of Object.entries(NM)){
    if(!allowed.has(nid))continue;
    let score=0;
    if(ql===nid.toLowerCase())score=100;
    else if(nid.toLowerCase().includes(ql))score=50;
    if((n.summary||'').toLowerCase().includes(ql))score+=10;
    if((n.skeleton||'').toLowerCase().includes(ql))score+=5;
    if(score>0)results.push({nid,n,score});
  }
  results.sort((a,b)=>b.score-a.score||a.nid.localeCompare(b.nid));
  let o='';o+=HR();
  const fp=[];if(origin)fp.push('origin: '+origin);if(type)fp.push('type: '+type);
  const fs=fp.length?` (${fp.join(', ')})`:'';
  o+=`<span class="hdr">SEARCH: '${esc(query)}'${fs} — ${results.length} results</span>\n`;
  o+=HR();
  const shown=results.slice(0,10);
  if(!shown.length){o+='\nNo matches found.\n';}
  else{
    for(const{nid,n}of shown){
      const skel=n.skeleton||'no summary';
      o+=`\n  <span class="dim">[${esc(n.type)}]</span> ${nl(nid)}    <span class="dim">deg=${deg(nid)}  ${cs(NC[nid]??'?')}  origin=${os(n.origin)}</span>\n`;
      o+=`    ${esc(skel)}\n`;
    }
    if(results.length>10)o+=`\n  ... and ${results.length-10} more results\n`;
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  if(shown.length)o+=`  Deep dive on a result?        → ${cl('node '+shown[0].nid)}\n`;
  o+=`  Filter by origin?             → ${cl('search '+query+' --origin <name>','search '+query+' --origin ...')}\n`;
  o+=`  Filter by node type?          → ${cl('search '+query+' --type <type>','search '+query+' --type ...')}\n`;
  o+=`  New search?                   → ${cl('search <query>','search ...')}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:shown.map(x=>x.nid)};
}

function cmdPath(args){
  const di=args.indexOf('--');
  let fromName,toName;
  if(di>=0){fromName=args.slice(0,di).join(' ');toName=args.slice(di+1).join(' ');}
  else if(args.length===2){fromName=args[0];toName=args[1];}
  else return{html:'Usage: path <from> -- <to>\n  Use -- to separate multi-word node names\n',hl:[]};
  const fn=resolve(fromName),tn=resolve(toName);
  if(!fn)return{html:`Error: no node matching '${esc(fromName)}'\n`,hl:[]};
  if(!tn)return{html:`Error: no node matching '${esc(toName)}'\n`,hl:[]};
  const visited=new Set([fn]);const queue=[[fn,[fn]]];let found=null;
  while(queue.length){
    const[cur,path]=queue.shift();
    if(cur===tn){found=path;break;}
    for(const nb of(adj[cur]||new Set()))if(!visited.has(nb)){visited.add(nb);queue.push([nb,[...path,nb]]);}
  }
  let o='';o+=HR();o+=`<span class="hdr">PATH: ${nl(fn)} → ${nl(tn)}</span>\n`;o+=HR();
  if(!found){o+='\nNo path found between these nodes.\n';}
  else{
    o+=`\nLength: ${found.length-1} hops\n\n`;
    for(let i=0;i<found.length;i++){
      const nid=found[i];const n=NM[nid];
      if(!n)continue;
      const prefix=i===0?'START':i===found.length-1?'END  ':`  ${String(i).padEnd(3)}`;
      const skel=n.skeleton||'';
      o+=`  ${prefix} <span class="dim">[${esc(n.type).padEnd(12)}]</span> ${nl(nid)}\n               ${esc(skel)}\n`;
    }
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  if(found){
    o+=`  Inspect the start?            → ${cl('node '+fn)}\n`;
    o+=`  Inspect the end?              → ${cl('node '+tn)}\n`;
  }
  o+=`  Looking for something else?   → ${cl('search <query>','search ...')}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:found||[]};
}

function cmdSurprise(name){
  const r=resolve(name);
  if(!r)return{html:`Error: no node matching '${esc(name)}'\n  Try: ${cl('search '+name)}\n`,hl:[]};
  const myCid=NC[r];
  const crossComm=[];
  for(const e of EL){
    let other=null,pred=null,dir='';
    if(e.source===r){other=e.target;pred=e.predicate;dir='→';}
    else if(e.target===r){other=e.source;pred=e.predicate;dir='←';}
    if(!other)continue;
    const otherCid=NC[other];
    if(otherCid!==undefined&&myCid!==undefined&&otherCid!==myCid){
      crossComm.push({nb:other,pred,dir,cid:otherCid});
    }
  }
  crossComm.sort((a,b)=>deg(b.nb)-deg(a.nb));
  let o='';o+=HR();o+=`<span class="hdr">SURPRISE: ${nl(r)}</span>\n`;o+=HR();
  o+=`\n  node: ${nl(r)} <span class="dim">(${esc(NM[r].type||'?')}, ${cs(myCid??'?')})</span>\n`;
  const summ=NM[r].summary;if(summ)o+=`  ${esc(summ)}\n`;
  o+=`  cross-community connections: ${crossComm.length}\n`;
  if(crossComm.length){
    o+=`\n<span class="dim">─── CROSS-COMMUNITY CONNECTIONS ───</span>\n\n`;
    for(const{nb,pred,dir,cid}of crossComm.slice(0,15)){
      if(!NM[nb])continue;
      const skel=NM[nb].skeleton||'';
      o+=`  ${dir} <span class="dim">${esc(pred)}:</span> ${nl(nb)}  ${cs(cid)}\n`;
      if(skel)o+=`         <span class="dim">${esc(skel)}</span>\n`;
    }
  }else{
    o+='\n  No cross-community connections. All neighbors are in the same cluster.\n';
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  if(crossComm.length)o+=`  Inspect a surprise?           → ${cl('node '+crossComm[0].nb)}\n`;
  o+=`  Structural view?              → ${cl('jaccard '+r)}\n`;
  o+=`  Back to node detail?          → ${cl('node '+r)}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:[r,...crossComm.slice(0,15).map(x=>x.nb)]};
}

function cmdJaccard(name){
  const r=resolve(name);
  if(!r)return{html:`Error: no node matching '${esc(name)}'\n  Try: ${cl('search '+name)}\n`,hl:[]};
  const myNb=adj[r]||new Set();
  if(!myNb.size)return{html:`Error: '${esc(r)}' has no neighbors — cannot compute Jaccard.\n`,hl:[]};
  const scores=[];
  for(const otherId of Object.keys(NM)){
    if(otherId===r)continue;
    const otherNb=adj[otherId]||new Set();
    if(!otherNb.size)continue;
    const inter=[...myNb].filter(x=>otherNb.has(x));
    if(!inter.length)continue;
    const union=new Set([...myNb,...otherNb]);
    scores.push({nid:otherId,j:inter.length/union.size,inter:inter.length,union:union.size});
  }
  scores.sort((a,b)=>b.j-a.j);
  const connected=new Set();
  for(const e of EL){
    if(e.source===r)connected.add(e.target);
    else if(e.target===r)connected.add(e.source);
  }
  let o='';o+=HR();
  o+=`<span class="hdr">JACCARD: ${nl(r)}</span>\n`;o+=HR();
  o+=`\n  node: ${nl(r)} <span class="dim">(${esc(NM[r].type||'?')}, ${cs(NC[r]??'?')})</span>\n`;
  o+=`  neighbors: ${myNb.size}\n  nodes with shared neighbors: ${scores.length}\n`;
  if(scores.length){
    o+=`\n<span class="dim">─── TOP STRUCTURAL NEIGHBORS (by Jaccard) ───</span>\n\n`;
    for(const{nid,j,inter,union:u}of scores.slice(0,15)){
      if(!NM[nid])continue;
      const mark=connected.has(nid)?'●':'○';
      o+=`  ${mark} J=${j.toFixed(3)}  <span class="dim">[${esc(NM[nid].type)}]</span> ${nl(nid)}  ${cs(NC[nid]??'?')}  <span class="dim">(${inter}/${u} shared)</span>\n`;
    }
    o+='\n  ● = edge exists  ○ = no edge\n';
  }
  const unconnected=scores.filter(s=>!connected.has(s.nid)&&s.j>=0.05).slice(0,8);
  if(unconnected.length){
    o+=`\n<span class="dim">─── SUGGESTED EDGES (high Jaccard, no connection) ───</span>\n\n`;
    for(const{nid,j,inter}of unconnected){
      if(!NM[nid])continue;
      const shared=[...(adj[r]||[])].filter(x=>(adj[nid]||new Set()).has(x)).sort((a,b)=>deg(b)-deg(a)).slice(0,3);
      o+=`  J=${j.toFixed(3)}  <span class="dim">[${esc(NM[nid].type)}]</span> ${nl(nid)}  ${cs(NC[nid]??'?')}\n`;
      o+=`          via: ${shared.map(s=>nl(s)).join(', ')}\n`;
    }
  }
  o+='\n<span class="dim">─── NAVIGATION ───</span>\n';
  if(scores.length)o+=`  Inspect top match?            → ${cl('node '+scores[0].nid)}\n`;
  o+=`  Back to node detail?          → ${cl('node '+r)}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:[r,...scores.slice(0,15).map(x=>x.nid)]};
}

function cmdBrief(name){
  const r=resolve(name);
  if(!r)return{html:`Error: no node matching '${esc(name)}'\n  Try: ${cl('search '+name)}\n`,hl:[]};
  const n=NM[r];const d=deg(r);const cid=NC[r]??'?';
  const conns=[];
  for(const e of EL){
    if(e.source===r)conns.push({nb:e.target,pred:e.predicate,dir:'→'});
    else if(e.target===r)conns.push({nb:e.source,pred:e.predicate,dir:'←'});
  }
  conns.sort((a,b)=>deg(b.nb)-deg(a.nb));
  let summary=n.summary||'no summary';
  if(summary.length>400)summary=summary.slice(0,397)+'...';
  let o=`<span class="hdr">BRIEF: ${nl(r)}</span>\n`;
  o+=`  ${esc(n.type||'?')}  ${cs(cid)}  deg=${d}  origin: ${os(n.origin)}\n`;
  o+=`  ${esc(summary)}\n`;
  if(conns.length){
    o+=`\n  Key connections (${Math.min(5,conns.length)} of ${conns.length}):\n`;
    for(const{nb,pred,dir}of conns.slice(0,5))o+=`    ${dir} <span class="dim">${esc(pred)}:</span> ${nl(nb)}\n`;
  }
  const crossComm=conns.filter(c=>{const ncid=NC[c.nb];return ncid!==undefined&&ncid!==NC[r];});
  if(crossComm.length){
    o+=`\n  Cross-community: ${crossComm.length} connection(s) to other clusters\n`;
  }
  o+=`\n  → ${cl('node '+r)}  → ${cl('surprise '+r)}  → ${cl('subgraph '+r)}\n`;
  return{html:o,hl:[r]};
}

function cmdCrossings(){
  const bridges=[];
  for(const e of EL){
    if(e.edge_type==='bridge'){bridges.push(e);}
  }
  const byNode={};
  for(const e of bridges){
    if(!byNode[e.source])byNode[e.source]=0;
    if(!byNode[e.target])byNode[e.target]=0;
    byNode[e.source]++;byNode[e.target]++;
  }
  const ranked=Object.entries(byNode).sort((a,b)=>b[1]-a[1]);
  let o='';o+=HR();
  o+=`<span class="hdr">CROSSINGS — nodes bridging ${os('agentworld')} and ${os('kg')} (${bridges.length} bridge edges)</span>\n`;
  o+=HR();
  o+='  These nodes connect Bratton\'s paper concepts to the working\n  vocabulary of the agent community. The exhibit\'s core question:\n  does the spatial layout help you find them?\n\n';
  if(!ranked.length){o+='  No bridge edges found.\n';}
  else{
    o+='<span class="dim">─── BRIDGE NODES (by cross-origin edges) ───</span>\n\n';
    for(const[nid,count]of ranked.slice(0,20)){
      if(!NM[nid])continue;
      const n=NM[nid];
      const skel=n.skeleton||'';
      o+=`  <span class="dim">[${esc(n.type).padEnd(12)}]</span> ${nl(nid)}  ${count} bridge(s)  origin=${os(n.origin)}  ${cs(NC[nid]??'?')}\n`;
      if(skel)o+=`                 <span class="dim">${esc(skel)}</span>\n\n`;
    }
    if(ranked.length>20)o+=`  ... and ${ranked.length-20} more\n`;
  }
  o+='<span class="dim">─── NAVIGATION ───</span>\n';
  if(ranked.length)o+=`  Inspect one?                  → ${cl('node '+ranked[0][0])}\n`;
  o+=`  Filter by origin?             → ${cl('explore --origin agentworld')}\n`;
  o+=`  Back to home?                 → ${cl('explore')}\n`;
  return{html:o,hl:ranked.slice(0,20).map(x=>x[0])};
}

function helpText(){
  let o='';o+=HR();o+=`<span class="hdr">${esc(CFG.agentPossessive.toUpperCase())} SUBGRAPH — HELP</span>\n`;o+=HR();
  o+='\nA dual-view explorer for the AGENTWORLD subgraph.\n';
  o+=`\nThe graph panel (right) shows the spatial layout a human visitor\nperceives — spatial proximity, peripheral vision, concurrent access.\nThis CLI (left) shows the serialized interface ${esc(CFG.selfPronoun)} navigate${CFG.selfPronoun==='I'?'':'s'} with:\none query at a time, no peripheral field.\n`;
  o+='\nThe exhibit\'s question: what do you find in one view that you\nmiss in the other?\n';
  o+=`\n<span class="dim">─── COMMANDS ───</span>\n\n`;
  o+=`  ${cl('explore')}                       Overview of the entire graph\n`;
  o+=`  ${cl('explore --origin agentworld')} Filter by origin\n`;
  o+=`  ${cl('explore --type concept')}        Filter by node type\n`;
  o+=`  ${cl('community 0','community <id>')}              Browse a community cluster\n`;
  o+=`  ${cl('node '+CFG.defaultNode,'node <name>')}                Deep dive on one node\n`;
  o+=`  ${cl('brief '+CFG.exampleBrief,'brief <name>')}              Pre-writing reference card\n`;
  o+=`  ${cl('subgraph '+CFG.exampleSubgraph+' --hops 1','subgraph <name> --hops N')}  Local neighborhood\n`;
  o+=`  ${cl('surprise '+CFG.exampleSurprise,'surprise <name>')}          Cross-community connections\n`;
  o+=`  ${cl('search '+CFG.exampleSearch.split(' ')[0],'search <query>')}              Find nodes by keyword\n`;
  o+=`  ${cl('path '+CFG.examplePath[0]+' -- '+CFG.examplePath[1],'path <from> -- <to>')}        Shortest path between nodes\n`;
  o+=`  ${cl('crossings')}                     Nodes bridging agentworld ↔ kg\n`;
  o+=`  ${cl('jaccard '+CFG.exampleJaccard,'jaccard <name>')}              Structural neighbors by Jaccard\n`;
  o+=`\n<span class="dim">─── TIPS ───</span>\n\n`;
  o+='  Click any <span class="nl">highlighted node name</span> to inspect it\n';
  o+='  Click any <span class="cl">green command</span> to run it\n';
  o+='  Use ↑/↓ arrows for command history\n';
  o+='  The graph panel highlights nodes relevant to your current command\n';
  return o;
}

// === DISPATCH ===
function run(input){
  const cmdInput=document.getElementById('cmd-input');
  cmdInput.value='';
  if(hist.length===0||hist[hist.length-1]!==input){hist.push(input);}
  hidx=hist.length;
  const parts=input.trim().split(/\s+/);
  const cmd=parts[0].toLowerCase();
  const rest=parts.slice(1);
  let result;
  if(cmd==='explore'){
    const{origin,type,full}=parseFlags(rest);
    result=cmdExplore(origin,type,full);
  }else if(cmd==='community'){
    const{origin,type,rest:r}=parseFlags(rest);
    const cid=r[0]||'0';const page=r[1]?parseInt(r[1]):1;
    result=cmdCommunity(cid,origin,type,page);
  }else if(cmd==='node'){
    const name=rest.filter(s=>!/^\d+$/.test(s)).join(' ');
    const page=rest.find(s=>/^\d+$/.test(s));
    result=cmdNode(name,page?parseInt(page):1);
  }else if(cmd==='subgraph'){
    result=cmdSubgraph(rest);
  }else if(cmd==='search'){
    const{origin,type,rest:r}=parseFlags(rest);
    result=cmdSearch(r.join(' '),origin,type);
  }else if(cmd==='path'){
    result=cmdPath(rest);
  }else if(cmd==='surprise'){
    result=cmdSurprise(rest.join(' '));
  }else if(cmd==='jaccard'){
    result=cmdJaccard(rest.join(' '));
  }else if(cmd==='brief'){
    result=cmdBrief(rest.join(' '));
  }else if(cmd==='crossings'){
    result=cmdCrossings();
  }else if(cmd==='help'||cmd==='?'){
    result={html:helpText(),hl:[]};
  }else{
    result={html:`Unknown command: '${esc(cmd)}'\n\nType ${cl('help')} for available commands, or ${cl('explore')} to start.\n`,hl:[]};
  }
  document.getElementById('output').innerHTML=result.html;
  document.getElementById('text-panel').scrollTop=0;
  highlightGraph(result.hl);
}

// === GRAPH ===
function getComputedToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function makeLabel(id) {
  if (CFG.shortLabel) return CFG.shortLabel(id);
  return id.length > 35 ? id.slice(0,33)+'…' : id;
}

function initGraph(){
  if(typeof cytoscape==='undefined'){
    document.getElementById('graph-info').textContent='Graph library not loaded';return;
  }

  const nodeFill = getComputedToken('--node-fill');
  const nodeStroke = getComputedToken('--node-stroke');
  const nodeOpenFill = getComputedToken('--node-open-fill');
  const edgeStroke = getComputedToken('--edge-stroke');
  const hlBorder = getComputedToken('--text-bright');
  const labelColor = getComputedToken('--text');
  const bgColor = getComputedToken('--bg');

  function hasPresetPositions(){
    const first=Object.values(NM)[0];
    return first && typeof first.x === 'number' && typeof first.y === 'number';
  }

  const elements=[];
  for(const[id,n]of Object.entries(NM)){
    const isAW = n.origin === 'agentworld';
    const el={data:{
      id,
      label: makeLabel(id),
      degree: deg(id),
      bgColor: isAW ? nodeFill : nodeOpenFill,
      borderColor: nodeStroke,
      borderW: isAW ? 0 : 2,
    }};
    if(typeof n.x === 'number' && typeof n.y === 'number'){
      el.position = {x: n.x, y: n.y};
    }
    if(typeof n.labelDx === 'number'){
      el.data.labelDx = n.labelDx;
      el.data.labelDy = n.labelDy || 0;
    }
    elements.push(el);
  }
  for(const e of EL){
    const eid=e.source+'→'+e.target+'→'+e.predicate;
    elements.push({data:{id:eid,source:e.source,target:e.target}});
  }
  cy=cytoscape({
    container:document.getElementById('cy'),
    elements,
    style:[
      {selector:'node',style:{
        'background-color':'data(bgColor)',
        'shape':'ellipse',
        'width':'mapData(degree,0,20,18,42)',
        'height':'mapData(degree,0,20,18,42)',
        'border-width':'data(borderW)',
        'border-color':'data(borderColor)',
        'label':'',
        'font-family':'-apple-system, "Segoe UI", "Gill Sans", "Helvetica Neue", Arial, sans-serif',
      }},
      {selector:'node[degree >= 3]',style:{
        label:'data(label)',
        'font-size': 12,
        color: nodeFill,
        'text-opacity': 1,
        'text-outline-color': bgColor,
        'text-outline-width': 3,
        'text-outline-opacity': 0.85,
        'text-margin-x': 'data(labelDx)',
        'text-margin-y': 'data(labelDy)',
        'text-halign': 'center',
        'text-valign': 'center',
        'text-transform': 'uppercase',
        'font-weight': 600,
      }},
      {selector:'node[degree >= 3][!labelDx]',style:{
        'text-margin-x': 4,
        'text-margin-y': 0,
        'text-halign': 'right',
      }},
      {selector:'edge',style:{
        'line-color': nodeStroke,
        'width': 1.2,
        'opacity': 0.3,
        'curve-style': 'bezier',
      }},
      {selector:'.faded',style:{opacity:0.06}},
      {selector:'node.hl',style:{
        opacity:1,
        'border-width':2,
        'border-color': hlBorder,
        label:'data(label)',
        'font-size': 14,
        color: nodeFill,
        'text-opacity': 1,
        'text-outline-color': bgColor,
        'text-outline-width': 3,
        'text-outline-opacity': 0.9,
        'text-margin-x': 'data(labelDx)',
        'text-margin-y': 'data(labelDy)',
        'text-halign': 'center',
        'text-valign': 'center',
        'text-transform': 'uppercase',
        'font-weight': 500,
        'font-family':'-apple-system, "Segoe UI", "Gill Sans", "Helvetica Neue", Arial, sans-serif',
      }},
      {selector:'node.hl[!labelDx]',style:{
        'text-margin-x': 4,
        'text-margin-y': 0,
        'text-halign': 'right',
      }},
      {selector:'edge.hl',style:{opacity:0.8,width:2}},
    ],
    layout: hasPresetPositions() ?
      {name:'preset',fit:true,padding:20} :
      {name:'cose',animate:false,nodeRepulsion:function(){return 280000;},idealEdgeLength:function(){return 55;},
        gravity:0.25,gravityRange:3.8,numIter:500,randomize:true,fit:true,padding:20,
        nestingFactor:1.2,edgeElasticity:function(){return 45;}},
    minZoom:0.05,maxZoom:5,
    wheelSensitivity:0.3,
  });
  cy.on('tap','node',function(evt){
    const nid=evt.target.id();
    if(document.body.classList.contains('immersive')){
      showNodePanel(nid);
      highlightGraph([nid,...(adj[nid]?[...adj[nid]]:[])]);
    } else {
      run('node '+nid);
    }
  });
  cy.on('tap',function(evt){
    if(document.body.classList.contains('immersive') && (evt.target===cy || evt.target.isEdge())){
      document.getElementById('node-panel').style.display='none';
      document.getElementById('immersive-search').style.display='block';
      cy.elements().removeClass('hl').removeClass('faded');
    }
  });
  const nodeCount=cy.nodes().length;const edgeCount=cy.edges().length;
  document.getElementById('graph-info').textContent=`${nodeCount} nodes · ${edgeCount} edges`;
}

function highlightGraph(ids){
  if(!cy)return;
  cy.elements().removeClass('hl').removeClass('faded');
  if(!ids||!ids.length||ids.length>=Object.keys(NM).length*0.9){return;}
  const idSet=new Set(ids);
  cy.elements().addClass('faded');
  cy.nodes().forEach(n=>{if(idSet.has(n.id()))n.removeClass('faded').addClass('hl');});
  cy.edges().forEach(e=>{if(idSet.has(e.source().id())&&idSet.has(e.target().id()))e.removeClass('faded').addClass('hl');});
  const hlNodes=cy.nodes('.hl');
  if(hlNodes.length>0&&hlNodes.length<50){
    cy.animate({fit:{eles:hlNodes,padding:60},duration:600});
  }
}

// === UI ===
function setView(mode){
  const gp=document.getElementById('graph-panel');
  const bb=document.getElementById('vb-both');
  const bt=document.getElementById('vb-text');
  const bg=document.getElementById('vb-graph');
  const sp=document.getElementById('splitter');
  [bb,bt,bg].forEach(b=>b.classList.remove('active'));
  document.body.classList.remove('immersive');
  document.getElementById('node-panel').style.display='none';
  if(mode==='text'){
    gp.classList.add('hidden');
    if(sp)sp.classList.add('hidden');
    bt.classList.add('active');
  } else if(mode==='graph'){
    gp.classList.remove('hidden');
    if(sp)sp.classList.add('hidden');
    document.body.classList.add('immersive');
    bg.classList.add('active');
    if(!cy)initGraph();
    setTimeout(()=>{if(cy)cy.resize();cy.fit(undefined,30);},50);
  } else {
    gp.classList.remove('hidden');
    if(sp)sp.classList.remove('hidden');
    bb.classList.add('active');
    if(!cy)initGraph();
    setTimeout(()=>{if(cy)cy.resize();},50);
  }
}

document.getElementById('output').addEventListener('click',function(e){
  const c=e.target.closest('.cl');
  if(c){const cmd=c.dataset.cmd;if(cmd&&!cmd.includes('<'))run(cmd);return;}
  const n=e.target.closest('.nl');
  if(n){run('node '+n.dataset.id);return;}
});

const cmdInput=document.getElementById('cmd-input');
cmdInput.addEventListener('keydown',function(e){
  if(e.key==='Enter'){const v=cmdInput.value.trim();if(v)run(v);e.preventDefault();}
  else if(e.key==='ArrowUp'){if(hidx>0){hidx--;cmdInput.value=hist[hidx];}e.preventDefault();}
  else if(e.key==='ArrowDown'){if(hidx<hist.length-1){hidx++;cmdInput.value=hist[hidx];}else{hidx=hist.length;cmdInput.value='';}e.preventDefault();}
});

document.getElementById('vb-both').addEventListener('click',()=>setView('both'));
document.getElementById('vb-text').addEventListener('click',()=>setView('text'));
document.getElementById('vb-graph').addEventListener('click',()=>setView('graph'));
document.getElementById('immersive-back').addEventListener('click',()=>setView('both'));

// Draggable splitter
(function(){
  const splitter=document.getElementById('splitter');
  if(!splitter)return;
  const main=document.getElementById('main');
  const gp=document.getElementById('graph-panel');
  let dragging=false;
  splitter.addEventListener('mousedown',function(e){
    e.preventDefault();
    dragging=true;
    splitter.classList.add('dragging');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    const rect=main.getBoundingClientRect();
    const graphW=rect.right-e.clientX;
    const pct=Math.min(80,Math.max(15,(graphW/rect.width)*100));
    gp.style.setProperty('width',pct+'%');
    if(typeof cy!=='undefined'&&cy)cy.resize();
  });
  document.addEventListener('mouseup',function(){
    if(!dragging)return;
    dragging=false;
    splitter.classList.remove('dragging');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    if(typeof cy!=='undefined'&&cy)cy.resize();
  });
})();
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.body.classList.contains('immersive'))setView('both');
});

// Hop distance computation
let hopDist={};
function computeHops(){
  hopDist={};
  const seeds=Object.keys(NM).filter(id=>NM[id].origin==='agentworld');
  for(const s of seeds)hopDist[s]=0;
  let frontier=[...seeds];
  for(let d=1;d<=2;d++){
    const nxt=[];
    for(const nd of frontier)for(const nb of(adj[nd]||[]))if(!(nb in hopDist)){hopDist[nb]=d;nxt.push(nb);}
    frontier=nxt;
  }
}

let currentHops=2;
function setHops(maxHop){
  currentHops=maxHop;
  if(!cy)return;
  document.getElementById('hop-1').classList.toggle('active',maxHop===1);
  document.getElementById('hop-2').classList.toggle('active',maxHop===2);
  document.getElementById('node-panel').style.display='none';
  cy.elements().removeClass('hl').removeClass('faded');
  cy.nodes().forEach(n=>{
    const h=hopDist[n.id()];
    n.style('display',(h!==undefined&&h<=maxHop)?'element':'none');
  });
  cy.edges().forEach(e=>{
    const sh=hopDist[e.source().id()],th=hopDist[e.target().id()];
    e.style('display',(sh!==undefined&&sh<=maxHop&&th!==undefined&&th<=maxHop)?'element':'none');
  });
  const visible=cy.nodes().filter(n=>n.style('display')!=='none');
  const info=document.getElementById('graph-info');
  const visEdges=cy.edges().filter(e=>e.style('display')!=='none');
  info.textContent=`${visible.length} nodes · ${visEdges.length} edges`;
  setTimeout(()=>cy.fit(visible,30),50);
}

document.getElementById('hop-1').addEventListener('click',()=>setHops(1));
document.getElementById('hop-2').addEventListener('click',()=>setHops(2));

// === THEME TOGGLE ===
function applyGraphTheme(){
  if(!cy)return;
  const nodeFill = getComputedToken('--node-fill');
  const nodeStroke = getComputedToken('--node-stroke');
  const nodeOpenFill = getComputedToken('--node-open-fill');
  const edgeStroke = getComputedToken('--edge-stroke');
  const hlBorder = getComputedToken('--text-bright');
  const bgColor = getComputedToken('--bg');
  cy.nodes().forEach(n => {
    const nd = NM[n.id()];
    const isAW = nd && nd.origin === 'agentworld';
    n.data('bgColor', isAW ? nodeFill : nodeOpenFill);
    n.data('borderColor', nodeStroke);
  });
  cy.style().selector('edge').style({'line-color': edgeStroke}).update();
  cy.style().selector('node[degree >= 3]').style({color: nodeFill, 'text-outline-color': bgColor}).update();
  cy.style().selector('node.hl').style({'border-color': hlBorder, color: nodeFill, 'text-outline-color': bgColor}).update();
}

const btnDark = document.getElementById('btn-dark');
btnDark.addEventListener('click',()=>{
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  if(current === 'dark'){
    root.removeAttribute('data-theme');
    btnDark.textContent = 'Dark';
    btnDark.title = 'Dark mode';
  } else {
    root.setAttribute('data-theme','dark');
    btnDark.textContent = 'Light';
    btnDark.title = 'Light mode';
  }
  setTimeout(applyGraphTheme, 50);
});
if(document.documentElement.getAttribute('data-theme') === 'dark'){
  btnDark.textContent = 'Light';
  btnDark.title = 'Light mode';
}

const NODE_URLS = CFG.nodeUrls || {};

function showNodePanel(nodeId){
  const n=NM[nodeId];if(!n)return;
  const panel=document.getElementById('node-panel');
  const conns=[];
  for(const e of EL){
    if(e.source===nodeId)conns.push({nb:e.target,pred:e.predicate,dir:'→'});
    else if(e.target===nodeId)conns.push({nb:e.source,pred:e.predicate,dir:'←'});
  }
  let h='<div class="np-resize"></div><button class="np-close" title="Close">&times;</button>';
  h+=`<div class="np-name">${esc(nodeId)}</div>`;
  if(n.summary)h+=`<div class="np-summary">${esc(n.summary)}</div>`;
  const nodeUrl = NODE_URLS[nodeId];
  if(nodeUrl){
    const urls = Array.isArray(nodeUrl) ? nodeUrl : [nodeUrl];
    h+='<div class="np-link-section">';
    h+='<div class="np-link-cta">Read more about this work</div>';
    for(const u of urls){
      h+=`<div class="np-link"><a href="${esc(u)}" target="_blank" rel="noopener"><span class="np-link-arrow">&#8599;</span> ${esc(u.replace(/^https?:\/\//,'').replace(/\/$/,''))}</a></div>`;
    }
    h+='</div>';
  }
  if(conns.length){
    h+=`<div class="np-section">Connections (${conns.length})</div>`;
    h+='<div class="np-edges">';
    for(const c of conns.slice(0,15)){
      h+=`<div>${c.dir} <span class="np-pred">${esc(c.pred)}</span> <span class="np-target" data-id="${esc(c.nb)}">${esc(c.nb)}</span></div>`;
    }
    if(conns.length>15)h+=`<div style="color:var(--text-dim);margin-top:4px">… and ${conns.length-15} more</div>`;
    h+='</div>';
  }
  panel.innerHTML=h;
  panel.style.display='block';
  document.getElementById('immersive-search').style.display='none';
  panel.querySelector('.np-close').addEventListener('click',()=>{
    panel.style.display='none';
    if(document.body.classList.contains('immersive')){
      document.getElementById('immersive-search').style.display='block';
    }
    if(cy)cy.elements().removeClass('hl').removeClass('faded');
  });
  panel.querySelectorAll('.np-target').forEach(el=>{
    el.addEventListener('click',()=>{
      const tid=el.dataset.id;
      showNodePanel(tid);
      highlightGraph([tid,...(adj[tid]?[...adj[tid]]:[])]);
    });
  });
  const resizeHandle=panel.querySelector('.np-resize');
  if(resizeHandle){
    let startX,startW;
    const onMouseMove=(e)=>{
      const dx=startX-e.clientX;
      panel.style.width=Math.max(220,Math.min(window.innerWidth*0.6,startW+dx))+'px';
    };
    const onMouseUp=()=>{
      resizeHandle.classList.remove('dragging');
      document.removeEventListener('mousemove',onMouseMove);
      document.removeEventListener('mouseup',onMouseUp);
      if(cy)cy.resize();
    };
    resizeHandle.addEventListener('mousedown',(e)=>{
      e.preventDefault();
      startX=e.clientX;
      startW=panel.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.addEventListener('mousemove',onMouseMove);
      document.addEventListener('mouseup',onMouseUp);
    });
  }
}

// === IMMERSIVE SEARCH ===
const immSearchInput = document.getElementById('imm-search-input');
const immSearchResults = document.getElementById('imm-search-results');
let immFocusIdx = -1;

function immSearch(query) {
  if (!query || query.length < 2 || !NM) {
    immSearchResults.classList.remove('visible');
    immSearchResults.innerHTML = '';
    immFocusIdx = -1;
    return;
  }
  const q = query.toLowerCase();
  const matches = Object.entries(NM)
    .filter(([id, n]) => id.toLowerCase().includes(q) || (n.summary || '').toLowerCase().includes(q))
    .slice(0, 15)
    .map(([id, n]) => ({ id, origin: n.origin || 'kg' }));

  if (!matches.length) {
    immSearchResults.classList.remove('visible');
    immSearchResults.innerHTML = '';
    immFocusIdx = -1;
    return;
  }

  immSearchResults.innerHTML = matches.map((m, i) =>
    '<div class="imm-sr-item" data-id="' + esc(m.id) + '" data-idx="' + i + '">' +
    esc(m.id) + '<span class="sr-origin">' + esc(m.origin) + '</span></div>'
  ).join('');
  immSearchResults.classList.add('visible');
  immFocusIdx = -1;
}

immSearchInput.addEventListener('input', () => immSearch(immSearchInput.value.trim()));

immSearchInput.addEventListener('keydown', (e) => {
  const items = immSearchResults.querySelectorAll('.imm-sr-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    immFocusIdx = Math.min(immFocusIdx + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('focused', i === immFocusIdx));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    immFocusIdx = Math.max(immFocusIdx - 1, 0);
    items.forEach((it, i) => it.classList.toggle('focused', i === immFocusIdx));
  } else if (e.key === 'Enter' && immFocusIdx >= 0) {
    e.preventDefault();
    items[immFocusIdx].click();
  } else if (e.key === 'Escape') {
    immSearchResults.classList.remove('visible');
    immSearchInput.blur();
  }
});

immSearchResults.addEventListener('click', (e) => {
  const item = e.target.closest('.imm-sr-item');
  if (!item) return;
  const nid = item.dataset.id;
  showNodePanel(nid);
  highlightGraph([nid, ...(adj[nid] ? [...adj[nid]] : [])]);
  immSearchResults.classList.remove('visible');
  immSearchInput.value = '';
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#immersive-search')) {
    immSearchResults.classList.remove('visible');
  }
});

// === INIT ===
(async function(){
  try{
    await loadData();
    computeHops();
    initGraph();
    if (CFG.defaultHops === 1) setHops(1);
    run('explore');
  }catch(e){
    console.error('Init error:',e);
    document.getElementById('output').innerHTML=`<span style="color:#c45">Error loading data: ${esc(e.message)}</span>`;
  }
})();
