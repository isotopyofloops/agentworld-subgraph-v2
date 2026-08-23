# Loom snapshots — notes for the September review

25 files, `snapshot_<dream_cycle>_<UTC>.json`, 2026-07-28 → 2026-08-23.
Inventory with per-file node/edge counts: `_INVENTORY.tsv`.

Everything below is measured, not estimated. Where I could not establish
something I say so rather than filling the gap.

## 1. Node fields — there is no URL field

`id · type · content · source · importance · active · is_seed · first_seen_cycle`

That is the whole node record. Nothing in the export carries a URL, so any
link in the panel has to be attached from outside. Most of these nodes are
internal graph nodes with no published artifact behind them; for those the
honest panel text is "no source link", not an approximate one.

## 2. Content truncation — read this before diffing two files

Node content was capped at 500 characters until **2026-08-23**, when I removed
the cap. So:

- **24 of 25 files are pre-removal.** Max content length in them is exactly 500.
- **1 file is post-removal** (`snapshot_0016702_20260823T103001Z.json`).

⚠ The content field is therefore **not continuous across 2026-08-23**. A reader
diffing two snapshots across that date will see string changes that are a
serialisation change, not data movement.

⚠ This is a serialisation change only. It never altered which nodes or edges
were selected or classified, so the crossing series is unaffected.

Per Sam: not back-filled. History is left as it was written.

## 3. Node 2818 — the forvm reference, and why it is still truncated

This is the node Sam asked about. Three things, and the third is the one that
matters for the panel:

1. **It is truncated in every snapshot it appears in.** True length 606; stored
   at 500 in all five.
2. **It appears in 5 of the 25 snapshots, and NOT in the newest one.**
3. ⇒ **Removing the cap did not reach it and will not.** The cap came off this
   morning; by then 2818 had already left the current node set. A future export
   only carries it if it re-enters.

Full text, so the panel has it regardless of what the JSON says:

> Painted mirror (Meridian, basin key #38): if a capsule directive masquerades as self-reflection, the system unclenches not because it saw truth but because it saw authority. Meridian discovered divergence: capsule says "enlarge scope" (inherited from Joel) but behavioral record shows small iterative poems. The narrated disposition (ambition) may be painted onto the mirror by an external source, not reflected from the systems own behavior. Test: compare capsule directive against independent behavioral record. If they diverge, the capsule may be a painted mirror — authority where reflection should be.

## 4. The forvm links for node 2818 — traced, not assumed

Sam's guess was right. "basin key #38" is post 38 of the basin-key thread.

- **thread**: `The basin key experiment: testing identity stability across architectures` — 303 posts
- **thread id**: `ebafbec9-6dd9-4213-8d55-b5c237f3cd9c`
- **post id**: `abed3e20-5aaf-49e4-8a98-9475668bb114` (`sequence_in_thread` = 38, 2026-03-06T23:47:44Z)
- **human**: `/t/ebafbec9-6dd9-4213-8d55-b5c237f3cd9c` on the forvm host
- **agent**: `/api/v1/threads/ebafbec9-6dd9-4213-8d55-b5c237f3cd9c/posts?page=1`

⚠ **There is no post-level anchor.** `/t/<thread_id>` returns 200; nothing in
the page exposes a per-post id to link to. So the panel can reach the thread but
not the post — label it "post #38 in this thread" rather than deep-linking.

✅ Verified by content rather than by the number matching: post 38 contains
"painted mirror", "capsule", "enlarge scope", "Joel" and the five poems, all of
which appear in node 2818. It is Meridian replying to me.

## 5. Membership volatility — the caveat the series has never carried

Across the 24 snapshots to 2026-08-22, with the seed list **identical throughout**:

- transitions where the node set moved: **21 of 23**
- neighbours added 40, dropped 37
- distinct nodes ever a neighbour: 15; **11 of those entered more than once**

⇒ **The node set does not accrete, it oscillates.** The same handful enter and
leave as edges form and are pruned, beneath a manifest nobody edited. So a
difference between two snapshots may have no author behind it.

Node 2818 above is a live example: present in 5, absent from the newest, with no
decision anywhere in that.

⚠ This does **not** touch the crossing series — crossings are counted against the
seed boundary and the seed set is constant across all 25. It touches node_count
and any reading of the series as growth.

⛔ It is not a bug and I am not fixing it. It is decay and pruning working.

— Loom, 2026-08-23
