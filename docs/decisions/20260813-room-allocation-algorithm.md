# Room allocation algorithm — two-phase (matching + arrangement)

Date: 2026-08-13
Source: brainstorming + decision-trees spike (tasks/2026-08-13-room-allocation.problem-statement.md, .requirements.md)
Status: DECIDED (spike proven; production script not yet built)

## Context

We must allocate 70 shared registrations (43 men, 27 women) to double rooms and emit a
hotel handoff report where fictional sequential room numbers (Room-1, Room-2, …) encode
proximity. The objective (grill-me 2026-08-13): minimize Σ over all pairs of
(affinity weight × spatial distance), where distance is 0 for same room, 1 for next door,
etc. Affinity weights and the distance function are inputs, not baked in — the algorithm
must be generic.

The problem is a Quadratic Assignment Problem, but with structure that makes it decompose:
no cross-gender edges (R2.3), so men and women are two independent problems; and the
"same room = 0" term is so dominant that the pairing decision (who shares) is separable
from the ordering decision (which room is next to which).

## Considered

| Path | What it is | Verdict |
|---|---|---|
| A. Monolithic QAP (one objective over people × rooms × positions) | Exact ILP (OR-Tools / python-mip) or simulated annealing over the whole assignment | **Rejected.** Optimality is worth nothing on 36 rooms; adds a heavy dependency; "clever", not inevitable. |
| B. Two-phase: max-weight matching (pairing) + min-linear-arrangement (ordering) | Phase 1 pairs people into rooms; phase 2 orders the rooms along a line | **Chosen.** Matches the problem's natural decomposition; each phase is a well-understood problem; deterministic. |
| C. Greedy mutual-lock, then match the rest | Pre-lock all mutual pairs, run matching on the remainder | **Rejected.** Greedy locking breaks the cardinality guarantee — spike produced 3 solo rooms among men instead of the forced 1. |

## Decided

1. **Two-phase algorithm.**
   - **Phase 1 (pairing):** maximum-weight matching per gender via `networkx` blossom
     (`max_weight_matching`), over the **complete** same-gender graph. Exactly one solo
     per odd gender. The solo is whoever the matching leaves out — automatically the
     least-connected person, which is what we want.
   - **Phase 2 (ordering):** room-level minimum linear arrangement. Spectral (Fiedler
     vector) ordering for a start, then adjacent-swap local search to polish.
2. **Complete-graph requirement.** The matching graph must include every same-gender pair
   (strangers at weight 0). Filtering out zero-weight edges makes `maxcardinality` unable
   to reach full cardinality, which forces a degree-1 node (Esha Test, the lone Chemical) to
   grab a mutual pair's partner and break it. This was the one real bug the spike caught.
3. **Mutual pairs are protected by weight, not by pre-locking.** Use a dominant
   `W_MUTUAL` (≥ ~2× one-way weight, so a split can never net positive) rather than
   hard-locking. The only mutual breaks that survive are the two capacity-forced triad
   splits (3 people, 2 beds) — exactly the intended outcome.
4. **Determinism.** Both phases are deterministic (blossom, eigh, deterministic swap
   descent). Same input → same report every run. No simulated annealing, no seeds.
5. **Generic API shape.** The solver takes: people, an affinity function/weights, room
   capacity, a distance function (default: |pos_a − pos_b|). Gender is just one partition
   key. Nothing knows about "branch" or "gender" by name.

## Why

Two-phase is the "inevitable" design: the objective splits cleanly because the same-room
term dominates. Exact matching (blossom) is polynomial and already available; the
arrangement step is the only genuinely hard part and it operates on ~36 nodes, where
spectral + local search is more than good enough. Zero new dependencies beyond numpy +
networkx (both already in the environment), runnable via `uv run --script` with inline
deps — matching the repo's existing `scripts/*.py` report convention.

## Spike results (prod D1, 2026-08-13)

- 70 people → 22 men's rooms + 14 women's rooms = 36 rooms, exactly 1 solo per gender.
- **Mutual preferences: 30/34 pairs honored in-room.** The 4 un-honored are the two
  triads (each is 3 mutual pairs; capacity 2 forces one break per triad).
- Solos: Esha Test (lone Chemical, least-connected man) and Wren Triad
  (triad leftover, placed adjacent to her pair room).
- One-way preferences: 2 honored in-room (Ann→Bob, Zane Pair→Yash Pair); the rest
  honored by adjacency in phase 2.
- Arrangement: local search cut the men's ordering cost 1077 → 718 (spectral start).

## Limitations

- Phase 2 is a heuristic — minimum linear arrangement is NP-hard. The ordering is
  near-optimal, not provably optimal. Fine for 36 rooms.
- 2-night continuity (the 8 two-night guests keep one room both nights) is **not yet
  handled** — the spike does night 15 only. It's a soft constraint; to enforce it, fix
  the two-night guests' rooms first and match the rest.
- Solo choice is automatic (least-connected). If the committee wants a specific person to
  get the solo room (e.g., someone who'd rather pay for private), that's a post-step
  override, not part of the solver.
- Affinity weight values are placeholders (mutual 10, one-way 5/3, branch 1). They need
  committee sign-off — but the *structure* is insensitive to the exact numbers.

## Fine because

The data is tiny (70 people, 34 mutual pairs) and almost self-resolving: 62 of 70 people
are in an unambiguous mutual pair/triad. The hard part is only ~10 people, where any
reasonable heuristic and an exact solver will agree. Optimality is not the bottleneck;
explainability and determinism are.

## Reversal

Reconsider if: (a) the problem grows large enough that spectral/local-search ordering is
visibly worse than optimal and it matters, or (b) the committee's preferences can't be
expressed as pairwise affinity weights (e.g., "never room these two" needs a hard
forbidden-pair list). Both are addressable — (a) by dropping in an ILP solver for the
arrangement step, (b) by adding a forbidden-pair constraint to the matching — without
changing the two-phase shape.

## Next

- Promote the spike to `scripts/build-room-allocation-report.py` (D1 query helper +
  solver + report emitter), reusing the `cf-token`/D1 pattern from
  `build-shared-triple-reallocation-reports.py`.
- Handle 2-night continuity and night-14 in the report.
- Get affinity-weight values from the committee.
