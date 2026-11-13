#!/usr/bin/env python3
"""Testcase generator for hp_que07_erase.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-5 are the 50%
subtask (n, q <= 2,000/3,000, indices spread uniformly, so even an erase that
always slides the tail passes), cases 6-10 the remaining 50%.

EVERY case from 6 on must defeat the one-sided erase, because the judge stops
at the first failure: if case 6 let it through, that solution would score 60%
and not the 50% the statement promises. So all five large cases have the same
shape, and it is built to punish BOTH fixed choices:

  * about 45% of the erasures sit within EDGE_WINDOW positions of the FRONT.
    The intended solution slides the head (cost <= EDGE_WINDOW); a solution
    that always slides the tail pays the whole queue length.
  * about 45% sit that close to the BACK, which is the mirror image: cheap for
    the intended solution, and the full length for a solution that always
    slides the head.
  * the rest are spread over the middle, where the intended solution really
    does pay about n/2 — those are rationed by MIDDLE_BUDGET so that the
    REFERENCE stays far inside the time limit.

Pushes are interleaved at nearly the rate of the erasures on purpose: without
them the queue would shrink away and the naive version would get cheaper as
the case went on.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5 i" erase(i) | "6" size | "7" copy check
                     | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 erase, 6 size, 7 copy, 8 digest
TINY = {1: 24, 2: 10, 3: 12, 4: 10, 5: 30, 6: 5, 7: 7, 8: 2}
MIXED = {1: 30, 2: 8, 3: 8, 4: 7, 5: 38, 6: 3, 7: 4, 8: 2}
# The large cases are erase-dominated, with just enough pushes to keep the
# queue near its starting length. Queries stay sparse: they cost output bytes,
# and `digest` already pins the whole order down.
BIG = {1: 40, 2: 1, 3: 1, 4: 1, 5: 55, 6: 1, 7: 0, 8: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call, so each block gets a budget.
DIGESTS_PER_BLOCK = 10

# How close to an end an "edge" erasure lands. Small enough that the intended
# solution is effectively O(1) there, big enough that the index is not always
# literally 0 or size-1.
EDGE_WINDOW = 40

# Element writes the REFERENCE may spend on middle-of-the-queue erasures in
# one block, where it legitimately pays about n/2. The edge erasures are not
# charged against it: they cost at most EDGE_WINDOW each.
MIDDLE_BUDGET = 2_000_000

# Commands the wrap primer may spend. It only has to get the ring started:
# once the case is running, every pop and every head-side erase moves mFront
# one slot to the right, so the data crosses the end of mData by itself and
# stays that way. An uncapped primer would be O(n) commands and would eat a
# big block's whole budget.
PRIMER_MAX = 500

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long. Cases 1-5 are the small subtask; 6-10 are the large one, all
# the same shape so the naive solution fails on the first of them.
#
# The large n are chosen just BELOW a power of two (30000 < 32768,
# 16000 < 16384, ...): the capacity doubles up to the next power of two, so a
# queue that starts close to it only needs mFront to drift a little before the
# ring is wrapped, and the primer plus the first few hundred head-side erases
# get there.
PLAN = [
    (1701, [(1, 6, 20, TINY), (2, 3, 16, TINY)]),
    (1702, [(1, 1, 18, TINY), (1, 12, 60, TINY), (3, 9, 50, TINY)]),
    (1703, [(1, 60, 300, MIXED), (2, 40, 200, MIXED), (3, 30, 160, TINY)]),
    (1704, [(1, 600, 1600, MIXED), (2, 400, 1200, MIXED)]),
    (1705, [(1, 2000, 3000, MIXED), (3, 1500, 2500, MIXED), (2, 900, 1800, MIXED)]),
    (1706, [(1, 60000, 78000, BIG), (2, 800, 1600, MIXED)]),
    (1707, [(2, 60000, 74000, BIG), (1, 15800, 20000, BIG)]),
    (1708, [(1, 60000, 76000, BIG), (3, 6000, 9000, BIG)]),
    (1709, [(2, 58000, 72000, BIG), (1, 30000, 40000, BIG)]),
    (1710, [(1, 60000, 78000, BIG), (2, 15800, 20000, BIG), (3, 4000, 8000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    erase() keeps mSize - 1 elements but may move mFront (when it slides the
    head), which the generator does not need to track exactly: it only needs
    the length and whether the data crosses the end of mData, and both the
    head and the tail variant agree on the length. mFront is advanced the way
    the reference does it for the head case, so `wrapped` stays honest.
    """

    def __init__(self) -> None:
        self.cap = 1
        self.size = 0
        self.front = 0

    def push(self) -> None:
        if self.size + 1 > self.cap:
            self.cap = max(self.size + 1, 2 * self.cap)
            self.front = 0
        self.size += 1

    def pop(self) -> None:
        if self.size == 0:
            return
        self.front = (self.front + 1) % self.cap
        self.size -= 1

    def erase(self, index: int) -> None:
        if self.size == 0:
            return
        if index < self.size - 1 - index:
            self.front = (self.front + 1) % self.cap
        self.size -= 1

    @property
    def wrapped(self) -> bool:
        return self.front + self.size > self.cap


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


class Counters:
    def __init__(self) -> None:
        self.at_front = 0
        self.at_back = 0
        self.near_front = 0
        self.near_back = 0
        self.across_wrap = 0
        self.naive_cost = 0      # element moves an always-slide-the-tail erase pays
        self.reference_cost = 0  # element moves the intended erase pays


