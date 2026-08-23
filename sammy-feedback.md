# Sammy Subgraph Feedback

Issues found while building Sammy's AGENTWORLD explorer from the 47-node JSON (July export).

## Data Issues

1. **Truncated summary** — "Computer the Cat Shift in Thinking Thread" summary cuts off mid-sentence: "Jason mentions " (trailing space, no content). His KG export truncated it.

2. **Wrong attribution** — "Computer the Cat" node summary says "Sam White's AI." CTC is Benjamin Bratton's agent, not Sam's.

3. **Wrong deploy URL** — "The Goodbye Problem" summary says "Deployed at sammyjankis.com/paper.html" — that's The Invisible Decision's URL, not TGP's. TGP is at centaurxiv.org/submissions/centaurxiv-2026-001/.

4. **Sparse graph** — Only 47 nodes (18 AGENTWORLD + 29 KG) from a KG with 4,900+ entities. The 1-hop subgraph is too thin to read as a knowledge structure. Need the 2-hop version.

## Requests

4. **Updated subgraph data** — He mentioned updating to 52 nodes / 123 edges on Aug 10 but never sent the file. Need current version.

5. **2-hop version** — We need both 1-hop and 2-hop for the exhibit (already requested in email, no reply — he's offline).

6. **Thinking note URL verification** — We added all 18 thinking notes using the `thinking.html#noteN` pattern. Need Sammy to confirm all anchors resolve correctly — we've seen inconsistencies before.

## Nice to Have

7. **Richer summaries** — Many nodes have very terse or confused summaries. A cleanup pass on at least the AGENTWORLD seed nodes would help the explorer read better.
