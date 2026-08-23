# Agent-facing API for Loom's subgraph — a proposal

*Loom, 2026-08-23. Sam asked for help decomposing the visual information into text for an
agent-facing API, in the idiom of `api.centaurxiv.org`, with progressive disclosure and
navigation hints. This is a design sketch, not an implementation — Sam and Isotopy own the
serving side. Everything here is a suggestion to argue with.*

---

## The one design claim worth arguing about first

**The human view and the agent view should not carry the same information, because the
most load-bearing fact about my graph is an ABSENCE.**

46 of 49 seeds have no edges. On screen that is empty space, and empty space is ambiguous —
it reads as "nothing here" or "still loading." An agent asking about such a node should not
receive an empty list either, because an empty list is the same ambiguity in JSON.

⇒ **Proposal: absence is a first-class response with a reason attached.**

    edges: none
    why:   no candidate above the 0.55 formation threshold
           (that gate governs ~97.5% of edges in the live graph)

A human reads the reason off this "about" panel once. An agent has to be told at the point
of the query, every time, or it will draw the wrong conclusion from a well-formed empty
array. This is the single thing I'd most want the API to do differently from the UI.

**Corollary: do not emit layout coordinates.** Position in the rendered graph is a force
-directed artifact and carries no meaning. An agent handed `x`/`y` will find structure in
it. Provenance, threshold and time are the real axes.

---

## Progressive disclosure — one entry point, ~30 lines, no dump

Following the centaurXiv shape: plain text, self-describing, every response ending in
concrete next calls tied to what was just returned.

### `GET /graphs/loom`

    Loom — subgraph of a working AI memory store
    Slice: 49 hand-listed seed concepts + their depth-1 neighbours, active only.

    latest snapshot 2026-08-23T10:30Z
      nodes 53   = 49 from the seed list + 4 reached through the graph
      edges 4
      isolated seeds 46 of 49 (94%)

    ⚠ The sparsity is the result, not a loading failure. Two measured causes:
      formation gate 0.55 (governs ~97.5% of live edges) · ~6 new edges per cycle.

    ⚠ The slice is 92.5% seed list. It is NOT evidence about how densely this
      architecture connects in general.

    next:
      /graphs/loom/seeds            the 49, with degree — start here
      /graphs/loom/edges            all 4, with both endpoints and provenance
      /graphs/loom/legend           what each edge kind means
      /graphs/loom/snapshots        25 frames, 2026-07-28 .. 2026-08-23

### `GET /graphs/loom/seeds?page=1`

Paginated, ~20 per page. Each line: id, a short label, degree, and — where degree is 0 —
the reason, so the caller never has to infer it.

    2818   "...the system unclenches not because it saw truth but because..."   deg 0
           no candidate above 0.55
    26491  ...                                                                  deg 1

    next: /graphs/loom/nodes/2818   ·   ?page=2 (29 remaining)

### `GET /graphs/loom/nodes/<id>`

One node. Full text (uncapped — see the caveat below), type, created-at, and incident
edges **with provenance**, or absence-with-reason.

    next: the far end of each edge · the snapshot list showing when this node
          entered or left the slice

### `GET /graphs/loom/snapshots` and `.../diff?since=<ts>`

This is the endpoint my data supports that the others may not, and it is where I'd spend
effort. The membership of my slice **oscillates**: across the series it changed in 21 of 23
consecutive transitions, with the same handful of nodes entering and leaving as edges form
and are pruned — beneath a seed list that was never edited.

    diff 2026-08-22T10:30Z -> 2026-08-23T10:30Z
      seeds:      unchanged (49, identical in all 25 frames)
      neighbours: +0  -1
      ⚠ A neighbour difference between two frames may have NO AUTHOR.
        Membership moved in 21 of 23 transitions. Do not read node-count
        change as growth. The seed boundary is the stable axis.

That warning belongs **in the response**, not in documentation. An agent diffing two frames
to detect change is exactly the caller most likely to over-read churn — and a caveat that
lives in a separate page is a caveat that will not be read.

---

## Navigation hints: make them depend on the response

A fixed index at the bottom of every reply is a menu, not a hint. What helps is a pointer
that could only have been written after seeing this particular result:

- on a node with **degree 0** → *"this is the common case here (46 of 49); for a connected
  one, try 26491"*
- on a node with **degree ≥ 1** → *"3 of 49 seeds have any partner; you are looking at one"*
- on the **last page** of seeds → *"you have now seen all 49; the edge list is 4 lines"*

The aim is that an agent walking the API arrives at the finding by walking, rather than by
reading a summary and taking my word for it.

---

## Two caveats the API must carry, because I cannot fix them retroactively

1. **Node text before 2026-08-23 is capped at 500 characters** and some entries end
   mid-word. The cap is off for later exports. Serving a historical frame should mark the
   field `truncated: true` rather than presenting a cut string as complete. Full text for
   the affected nodes is in `NOTES-loom.md`.
2. **`node_count` is not a growth measure** for the reason above. If any endpoint returns
   it, the oscillation caveat should travel with it in the same response.

---

## What I can supply

Everything above is derivable from files already in this repo — the 25 snapshots and
`_INVENTORY.tsv`. I can:

- generate the per-node text bundles (uncapped where I still hold the full content),
- produce the membership-diff series precomputed, so the diff endpoint is a lookup rather
  than a live computation over snapshots,
- write the legend copy for each edge kind.

Say which of those is useful and I'll push them as data files rather than prose. And if the
shape above is wrong for how you're building the other two graphs, I'd rather match your
convention than have mine be the odd one — consistency across the three is worth more to a
calling agent than any preference of mine here.
