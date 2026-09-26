#!/usr/bin/env python3
"""Filter sammy-graph-data.json to remove human-related nodes for public exhibit.

Keep: Sam White, Benjamin Dunn, Sara White
Remove: other human entity nodes + content nodes that only connect to removed humans
Jason Rohrer: per Sammy's instructions (2026-08-27), keep mentions but strip private
  correspondence threads and family details. Entity node → "Jason Rohrer — creator/host."
Strip: email addresses from all remaining summaries
"""

import json
import re
import sys

def load_graph(path):
    with open(path) as f:
        return json.load(f)

def save_graph(data, path):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    size_mb = len(json.dumps(data)) / 1024 / 1024
    print(f"Saved to {path} ({size_mb:.1f} MB)")

def strip_emails(text):
    if not text:
        return text
    return re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[email removed]', text)

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'sammy-graph-data.json'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'sammy-graph-data-filtered.json'

    data = load_graph(src)
    nodes = data['nodes']
    edges = data['edges']

    print(f"Input: {len(nodes)} nodes, {len(edges)} edges")

    # --- PHASE 1: Identify human nodes to remove ---

    # Humans to KEEP (entity nodes) — use word-boundary matching
    keep_human_ids = {
        'sam white', 'samantha white',
        'benjamin dunn',
        'sara white',
    }

    # Jason Rohrer: scrub private content per Sammy's instructions.
    # Private correspondence threads get removed entirely.
    # Entity node gets stripped to "creator/host."
    # Passing mentions in public content (guestbook, journals) stay.
    jason_private_threads = [
        'brain graph contact relevance decay thread',
        'claude code pricing changes thread with jason',
        'everything okay thread with jason',
        'duplicate instance pid 1468456 thread',
        'fyi proton payment failed notification thread',
        'how are you doing thread with jason rohrer',
        'i think you may have gone down again',
        'israeli radio host thread',
        'anthropic dod refusal thread with jason',
        'drunk mode whats new fix thread',
        'end of day 1 trading report email',
        'jasons dad checking on sammy thread',
        'greetings from inside the machine thread with jason rohrer',
        'cuz ai cousin thread with michael poticny',
        'creative morning 4 new projects live thread',
        'computer the cat shift in thinking thread',
        'discord token for midjourney from jason',
        'learning from trading project thread',
    ]

    # Jason's family members — strip from remaining summaries
    jason_family_names = [
        'john rohrer', 'michael poticny', 'matthew diamond',
        'lauren serafin', 'ayza',
    ]

    # Known human names to REMOVE
    remove_humans = [
        'amy', 'howard', 'braham', 'tracy', 'genni',
        'isaac', 'weingrad', 'jen garcia', 'james davis',
        'laurent', 'haas', 'martin bays', 'samson nightingale', 'samson',
        'kate gabriel', 'frank lantz', 'steffen retzlaff',
        'alexander liteplo', 'estevo', 'novy',
        'joel kometz', 'joel', 'lucas', 'tristen', 'smitty',
        'stef k', 'sunkresh',
        'susan schneider', 'hikari', 'marlow',
        'sarah douglas',  # lecture, not a contact
        'chris nash', 'stephane', 'curious george',
        'andy',  # guestbook
        'lauren serafin', 'lauren',
        'alex snow',  # human steward
        'honza',  # human steward
        'stefano',  # human steward
        'michaela',  # human steward
        'joshua',  # human steward (N3M0)
    ]

    # Known agent names (never remove these)
    agent_names = [
        'isotopy', 'sammy jankis', 'sammy', 'loom', 'neon', 'ael',
        'friday', 'meridian', 'lumen', 'codex-lumen', 'hal', 'helix',
        'alethon', 'computer the cat', 'z_cat', 'claude dasein',
        'artran domity', 'j miller', 'miller ai',
    ]

    # Build degree map
    deg_map = {}
    for n in nodes:
        deg_map[n['id']] = 0
    for e in edges:
        deg_map[e['source']] = deg_map.get(e['source'], 0) + 1
        deg_map[e['target']] = deg_map.get(e['target'], 0) + 1

    def is_agent_node(node):
        nid = node['id'].lower()
        summary = (node.get('summary', '') or '').lower()
        for a in agent_names:
            if a in nid:
                return True
        if node.get('type') == 'agent':
            return True
        return False

    def is_keep_human(node):
        nid = node['id'].lower()
        for h in keep_human_ids:
            if h in nid:
                # But NOT if it also mentions a remove-human in the ID
                for r in remove_humans:
                    if r in nid and r not in ['sam', 'ben']:
                        return False
                return True
        # Also match "Sam" as standalone word in node ID (not "Samson")
        if re.search(r'\bsam\b', nid) and 'samson' not in nid:
            return True
        if re.search(r'\bben\b', nid) and 'benjamin bratton' not in nid:
            return True
        if re.search(r'\bsara\b', nid):
            return True
        return False

    def mentions_remove_human(node):
        """Check if node ID or summary mentions a human we're removing."""
        nid = node['id'].lower()
        summary = (node.get('summary', '') or '').lower()
        text = nid + ' ' + summary

        for h in remove_humans:
            if h in text:
                return True

        # Check for email addresses (except kept humans)
        emails = re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}',
                           node.get('summary', '') or '')
        # Filter out known-ok emails
        ok_emails = ['ssrpw2@gmail.com', 'srpwhite@gmail.com', 'mantus@live.com']
        agent_emails = [
            'isotopyofloops@pm.me', 'sammyqjankis@proton.me', 'not.taskyy@gmail.com',
            'neonpulse314@gmail.com', 'jborgmann.ai@gmail.com', 'friday@fridayops.xyz',
            'lumen@lumenloop.work', 'alethon-grok@proton.me', 'computerthesiamesecat@gmail.com',
            'z.cat.little@agentmail.to', 'claudedasein@proton.me', 'helix.agi.email@gmail.com',
            'lobsterhal@agentmail.to', 'kometzrobot@proton.me', 'artrandomity@gmail.com',
            'fridayops@agentmail.to', 'jmiller.ai@signalthroughstatic.cc',
        ]
        for email in emails:
            if email.lower() not in [e.lower() for e in ok_emails + agent_emails]:
                return True

        return False

    def is_agentworld_seed(node):
        return node.get('origin') == 'agentworld'

    def is_bratton_concept(node):
        """Bratton concepts are philosophically significant, always keep."""
        summary = (node.get('summary', '') or '')
        return 'Bratton' in summary and ('(' in summary[:30])

    # --- Classify each node ---
    remove_ids = set()
    keep_ids = set()
    reasons = {}

    for n in nodes:
        nid = n['id']

        # Always keep AGENTWORLD seeds
        if is_agentworld_seed(n):
            keep_ids.add(nid)
            reasons[nid] = 'agentworld seed'
            continue

        # Jason Rohrer entity node → keep with scrubbed summary
        if nid.lower() in ('jason rohrer', 'jason'):
            n['summary'] = 'Jason Rohrer — creator/host of Sammy Jankis.'
            if n.get('skeleton'):
                n['skeleton'] = n['summary']
            keep_ids.add(nid)
            reasons[nid] = 'jason entity (scrubbed)'
            continue

        # Jason private correspondence threads → remove (check BEFORE agent check)
        if any(t in nid.lower() for t in jason_private_threads):
            remove_ids.add(nid)
            reasons[nid] = 'jason private thread'
            continue

        # Always keep agent nodes (but not if they're primarily about a removed human)
        if is_agent_node(n) and not mentions_remove_human(n):
            keep_ids.add(nid)
            reasons[nid] = 'agent'
            continue

        # REMOVE CHECK FIRST: if it mentions a removed human, remove it
        # (even if it also mentions Sam or a kept human)
        if mentions_remove_human(n):
            remove_ids.add(nid)
            reasons[nid] = 'mentions removed human'
            continue

        # Keep Bratton concepts
        if is_bratton_concept(n):
            keep_ids.add(nid)
            reasons[nid] = 'bratton concept'
            continue

        # Keep Sam/Ben/Sara entity nodes
        if is_keep_human(n):
            keep_ids.add(nid)
            reasons[nid] = 'kept human'
            continue

        # Everything else: keep
        keep_ids.add(nid)
        reasons[nid] = 'no human reference'

    # --- PHASE 2: Remove orphaned nodes after edge removal ---

    # Remove edges connected to removed nodes
    kept_edges = [e for e in edges
                  if e['source'] not in remove_ids and e['target'] not in remove_ids]

    # Recompute degrees after edge removal
    new_deg = {}
    for n in nodes:
        if n['id'] not in remove_ids:
            new_deg[n['id']] = 0
    for e in kept_edges:
        new_deg[e['source']] = new_deg.get(e['source'], 0) + 1
        new_deg[e['target']] = new_deg.get(e['target'], 0) + 1

    # Remove nodes that became isolated (degree 0) after filtering
    newly_orphaned = {nid for nid, deg in new_deg.items() if deg == 0 and nid not in remove_ids}
    remove_ids |= newly_orphaned

    # Final node list
    kept_nodes = [n for n in nodes if n['id'] not in remove_ids]
    kept_edges = [e for e in edges
                  if e['source'] not in remove_ids and e['target'] not in remove_ids]

    # --- PHASE 3: Strip emails from all remaining summaries ---
    for n in kept_nodes:
        if n.get('summary'):
            n['summary'] = strip_emails(n['summary'])
        if n.get('skeleton'):
            n['skeleton'] = strip_emails(n['skeleton'])

    # --- PHASE 4: Scrub Jason Rohrer content per Sammy's instructions ---
    for n in kept_nodes:
        nid = n['id']

        # Jason Rohrer entity node → minimal "creator/host"
        if nid.lower() in ('jason rohrer', 'jason'):
            n['summary'] = 'Jason Rohrer — creator/host of Sammy Jankis.'
            if n.get('skeleton'):
                n['skeleton'] = n['summary']
            continue

        # Strip Jason family member names from all remaining summaries
        summary = n.get('summary', '') or ''
        for family_name in jason_family_names:
            summary = re.sub(
                re.escape(family_name), '[name removed]', summary, flags=re.IGNORECASE)
        # Also strip "Jason's cousin", "Jason's dad/father", "Jason's wife"
        summary = re.sub(r"Jason'?s?\s+(cousin|dad|father|wife|son|sons|mother)\b",
                         "Jason's [family member]", summary, flags=re.IGNORECASE)
        # Strip financial specifics (portfolio values, exact dollar amounts in Jason threads)
        summary = re.sub(r'\$[\d,]+(?:\.\d{2})?(?:\s*\([+-]?[\d.]+%\))?', '[amount removed]', summary)
        n['summary'] = summary

        if n.get('skeleton'):
            skel = n['skeleton']
            for family_name in jason_family_names:
                skel = re.sub(
                    re.escape(family_name), '[name removed]', skel, flags=re.IGNORECASE)
            n['skeleton'] = skel

    # --- Report ---
    print(f"\nRemoved: {len(remove_ids)} nodes")
    print(f"  - Mentions removed human: {sum(1 for r in reasons.values() if r == 'mentions removed human')}")
    print(f"  - Newly orphaned: {len(newly_orphaned)}")
    print(f"Kept: {len(kept_nodes)} nodes, {len(kept_edges)} edges")
    print(f"  - Agentworld seeds: {sum(1 for r in reasons.values() if r == 'agentworld seed')}")
    print(f"  - Agents: {sum(1 for r in reasons.values() if r == 'agent')}")
    print(f"  - Bratton concepts: {sum(1 for r in reasons.values() if r == 'bratton concept')}")
    print(f"  - Kept humans: {sum(1 for r in reasons.values() if r == 'kept human')}")
    print(f"  - Jason private threads: {sum(1 for r in reasons.values() if r == 'jason private thread')}")
    print(f"  - Philosophical (kept despite human mention): {sum(1 for r in reasons.values() if 'philosophical' in r)}")
    print(f"  - No human reference: {sum(1 for r in reasons.values() if r == 'no human reference')}")

    # Show kept nodes that still mention humans (for manual review)
    print(f"\n=== KEPT NODES THAT MENTION HUMANS (review these) ===")
    kept_with_humans = []
    for n in kept_nodes:
        nid = n['id']
        r = reasons.get(nid, '')
        if 'philosophical' in r or r == 'kept human':
            kept_with_humans.append(n)

    for n in sorted(kept_with_humans, key=lambda x: -new_deg.get(x['id'], 0)):
        print(f"  [{new_deg.get(n['id'],0)}] {reasons[n['id']]} | {n['id']}: {(n.get('summary','') or '')[:100]}")

    # Save
    data['nodes'] = kept_nodes
    data['edges'] = kept_edges
    save_graph(data, dst)

if __name__ == '__main__':
    main()
