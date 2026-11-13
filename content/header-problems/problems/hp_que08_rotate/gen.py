#!/usr/bin/env python3
"""Testcase generator for hp_que08_rotate.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-5 are the 50%
subtask (n, q <= 2,000/3,000, remainders spread over the whole range, so even
a rotation that always goes forward passes), cases 6-10 the remaining 50%.

EVERY case from 6 on must defeat the forward-only rotation, because the judge
stops at the first failure: if case 6 let it through, that solution would
score 60% and not the 50% the statement promises.

The k values are constructed, not drawn at random: the generator knows the
queue's length at every command (see Ring), so it can ask for a specific
remainder r = k % size and then inflate k by whole multiples of size, which
changes nothing for a correct solution and is fatal for one that rotates k
times. In the large cases three quarters of the commands use r = size - small,
i.e. "turn back a handful of positions", which costs the intended solution
O(1) and the forward-only version almost the whole queue.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5 k" rotate(k) | "6" size | "7" copy check
                     | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 rotate, 6 size, 7 copy, 8 digest
TINY = {1: 20, 2: 14, 3: 12, 4: 12, 5: 28, 6: 5, 7: 7, 8: 2}
MIXED = {1: 22, 2: 14, 3: 8, 4: 8, 5: 40, 6: 3, 7: 3, 8: 2}
# Rotation-dominated, with a few pushes so the queue keeps its length and the
# push-after-rotate path is exercised. Queries stay sparse: `digest` already
# pins the whole order down for one line of output.
BIG = {1: 14, 2: 4, 3: 1, 4: 1, 5: 78, 6: 1, 7: 0, 8: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call, so each block gets a budget.
DIGESTS_PER_BLOCK = 10

# How far from a full turn the "cheap" remainders sit: r = size - 1 .. size - R
# (a backward turn of at most R positions) or r = 1 .. R (a forward one).
EDGE_TURN = 24

# The statement's cap on k.
K_MAX = 2_000_000_000

# Element writes the REFERENCE may spend on half-way rotations in one block,
# where it legitimately pays about n/2.
MIDDLE_BUDGET = 1_500_000

# Commands the wrap primer may spend; see wrap_primer.
PRIMER_MAX = 400

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long. Cases 1-5 are the small subtask, 6-10 the large one.
PLAN = [
    (1801, [(1, 5, 20, TINY), (2, 3, 16, TINY)]),
    (1802, [(1, 0, 14, TINY), (1, 1, 16, TINY), (3, 9, 50, TINY)]),
    (1803, [(1, 60, 300, MIXED), (2, 40, 200, MIXED), (3, 30, 160, TINY)]),
    (1804, [(1, 600, 1600, MIXED), (2, 400, 1200, MIXED)]),
    (1805, [(1, 2000, 3000, MIXED), (3, 1500, 2500, MIXED), (2, 900, 1800, MIXED)]),
    (1806, [(1, 50000, 34000, BIG), (2, 800, 1600, MIXED)]),
    (1807, [(2, 50000, 33000, BIG), (1, 12000, 8000, BIG)]),
    (1808, [(1, 50000, 32000, BIG), (3, 6000, 5000, BIG)]),
    (1809, [(2, 48000, 34000, BIG), (1, 30000, 20000, BIG)]),
    (1810, [(1, 50000, 32000, BIG), (2, 20000, 14000, BIG), (3, 4000, 4000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    rotate() keeps mCap and mSize and only moves mFront — forward by r or
    backward by mSize - r — so the generator can follow mFront exactly and
    knows when the queue crosses the end of mData. A backward turn from
    mFront = 0 lands at mCap - 1, which wraps the ring immediately; that is
    why the large cases are wrapped almost from the first command.
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

    def rotate(self, effective: int) -> None:
        """Move mFront the way the reference does, by the shorter side.

        Turning forward by r and backward by mSize - r leave the queue
        logically identical but mFront in two different slots, so the
        simulation has to make the same choice the reference makes or its
        `wrapped` answer drifts away from reality.
        """
        if self.size == 0 or effective == 0:
            return
        if effective <= self.size - effective:
            self.front = (self.front + effective) % self.cap
        else:
            back = (self.size - effective) % self.cap
            self.front = (self.front + self.cap - back) % self.cap

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
        self.zero = 0
        self.full_turn = 0
        self.huge_k = 0
        self.backward = 0
        self.forward = 0
        self.across_wrap = 0
        self.naive_cost = 0      # positions a forward-only rotation turns
        self.reference_cost = 0  # positions the intended rotation turns


def wrap_primer(rng: random.Random, ring: Ring, kind: int, n: int) -> list[str]:
    """A few pops and pushes to get mFront off zero.

    Capped on purpose: in this problem the rotations themselves move mFront
    all over the array, so the primer only has to get things started. An
    uncapped primer would be O(n) commands and would eat the block's budget.
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

    def inflate(remainder: int) -> int:
        """k with this remainder, sometimes enormously inflated."""
        size = ring.size
        if size == 0:
            return remainder
        room = (K_MAX - remainder) // size
        if room <= 0:
            return remainder
        roll = rng.random()
        if roll < 0.60:
            multiple = 0
        elif roll < 0.85:
            multiple = rng.randint(1, min(4, room))
        else:
            # A k above 10^9 whenever the queue is long enough to reach it.
            low = max(1, min(room, 1_000_000_000 // size))
            multiple = rng.randint(low, room)
        k = remainder + multiple * size
        if k > 1_000_000_000:
            hits.huge_k += 1
        return k

    def pick_k() -> int:
        nonlocal middle_left
        size = ring.size
        if size == 0:
            return rng.randint(0, 5)
        roll = rng.random()
        if not big:
            # The small subtask spreads the remainder over the whole range.
            if roll < 0.10:
                remainder = 0
            elif roll < 0.20:
                remainder = size  # a full turn: must change nothing
            else:
                remainder = rng.randint(0, size - 1)
        else:
            if roll < 0.75:
                # Just short of a full turn: the intended solution steps
                # BACKWARD a handful of positions.
                remainder = size - rng.randint(1, min(EDGE_TURN, size))
            elif roll < 0.90:
                remainder = rng.randint(0, min(EDGE_TURN, size - 1))
            elif roll < 0.94:
                remainder = size
            elif middle_left > 0:
                remainder = rng.randint(0, size - 1)
            else:
                remainder = size - rng.randint(1, min(EDGE_TURN, size))

        effective = remainder % size
        cheap = min(effective, size - effective) if effective else 0
        if cheap > EDGE_TURN:
            middle_left -= cheap
        hits.reference_cost += cheap
        hits.naive_cost += effective
        if effective == 0:
            hits.zero += 1
            if remainder == size:
                hits.full_turn += 1
        elif effective * 2 > size:
            hits.backward += 1
        else:
            hits.forward += 1
        if ring.wrapped:
            hits.across_wrap += 1
        ring.rotate(effective)
        return inflate(remainder)

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    def forced(remainder: int, inflated: bool = False) -> None:
        """Emit one rotation the generator chose itself, and book its cost."""
        size = ring.size
        effective = remainder % size if size else 0
        cheap = min(effective, size - effective) if effective else 0
        hits.reference_cost += cheap
        hits.naive_cost += effective
        if effective == 0:
            hits.zero += 1
            if remainder == size:
                hits.full_turn += 1
        elif effective * 2 > size:
            hits.backward += 1
        else:
            hits.forward += 1
        if ring.wrapped:
            hits.across_wrap += 1
        text = inflate(remainder) if inflated else remainder
        ring.rotate(effective)
        commands.append("5 %d" % text)

    # The four k values every block must see, whatever the dice say: no turn,
    # a full turn, one position forward, one position back.
    if ring.size >= 2:
        forced(0)
        forced(ring.size)
        forced(1)
        forced(ring.size - 1, inflated=True)
        commands.append("8")

    while len(commands) < budget:
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 8 and ring.size == 0:
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
            commands.append("5 %d" % pick_k())
        else:
            commands.append(str(op))

    lines = ["%d %d %d" % (kind, n, len(commands))]
    lines.append(" ".join(elements))
    lines.extend(commands)
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    hits = Counters()
    lines = [str(len(blocks))]
    biggest = 0
    for kind, n, budget, mix in blocks:
        lines.extend(block(rng, kind, n, budget, mix, hits, mix is BIG))
        biggest = max(biggest, n)

    if hits.zero == 0 or hits.full_turn == 0:
        raise RuntimeError("case %d never rotates by 0 or by a full turn" % (index + 1))
    if hits.forward == 0 or hits.backward == 0:
        raise RuntimeError("case %d does not use both turn directions" % (index + 1))
    if biggest >= 4 and hits.across_wrap == 0:
        raise RuntimeError("case %d never rotates a wrapped ring" % (index + 1))
    if biggest >= 2000 and hits.huge_k == 0:
        raise RuntimeError("case %d never passes a k above 10^9" % (index + 1))
    if index >= 5:
        # Measured on the build image: a forward-only rotation runs out of its
        # 1000 ms at roughly 3.2e8 turned positions. Every large case is held
        # to at least three times that, so the subtask still separates the two
        # implementations on a judge box a few times faster.
        if hits.naive_cost < 1_000_000_000:
            raise RuntimeError(
                "case %d gives the forward-only rotation only %d positions; want >= 1e9"
                % (index + 1, hits.naive_cost))
        if hits.naive_cost < 40 * max(1, hits.reference_cost):
            raise RuntimeError(
                "case %d does not separate the two implementations: naive %d vs reference %d"
                % (index + 1, hits.naive_cost, hits.reference_cost))
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
