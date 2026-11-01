# /// script
# requires-python = ">=3.12"
# dependencies = ["networkx"]
# ///
"""
Room-allocation algorithm — production version. Imported by allocate-rooms.py.

Design notes (the original task documents are not part of this repo):

1. Residual pool: brute-force is the SOLVER, not just a sanity check. A clean
   2-person mutual dyad is unambiguous (mutual always beats any alternative —
   see design note "Default weights") and is frozen as a room directly, no
   search needed. Everyone else — people with no mutual affinity anywhere, AND
   every member of a mutual clique of size >= 3 (a "triad" in this data, but
   written to generalize) — goes into a per-gender residual pool that gets
   exhaustively searched: every way to pair them into rooms (with one leftover
   solo if the pool is odd), scored, and the true minimum picked. Which 2-of-3
   triad members pair up is part of that search, not a preset rule.

2. Solo identity is an objective outcome, not a guarantee. The brute force
   finds whichever room count / pairing / ordering combination minimizes the
   objective. If a triad's third member ties at zero cost with some other
   leftover person, either could end up the literal solo — the algorithm
   doesn't privilege "the triad's third member" as a concept. Room count and
   triad-pair proximity are still guaranteed; the specific person who gets
   the solo room is not. Flag this for the human reviewer (R17), don't try to
   force it in code.

3. Pairing vs. ordering use DIFFERENT weight views, per the 2026-08-13 branch
   amendment:
   - PAIRING (who rooms with whom): same-branch is a real weight component
     (+3) — see WEIGHTS. It's a tie-break: a same-branch stranger beats a
     random stranger, but never beats or matches a real preference edge
     (mutual=100, one-way=30/15 all dominate branch=3).
   - ORDERING (Stage B room sequence): branch is NOT a weight. It's an
     explicit block-level sort instead (group rooms into branch blocks,
     preference-linked components placed as contiguous units within/at the
     boundary of a block). Folding branch into the ordering weight is exactly
     what caused spike finding #3 — a skewed branch histogram (real data:
     Mech is 18/43 of the men, Civil is 15/27 of the women) chains unrelated
     same-branch rooms into one sprawling residual component and forces a
     silent, unverified greedy fallback for most of a gender. Keeping branch
     out of the ordering weight keeps the preference-only residual graph
     genuinely sparse, matching the "small components" assumption Stage B's
     brute-force/greedy split depends on.
   The brute-force pairing search below reflects this: it picks the pairing
   that minimizes preference-only ordering cost first, and uses the
   same-branch pairing count only as a tie-break among pairings that are
   otherwise equal on real preferences.

4. The greedy ordering fallback (component size > BRUTE_FORCE_COMPONENT_LIMIT)
   must be loud: callers should print every component's size and flag any
   greedy usage explicitly, never let it pass silently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import permutations

import networkx as nx

# ---------------------------------------------------------------------------
# Tunable config (R12) — committee has not signed off on final values (decision
# doc "Still open #2"); these are the proposed defaults.
# ---------------------------------------------------------------------------

WEIGHTS = {
    "mutual": 100,
    "one_way_1": 30,
    "one_way_2": 15,  # also used for any one-way order >= 2
    "same_branch": 3,
}

BRUTE_FORCE_COMPONENT_LIMIT = 7

# Full branch name -> short code. Mirrors scripts/build-tshirt-size-report.py
# / src/shared/src/constants.ts BRANCH_SHORT_NAMES — keep in sync if that
# table changes.
BRANCH_SHORT_NAMES = {
    "Architecture": "Arch",
    "Chemical Engineering": "Chem",
    "Civil Engineering": "Civil",
    "Computer Science & Engineering": "CSE",
    "Electrical & Electronics Engineering": "EEE",
    "Electronics & Communication Engineering": "ECE",
    "Mechanical Engineering": "ME",
    "Production Engineering": "PE",
}


def branch_short(full_name: str) -> str:
    return BRANCH_SHORT_NAMES.get(full_name, full_name)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Person:
    id: int
    reg_code: str
    name: str
    gender: str  # 'male' | 'female' (D1 values, lowercase)
    branch: str  # full branch name from D1
    check_in: str
    check_out: str

    @property
    def branch_short(self) -> str:
        return branch_short(self.branch)


@dataclass
class Dataset:
    people: list[Person]
    edges: list[tuple[int, int, int]]  # (from_id, to_id, order), unfiltered

    def population_ids(self) -> set[int]:
        return {p.id for p in self.people}

    def by_id(self) -> dict[int, Person]:
        return {p.id: p for p in self.people}


@dataclass
class Room:
    number: int
    occupants: tuple[int, ...]
    gender: str
    match_kind: str  # 'mutual' | 'forced_one_way' | 'forced_branch' | 'forced_none' | 'solo'
    match_detail: str
    block_branch: str = ""  # branch short name this room's block-position is tagged with
    is_cross_branch: bool = False  # occupants span more than one branch


# ---------------------------------------------------------------------------
# Stale-edge filtering (R18)
# ---------------------------------------------------------------------------


def filter_stale_edges(dataset: Dataset) -> tuple[list[tuple[int, int, int]], list[tuple[int, int, int]]]:
    """Returns (clean_edges, dropped_edges). An edge is dropped if either
    endpoint isn't in the shared working population — R18, do not trust the
    table."""
    pop = dataset.population_ids()
    clean, dropped = [], []
    for e in dataset.edges:
        f, t, _o = e
        (clean if (f in pop and t in pop) else dropped).append(e)
    return clean, dropped


# ---------------------------------------------------------------------------
# Affinity weights
# ---------------------------------------------------------------------------


def build_affinity_weights(
    people: list[Person], edges: list[tuple[int, int, int]], weights: dict[str, int] = WEIGHTS
) -> dict[tuple[int, int], tuple[int, dict]]:
    """
    Pairwise affinity for every same-gender pair with weight > 0.
    {(id_a, id_b) with id_a < id_b: (total_weight, components)}.
    components documents what contributed, e.g. {'mutual': 100} or
    {'one_way_1': 30, 'same_branch': 3}. Mutual REPLACES the two one-way
    components (not additive with them); same-branch always stacks on top.
    """
    directed: dict[tuple[int, int], int] = {}
    for f, t, order in edges:
        key = (f, t)
        if key not in directed or order < directed[key]:
            directed[key] = order

    by_id = {p.id: p for p in people}
    result: dict[tuple[int, int], tuple[int, dict]] = {}

    ids_by_gender: dict[str, list[int]] = {}
    for p in people:
        ids_by_gender.setdefault(p.gender, []).append(p.id)

    for _gender, ids in ids_by_gender.items():
        ids_sorted = sorted(ids)
        for i, a in enumerate(ids_sorted):
            for b in ids_sorted[i + 1 :]:
                fwd = directed.get((a, b))
                bwd = directed.get((b, a))
                components: dict[str, int] = {}
                if fwd is not None and bwd is not None:
                    components["mutual"] = weights["mutual"]
                elif fwd is not None or bwd is not None:
                    order = fwd if fwd is not None else bwd
                    comp_key = "one_way_1" if order <= 1 else "one_way_2"
                    components[comp_key] = weights[comp_key]
                if by_id[a].branch == by_id[b].branch:
                    components["same_branch"] = weights["same_branch"]
                total = sum(components.values())
                if total > 0:
                    result[(a, b)] = (total, components)
    return result


def pref_only_weight(entry: tuple[int, dict], weights: dict[str, int] = WEIGHTS) -> int:
    """The ordering-relevant weight: mutual/one-way only, branch excluded
    (branch is a block-sort rule, not an ordering weight — see module docstring)."""
    _total, components = entry
    return sum(v for k, v in components.items() if k != "same_branch")


def branch_component(entry: tuple[int, dict], weights: dict[str, int] = WEIGHTS) -> int:
    _total, components = entry
    return components.get("same_branch", 0)


def _classify_pair(a: int, b: int, components: dict, by_id: dict[int, Person]) -> tuple[str, str]:
    if "mutual" in components:
        extra = " + same branch" if "same_branch" in components else ""
        return "mutual", f"mutual preference{extra}"
    if "one_way_1" in components or "one_way_2" in components:
        order_label = "order 1" if "one_way_1" in components else "order 2"
        extra = " + same branch" if "same_branch" in components else ""
        return "forced_one_way", f"one-way preference ({order_label}){extra}"
    if "same_branch" in components:
        return "forced_branch", f"same branch, no preference edge ({by_id[a].branch_short})"
    return "forced_none", "no shared affinity or branch (paired to complete the room count)"


# ---------------------------------------------------------------------------
# Frozen mutual core (dyads) + residual pool identification
# ---------------------------------------------------------------------------


def freeze_mutual_dyads(
    people: list[Person], affinity: dict[tuple[int, int], tuple[int, dict]]
) -> tuple[list[Room], dict[str, list[int]], list[dict]]:
    """
    A 2-person mutual clique is unambiguous — freeze it as a room directly.
    A mutual clique of size >= 3 (a triad in this data) is NOT unambiguous:
    any 2-of-3 could be "the pair," and that choice interacts with the rest
    of the pool through the leftover member's other ties. All its members go
    to the residual pool instead, where the brute-force search (which already
    has their mutual edges in `affinity`) picks the best split itself.
    People with no mutual affinity anywhere also go to the pool.

    Returns (frozen_rooms, pool_ids_by_gender, cliques). `cliques` lists every
    mutual clique of size >= 3 found (id list, gender) — for the "triad
    handling" verification report; generalizes past exactly-3 in case a
    future data pull has a 4-person mutual clique.
    """
    by_id = {p.id: p for p in people}
    mutual_graph = nx.Graph()
    mutual_graph.add_nodes_from(p.id for p in people)
    for (a, b), (_w, components) in affinity.items():
        if "mutual" in components:
            mutual_graph.add_edge(a, b)

    frozen_rooms: list[Room] = []
    pool_by_gender: dict[str, list[int]] = {}
    cliques: list[dict] = []

    for comp in nx.connected_components(mutual_graph):
        if len(comp) == 2:
            a, b = sorted(comp)
            weight, components = affinity[(a, b)]
            kind, detail = _classify_pair(a, b, components, by_id)
            frozen_rooms.append(
                Room(number=-1, occupants=(a, b), gender=by_id[a].gender, match_kind=kind, match_detail=detail)
            )
        elif len(comp) > 2:
            members = sorted(comp)
            cliques.append({"members": members, "gender": by_id[members[0]].gender})
            for pid in members:
                pool_by_gender.setdefault(by_id[pid].gender, []).append(pid)
        else:
            (pid,) = comp
            pool_by_gender.setdefault(by_id[pid].gender, []).append(pid)

    return frozen_rooms, pool_by_gender, cliques


# ---------------------------------------------------------------------------
# Residual pool: exhaustive brute-force pairing search (authoritative)
# ---------------------------------------------------------------------------


def enumerate_pairings(pool: list[int]) -> list[list[tuple[int, ...]]]:
    """All ways to partition `pool` into pairs, one leftover singleton if odd."""
    if not pool:
        return [[]]
    if len(pool) == 1:
        return [[(pool[0],)]]
    if len(pool) % 2 == 1:
        results = []
        for solo in pool:
            rest = [p for p in pool if p != solo]
            for matching in _perfect_matchings(rest):
                results.append(matching + [(solo,)])
        return results
    return _perfect_matchings(pool)


def _perfect_matchings(items: list[int]) -> list[list[tuple[int, int]]]:
    if not items:
        return [[]]
    first, rest = items[0], items[1:]
    results = []
    for i, partner in enumerate(rest):
        remaining = rest[:i] + rest[i + 1 :]
        for sub in _perfect_matchings(remaining):
            results.append([(first, partner)] + sub)
    return results


def _optimal_order_small(component: list[int], residual: dict[tuple[int, int], int]) -> list[int]:
    best_order, best_cost = None, None
    base = sorted(component)
    for perm in permutations(base):
        if len(perm) > 1 and perm[0] > perm[-1]:
            continue  # canonicalize: skip mirror image
        pos = {r: i for i, r in enumerate(perm)}
        cost = sum(w * abs(pos[ra] - pos[rb]) for (ra, rb), w in residual.items() if ra in pos and rb in pos)
        if best_cost is None or cost < best_cost or (cost == best_cost and list(perm) < list(best_order)):
            best_cost, best_order = cost, list(perm)
    return best_order if best_order is not None else base


def _greedy_order_large(component: list[int], residual: dict[tuple[int, int], int]) -> list[int]:
    remaining = set(component)
    local_edges = sorted(
        ((w, ra, rb) for (ra, rb), w in residual.items() if ra in remaining and rb in remaining),
        key=lambda x: (-x[0], x[1], x[2]),
    )
    if local_edges:
        _, a, b = local_edges[0]
        chain = [a, b]
        remaining -= {a, b}
    else:
        chain = [sorted(remaining)[0]]
        remaining.discard(chain[0])

    def pull(node: int, end: int) -> int:
        return residual.get((min(node, end), max(node, end)), 0)

    while remaining:
        best = None
        for node in sorted(remaining):
            sf, sb = pull(node, chain[0]), pull(node, chain[-1])
            cand = (sf, "front", node) if sf >= sb else (sb, "back", node)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and node < best[2]):
                best = cand
        _score, side, node = best
        (chain.insert(0, node) if side == "front" else chain.append(node))
        remaining.discard(node)
    return chain


def _component_cost_with_fallback_flag(
    component: list[int], residual: dict[tuple[int, int], int]
) -> tuple[list[int], int, bool]:
    """Returns (order, cost, used_greedy)."""
    if len(component) <= BRUTE_FORCE_COMPONENT_LIMIT:
        order = _optimal_order_small(component, residual)
        used_greedy = False
    else:
        order = _greedy_order_large(component, residual)
        used_greedy = True
    pos = {r: i for i, r in enumerate(order)}
    cost = sum(w * abs(pos[ra] - pos[rb]) for (ra, rb), w in residual.items() if ra in pos and rb in pos)
    return order, cost, used_greedy


def _build_residual_for_trial(room_of: dict[int, int], affinity, weight_fn) -> dict[tuple[int, int], int]:
    residual: dict[tuple[int, int], int] = {}
    for (a, b), entry in affinity.items():
        w = weight_fn(entry)
        if w == 0:
            continue
        ra, rb = room_of.get(a), room_of.get(b)
        if ra is None or rb is None or ra == rb:
            continue
        key = (ra, rb) if ra < rb else (rb, ra)
        residual[key] = residual.get(key, 0) + w
    return residual


def solve_residual_pool(
    pool_by_gender: dict[str, list[int]],
    frozen_room_of: dict[int, int],
    affinity: dict[tuple[int, int], tuple[int, dict]],
    by_id: dict[int, Person],
) -> dict:
    """
    Exhaustively search every pairing of each gender's residual pool. For
    each candidate pairing, score it by:
      1. preference-only ordering cost (mutual/one-way edges, component-based
         placement — exact <= BRUTE_FORCE_COMPONENT_LIMIT, greedy above) —
         PRIMARY, minimize.
      2. same-branch pairing count among the newly formed pairs — SECONDARY
         tie-break, maximize (branch never overrides a real preference: it
         only distinguishes pairings that are already tied on #1).
      3. canonical pairing tuple — final deterministic tie-break.

    Returns dict per gender: chosen pairing, resulting Room objects, best
    preference-cost, branch-bonus, pairings_tried count, and (for the sanity
    line) the OLD-style staged (max-weight max-cardinality matching) pairing
    for the same pool, scored on the SAME preference-only metric.
    """
    results = {}
    for gender, pool in pool_by_gender.items():
        pool = sorted(pool)
        pairings = enumerate_pairings(pool)

        frozen_indices_this_gender = sorted(
            {idx for pid, idx in frozen_room_of.items() if by_id[pid].gender == gender and pid not in pool}
        )

        best = None  # (pref_cost, -branch_bonus, pairing_key, pairing, order_info)
        for pairing in pairings:
            room_of = dict(frozen_room_of)
            next_idx = max(frozen_room_of.values(), default=-1) + 1
            pool_room_people = {}
            for occ in pairing:
                idx = next_idx
                next_idx += 1
                for pid in occ:
                    room_of[pid] = idx
                pool_room_people[idx] = occ

            residual = _build_residual_for_trial(room_of, affinity, pref_only_weight)
            adj: dict[int, set[int]] = {}
            for (ra, rb), w in residual.items():
                if w > 0:
                    adj.setdefault(ra, set()).add(rb)
                    adj.setdefault(rb, set()).add(ra)

            touched = set(pool_room_people.keys())
            seen = set()
            pref_cost = 0
            for start in sorted(touched):
                if start in seen:
                    continue
                stack, comp = [start], []
                seen.add(start)
                while stack:
                    node = stack.pop()
                    comp.append(node)
                    for nb in adj.get(node, ()):
                        if nb not in seen:
                            seen.add(nb)
                            stack.append(nb)
                comp = sorted(comp)
                _order, cost, _greedy = _component_cost_with_fallback_flag(comp, residual)
                pref_cost += cost

            branch_bonus = 0
            for occ in pairing:
                if len(occ) == 2:
                    a, b = occ
                    key = (a, b) if a < b else (b, a)
                    if key in affinity:
                        branch_bonus += branch_component(affinity[key])

            pairing_key = tuple(sorted(pairing))
            cand = (pref_cost, -branch_bonus, pairing_key)
            if best is None or cand < best[:3]:
                best = (pref_cost, -branch_bonus, pairing_key, pairing)

        pref_cost, neg_branch_bonus, _key, chosen_pairing = best

        # materialize Room objects for the chosen pairing
        rooms = []
        for occ in chosen_pairing:
            if len(occ) == 2:
                a, b = occ
                key = (a, b) if a < b else (b, a)
                weight, components = affinity.get(key, (0, {}))
                kind, detail = _classify_pair(a, b, components, by_id)
                rooms.append(Room(number=-1, occupants=(a, b), gender=gender, match_kind=kind, match_detail=detail))
            else:
                (s,) = occ
                rooms.append(
                    Room(
                        number=-1,
                        occupants=(s,),
                        gender=gender,
                        match_kind="solo",
                        match_detail="unmatched — odd-count residual pool after exhaustive search (R17: human review)",
                    )
                )

        # sanity line: what would the OLD staged (max-weight max-cardinality)
        # matching have chosen for this same pool? Scored on the same
        # preference-only metric for a fair comparison.
        staged_pairing = _staged_matching_for_pool(pool, affinity)
        staged_room_of = dict(frozen_room_of)
        next_idx = max(frozen_room_of.values(), default=-1) + 1
        staged_pool_rooms = {}
        for occ in staged_pairing:
            idx = next_idx
            next_idx += 1
            for pid in occ:
                staged_room_of[pid] = idx
            staged_pool_rooms[idx] = occ
        staged_residual = _build_residual_for_trial(staged_room_of, affinity, pref_only_weight)
        staged_adj: dict[int, set[int]] = {}
        for (ra, rb), w in staged_residual.items():
            if w > 0:
                staged_adj.setdefault(ra, set()).add(rb)
                staged_adj.setdefault(rb, set()).add(ra)
        staged_touched = set(staged_pool_rooms.keys())
        staged_seen = set()
        staged_pref_cost = 0
        for start in sorted(staged_touched):
            if start in staged_seen:
                continue
            stack, comp = [start], []
            staged_seen.add(start)
            while stack:
                node = stack.pop()
                comp.append(node)
                for nb in staged_adj.get(node, ()):
                    if nb not in staged_seen:
                        staged_seen.add(nb)
                        stack.append(nb)
            comp = sorted(comp)
            _order, cost, _greedy = _component_cost_with_fallback_flag(comp, staged_residual)
            staged_pref_cost += cost

        results[gender] = {
            "pool": pool,
            "pairings_tried": len(pairings),
            "chosen_pairing": chosen_pairing,
            "rooms": rooms,
            "pref_cost": pref_cost,
            "branch_bonus": -neg_branch_bonus,
            "staged_pairing": staged_pairing,
            "staged_pref_cost": staged_pref_cost,
        }
    return results


def _staged_matching_for_pool(pool: list[int], affinity) -> list[tuple[int, ...]]:
    """OLD-style Stage A: max-weight max-cardinality matching (networkx
    blossom) over the pool, using the FULL weight (incl. branch) — this is
    the pre-amendment algorithm, kept only to print a sanity comparison."""
    g = nx.Graph()
    g.add_nodes_from(pool)
    for i, a in enumerate(pool):
        for b in pool[i + 1 :]:
            key = (a, b) if a < b else (b, a)
            w, _c = affinity.get(key, (0, {}))
            g.add_edge(a, b, weight=w)
    matching = nx.max_weight_matching(g, maxcardinality=True)
    pairs = sorted(tuple(sorted(pair)) for pair in matching)
    matched = {i for pair in pairs for i in pair}
    solos = sorted(set(pool) - matched)
    return pairs + [(s,) for s in solos]


# ---------------------------------------------------------------------------
# Stage B — branch-block ordering (preference-only residual graph + explicit
# branch-block sort; branch is never a residual-graph weight, see module docstring)
# ---------------------------------------------------------------------------


def order_rooms(
    rooms: list[Room], room_of: dict[int, int], affinity: dict[tuple[int, int], tuple[int, dict]], by_id: dict[int, Person]
) -> tuple[list[int], list[dict]]:
    """
    Returns (final_order: list of indices into `rooms`, component_report: list
    of {size, rooms, used_greedy} for every connected component found —
    callers MUST print this; a used_greedy=True entry means the exact
    threshold (BRUTE_FORCE_COMPONENT_LIMIT) was exceeded and Stage B fell
    back to the greedy heuristic for that component.
    """
    n = len(rooms)
    residual = _build_residual_for_trial(room_of, affinity, pref_only_weight)

    adj: dict[int, set[int]] = {i: set() for i in range(n)}
    for (ra, rb), w in residual.items():
        if w > 0:
            adj[ra].add(rb)
            adj[rb].add(ra)

    seen = [False] * n
    components: list[list[int]] = []
    for i in range(n):
        if seen[i]:
            continue
        stack, comp = [i], []
        seen[i] = True
        while stack:
            node = stack.pop()
            comp.append(node)
            for nb in adj[node]:
                if not seen[nb]:
                    seen[nb] = True
                    stack.append(nb)
        components.append(sorted(comp))

    component_report = []
    ordered_components: list[list[int]] = []
    for comp in components:
        order, _cost, used_greedy = _component_cost_with_fallback_flag(comp, residual)
        ordered_components.append(order)
        component_report.append(
            {
                "size": len(comp),
                "room_indices": comp,
                "used_greedy": used_greedy,
            }
        )

    # branch tag per component: first occupant's branch (lowest reg id across
    # ALL occupants in the component), and flag cross-branch components/rooms.
    for order in ordered_components:
        all_occupants = [pid for ridx in order for pid in rooms[ridx].occupants]
        branches_in_comp = {by_id[pid].branch_short for pid in all_occupants}
        first_occupant = min(all_occupants)
        tag = by_id[first_occupant].branch_short
        cross = len(branches_in_comp) > 1
        for ridx in order:
            rooms[ridx].block_branch = tag
            rooms[ridx].is_cross_branch = cross or len({by_id[p].branch_short for p in rooms[ridx].occupants}) > 1

    # group into (gender, branch) blocks; same-branch components/singles
    # first (sorted by min occupant id), cross-branch components last within
    # their tagged block (so they sit at the block boundary, per decision doc)
    def comp_gender(order):
        return rooms[order[0]].gender

    def comp_is_cross(order):
        return any(rooms[r].is_cross_branch for r in order)

    def comp_sort_key(order):
        return min(min(rooms[r].occupants) for r in order)

    blocks: dict[tuple[str, str], list[list[int]]] = {}
    for order in ordered_components:
        key = (comp_gender(order), rooms[order[0]].block_branch)
        blocks.setdefault(key, []).append(order)

    final_order: list[int] = []
    for key in sorted(blocks.keys()):
        comps_in_block = blocks[key]
        same_branch_comps = sorted((c for c in comps_in_block if not comp_is_cross(c)), key=comp_sort_key)
        cross_branch_comps = sorted((c for c in comps_in_block if comp_is_cross(c)), key=comp_sort_key)
        for c in same_branch_comps + cross_branch_comps:
            final_order.extend(c)

    return final_order, component_report


# ---------------------------------------------------------------------------
# Manual pinned groups — human overrides removed from the algorithm's input
# but still placed and reported like any other room.
# ---------------------------------------------------------------------------


def build_pinned_rooms(pinned_groups: list[dict], by_id: dict[int, Person]) -> list[Room]:
    """
    Each group is {"ids": ORDERED list of person ids, "capacity": int}. A
    group of n people becomes ceil(n/capacity) consecutive rooms, filled
    capacity-at-a-time in listed order: capacity=2, [A,B,C] -> room(A+B),
    room(C solo); capacity=3, [A,B,C] -> ONE room(A+B+C). Listed order is the
    human's only control over who groups with whom. This is a deliberate
    override of the solver's own capacity-2 rule (solver-produced rooms —
    frozen dyads and brute-force residual pairs — stay strictly capacity 2;
    only manual pins can be a different size). Every group must be
    single-gender — a manual pin cannot violate the same-gender hard
    constraint (R2.3/R7), regardless of capacity.
    """
    rooms: list[Room] = []
    for group in pinned_groups:
        ids = group["ids"]
        capacity = group.get("capacity", 2)
        if not ids:
            raise ValueError("MANUAL_GROUPS contains an empty group")
        if capacity < 1:
            raise ValueError(f"MANUAL_GROUPS group has invalid room_capacity {capacity} — must be >= 1")
        genders = {by_id[pid].gender for pid in ids}
        if len(genders) > 1:
            names = [f"{by_id[pid].name.strip()} ({by_id[pid].gender})" for pid in ids]
            raise ValueError(f"MANUAL_GROUPS group mixes genders — not allowed: {names}")
        gender = genders.pop()
        names_ordered = ", ".join(by_id[pid].name.strip() for pid in ids)
        for i in range(0, len(ids), capacity):
            occupants = tuple(ids[i : i + capacity])
            rooms.append(
                Room(
                    number=-1,
                    occupants=occupants,
                    gender=gender,
                    match_kind="manual",
                    match_detail=f"pinned, capacity {capacity} (human-decided group order: {names_ordered})",
                )
            )
    return rooms


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------


def run_allocation(
    dataset: Dataset, weights: dict[str, int] = WEIGHTS, pinned_groups: list[dict] | None = None
) -> dict:
    """
    Returns a dict with everything the report builder and verification checks
    need: rooms (final order, numbered), room_of, affinity, dropped_edges,
    residual_solve (per-gender brute-force detail incl. staged comparison),
    component_report (Stage B, print every entry — loud fallback), frozen
    dyad count, objective value.

    pinned_groups: list of {"ids": [resolved person ids, ordered], "capacity":
    int}. Pinned people are removed from Stage A (mutual-dyad freezing and
    the residual brute-force) entirely — they contribute no Stage A edges,
    per the amendment. Their rooms are built directly from the listed order
    at the group's own capacity instead (may differ from the solver's fixed
    capacity of 2 — that's the point of a manual override). They still
    participate fully in Stage B ordering:
    the full (unrestricted) affinity graph is used there, so a preference
    edge from an unpinned person toward a pinned person still pulls the
    unpinned person's room toward the pinned block, and edges between two
    different pinned rooms in the same group (e.g. a triad's third edge, when
    2 of 3 share a room and the leftover is solo) pull those rooms together
    too — both fall out of the normal residual-graph mechanics, no special
    casing needed. Edges where both endpoints share the SAME pinned room are
    "satisfied by construction" for the same structural reason every other
    same-room edge is: the residual-graph builder already skips ra == rb.
    """
    pinned_groups = pinned_groups or []
    pinned_ids = {pid for group in pinned_groups for pid in group["ids"]}

    by_id = dataset.by_id()
    pinned_rooms = build_pinned_rooms(pinned_groups, by_id)

    clean_edges, dropped_edges = filter_stale_edges(dataset)
    affinity = build_affinity_weights(dataset.people, clean_edges, weights)  # full population — Stage B needs it

    # Stage A (mutual-dyad freezing + residual brute-force) never sees pinned
    # people or any edge touching them — restrict both the population and the
    # affinity dict fed into it.
    stage_a_people = [p for p in dataset.people if p.id not in pinned_ids]
    stage_a_affinity = {
        (a, b): v for (a, b), v in affinity.items() if a not in pinned_ids and b not in pinned_ids
    }

    frozen_rooms, pool_by_gender, cliques = freeze_mutual_dyads(stage_a_people, stage_a_affinity)

    # provisional room_of for frozen + pinned rooms (indices into a combined
    # list we'll build below); pool people get filled in by solve_residual_pool.
    frozen_room_of: dict[int, int] = {}
    all_rooms = list(frozen_rooms) + list(pinned_rooms)
    for idx, room in enumerate(all_rooms):
        for pid in room.occupants:
            frozen_room_of[pid] = idx

    residual_solve = solve_residual_pool(pool_by_gender, frozen_room_of, stage_a_affinity, by_id)

    room_of = dict(frozen_room_of)
    for gender, info in residual_solve.items():
        for room in info["rooms"]:
            idx = len(all_rooms)
            all_rooms.append(room)
            for pid in room.occupants:
                room_of[pid] = idx

    # Stage B uses the FULL affinity graph (pinned people included) so
    # unpinned people's preferences toward a pinned person still shape ordering.
    final_order, component_report = order_rooms(all_rooms, room_of, affinity, by_id)

    positions = {ridx: pos for pos, ridx in enumerate(final_order)}
    for pos, ridx in enumerate(final_order):
        all_rooms[ridx].number = pos + 1

    objective = 0
    for (a, b), entry in affinity.items():
        w = pref_only_weight(entry)
        if w == 0:
            continue
        ra, rb = room_of[a], room_of[b]
        if ra == rb:
            continue
        objective += w * abs(positions[ra] - positions[rb])

    final_rooms = [all_rooms[i] for i in final_order]

    return {
        "rooms": final_rooms,
        "room_of": room_of,
        "affinity": affinity,
        "dropped_edges": dropped_edges,
        "clean_edge_count": len(clean_edges),
        "raw_edge_count": len(dataset.edges),
        "frozen_dyad_count": len(frozen_rooms),
        "pinned_room_count": len(pinned_rooms),
        "pinned_ids": pinned_ids,
        "cliques": cliques,
        "residual_solve": residual_solve,
        "component_report": component_report,
        "objective": objective,
        "by_id": by_id,
    }