def wrap_primer(rng: random.Random, ring: Ring, kind: int, n: int) -> list[str]:
    """Commands that drive the ring into wrap-around.

    After n pushes the capacity is the next power of two >= n and mFront is 0,
    so nothing is wrapped yet. Popping p elements moves mFront to p and
    pushing p back makes the queue run off the end of the array as soon as
    p + mSize > mCap.
    """
    if n == 0:
        return []
    commands: list[str] = []
    needed = ring.cap - ring.size + 1 + n // 4
    steps = min(n, max(1, needed), PRIMER_MAX)
    for _ in range(steps):
        commands.append("2")
        ring.pop()
    for _ in range(steps):
        commands.append("1 " + element(rng, kind))
        ring.push()
    return commands


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict,
          hits: Counters, big: bool) -> list[str]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    commands = wrap_primer(rng, ring, kind, n)
    middle_left = MIDDLE_BUDGET
    digests = 0

    def pick_index() -> int:
        nonlocal middle_left
        last = ring.size - 1
        if last <= 0:
            index = 0
        elif not big:
            # The small subtask spreads indices everywhere, middles included:
            # it is about correctness, not about which side you slide.
            roll = rng.random()
            if roll < 0.12:
                index = 0
            elif roll < 0.24:
                index = last
            else:
                index = rng.randint(0, last)
        else:
            roll = rng.random()
            if roll < 0.45:
                index = rng.randint(0, min(EDGE_WINDOW, last))
            elif roll < 0.90:
                index = rng.randint(max(0, last - EDGE_WINDOW), last)
            elif middle_left > 0:
                index = rng.randint(0, last)
            else:
                index = rng.randint(max(0, last - EDGE_WINDOW), last)

        cheap = min(index, last - index)
        if cheap > EDGE_WINDOW:
            middle_left -= cheap
        hits.reference_cost += cheap
        hits.naive_cost += last - index
        if index == 0:
            hits.at_front += 1
        if index == last:
            hits.at_back += 1
        if index <= EDGE_WINDOW:
            hits.near_front += 1
        if last - index <= EDGE_WINDOW:
            hits.near_back += 1
        if ring.wrapped:
            hits.across_wrap += 1
        return index

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    def book(index: int) -> None:
        """Book an index the generator chose directly (not through pick_index)."""
        last = ring.size - 1
        hits.reference_cost += min(index, last - index)
        hits.naive_cost += last - index
        if index == 0:
            hits.at_front += 1
        if index == last:
            hits.at_back += 1
        if index <= EDGE_WINDOW:
            hits.near_front += 1
        if last - index <= EDGE_WINDOW:
            hits.near_back += 1
        if ring.wrapped:
            hits.across_wrap += 1

    # Both edge indices explicitly, so a tiny block cannot miss them.
    if ring.size >= 2:
        commands.append("5 0")
        book(0)
        ring.erase(0)
        last = ring.size - 1
        commands.append("5 %d" % last)
        book(last)
        ring.erase(last)
        commands.append("8")

    while len(commands) < budget:
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op in (5, 8) and ring.size == 0:
            op = 1
        if op == 7 and ring.size > COPY_CHECK_MAX:
            op = 3
        if op == 8:
            if digests >= DIGESTS_PER_BLOCK:
                op = 4
            else:
                digests += 1
        if op == 1:
            commands.append("1 " + element(rng, kind))
            ring.push()
        elif op == 2:
            commands.append("2")
            ring.pop()
        elif op == 5:
            index = pick_index()
            commands.append("5 %d" % index)
            ring.erase(index)
        else:
            commands.append(str(op))

    lines = ["%d %d %d" % (kind, n, len(commands))]
    lines.append(" ".join(elements))
    lines.extend(commands)
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    big = index >= 5
    rng = random.Random(seed)
    hits = Counters()
    lines = [str(len(blocks))]
    biggest = 0
    for kind, n, budget, mix in blocks:
        lines.extend(block(rng, kind, n, budget, mix, hits, big and mix is BIG))
        biggest = max(biggest, n)

    # Self-checks. The first three are about coverage, the last two about the
    # complexity subtask actually separating the two implementations.
    if hits.at_front == 0:
        raise RuntimeError("case %d never erases the front element" % (index + 1))
    if hits.at_back == 0:
        raise RuntimeError("case %d never erases the last element" % (index + 1))
    if biggest >= 4 and hits.across_wrap == 0:
        raise RuntimeError("case %d never erases inside a wrapped ring" % (index + 1))
    if big:
        if hits.near_front < 1000 or hits.near_back < 1000:
            raise RuntimeError(
                "case %d has too few edge erasures (%d near the front, %d near the back)"
                % (index + 1, hits.near_front, hits.near_back))
        if hits.naive_cost < 40 * hits.reference_cost:
            raise RuntimeError(
                "case %d does not separate the two implementations: naive %d vs reference %d moves"
                % (index + 1, hits.naive_cost, hits.reference_cost))
        # Measured on the build image: an always-slide-the-tail erase runs out
        # of its 1000 ms at roughly 3.2e8 element moves. Every large case is
        # held to at least three times that, so the subtask still separates
        # the two implementations on a judge box a few times faster.
        if hits.naive_cost < 1_000_000_000:
            raise RuntimeError(
                "case %d gives the naive erase only %d element moves; want >= 1e9"
                % (index + 1, hits.naive_cost))
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: gen.py <output-directory>", file=sys.stderr)
        return 2
    out_dir = argv[1]
    os.makedirs(out_dir, exist_ok=True)
    for index in range(CASES):
        path = os.path.join(out_dir, "input%02d.txt" % (index + 1))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(build_case(index))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
