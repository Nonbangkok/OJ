#!/usr/bin/env python3
"""Testcase generator for hp_que05_m2b.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-4 are the 40%
subtask (hand-checkable sizes), cases 5-7 the next 30% (n up to 2,000),
cases 8-10 the last 30% (n up to 20,000).

move_to_back(i) legitimately costs O(size - i), so the generator carries a
SHIFT BUDGET: it spends moves with a small i (the expensive ones, which are
also the ones that exercise a long wrapped run) until the budget runs out and
then keeps to the cheap end of the queue. Without it a big block of
front-moves would be quadratic for the reference too, and the problem would
be about the time limit rather than about the ring arithmetic.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5 i" move_to_back(i) | "6" size | "7" copy check
                     | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 move_to_back, 6 size, 7 copy, 8 digest
TINY = {1: 18, 2: 14, 3: 12, 4: 12, 5: 28, 6: 6, 7: 8, 8: 2}
EDGY = {1: 22, 2: 28, 3: 10, 4: 10, 5: 22, 6: 4, 7: 4, 8: 0}
MIXED = {1: 20, 2: 16, 3: 8, 4: 8, 5: 37, 6: 4, 7: 5, 8: 2}
BIG = {1: 20, 2: 16, 3: 2, 4: 2, 5: 58, 6: 1, 7: 0, 8: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call, so each block gets a budget.
DIGESTS_PER_BLOCK = 12

# Total element writes the reference may spend on moves in one block. Each
# write costs two modulo operations, so 2.5e6 of them is a few tens of
# milliseconds — the measured reference stays under a tenth of the time limit,
# which leaves room for the judge being a slower box than the build image.
SHIFT_BUDGET = 2_500_000

# move_to_back(i) slides every element BEHIND i, so a small i is the expensive
# one: the budget is charged size - 1 - i per move.
SPEND_FROM_BACK = True

# How far from the back the cheap moves are taken from once the budget is out.
CHEAP_WINDOW = 64

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long — every case but the degenerate one exercises at least two
# different T, which is what breaks an int-only student.h.
PLAN = [
    (1501, [(1, 3, 16, TINY), (2, 2, 14, TINY)]),
    (1502, [(1, 0, 20, EDGY), (1, 1, 16, EDGY), (3, 2, 18, EDGY)]),
    (1503, [(1, 8, 44, MIXED), (2, 6, 30, MIXED), (3, 5, 24, TINY)]),
    (1504, [(1, 16, 90, MIXED), (2, 12, 70, MIXED), (3, 9, 60, EDGY)]),
    (1505, [(1, 300, 1500, MIXED), (2, 200, 1200, MIXED)]),
    (1506, [(1, 2000, 4000, MIXED), (3, 1200, 2500, MIXED)]),
    (1507, [(2, 1500, 3000, MIXED), (1, 2000, 6000, EDGY)]),
    (1508, [(1, 12000, 30000, BIG), (2, 2000, 4000, MIXED)]),
    (1509, [(3, 15000, 40000, BIG), (1, 10000, 25000, BIG)]),
    (1510, [(1, 20000, 60000, BIG), (2, 6000, 15000, BIG), (3, 4000, 12000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    move_to_back does not change mCap / mSize / mFront, so only push, pop and
    the growth rule need modelling. The generator uses it to know when the
    queue is WRAPPED (mFront + mSize > mCap), which is when the run of slots a
    move has to slide crosses the end of mData.
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

    @property
    def wrapped(self) -> bool:
        return self.front + self.size > self.cap

    def first_wrapped_index(self) -> int | None:
        """The smallest i whose slot (mFront + i) % mCap has wrapped around."""
        if not self.wrapped:
            return None
        return self.cap - self.front


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


class Counters:
    def __init__(self) -> None:
        self.from_front = 0
        self.from_back = 0
        self.across_wrap = 0


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
    steps = min(n, max(1, needed))
    for _ in range(steps):
        commands.append("2")
        ring.pop()
    for _ in range(steps):
        commands.append("1 " + element(rng, kind))
        ring.push()
    return commands


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict,
          hits: Counters) -> list[str]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    commands = wrap_primer(rng, ring, kind, n)
    shift_left = SHIFT_BUDGET
    digests = 0

    def pick_index() -> int:
        """An index to move, biased towards the interesting ones."""
        nonlocal shift_left
        if ring.size == 1:
            # index 0 is both the first and the last element here
            hits.from_front += 1
            hits.from_back += 1
            return 0
        roll = rng.random()
        if shift_left <= 0:
            index = rng.randint(max(0, ring.size - CHEAP_WINDOW), ring.size - 1)
        elif roll < 0.14:
            index = 0
        elif roll < 0.28:
            index = ring.size - 1
        elif roll < 0.55:
            first = ring.first_wrapped_index()
            if first is not None and first < ring.size:
                index = rng.randint(first, ring.size - 1)
            else:
                index = rng.randint(0, ring.size - 1)
        else:
            index = rng.randint(0, ring.size - 1)
        shift_left -= ring.size - 1 - index
        if index == 0:
            hits.from_front += 1
        if index + 1 == ring.size:
            hits.from_back += 1
        if ring.wrapped:
            hits.across_wrap += 1
        return index

    def pick_index_record(index: int) -> None:
        """Book an index the generator picked directly against the budget."""
        nonlocal shift_left
        shift_left -= (ring.size - 1 - index) if SPEND_FROM_BACK else index
        if index == 0:
            hits.from_front += 1
        if index + 1 == ring.size:
            hits.from_back += 1
        if ring.wrapped:
            hits.across_wrap += 1

    # Both edge indices, explicitly, before any random command: a tiny block
    # must not depend on the dice to reach them.
    if ring.size >= 2:
        commands.append("5 0")
        pick_index_record(0)
        commands.append("5 %d" % (ring.size - 1))
        pick_index_record(ring.size - 1)
        commands.append("8")

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    burst = 0
    while len(commands) < budget:
        if burst > 0 and ring.size > 0:
            burst -= 1
            commands.append("5 %d" % pick_index())
            continue
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
            commands.append("5 %d" % pick_index())
            # Repeated moves in a row: the queue is reshuffled between calls,
            # so a solution that only works on a freshly built queue fails.
            if rng.random() < 0.25:
                burst = rng.randint(2, 8)
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
        lines.extend(block(rng, kind, n, budget, mix, hits))
        biggest = max(biggest, n)
    # Self-checks: the three states the statement promises to test.
    if hits.from_front == 0:
        raise RuntimeError("case %d never moves the front element" % (index + 1))
    if hits.from_back == 0:
        raise RuntimeError("case %d never moves the last element (the no-op case)" % (index + 1))
    if biggest >= 4 and hits.across_wrap == 0:
        raise RuntimeError("case %d never moves inside a wrapped ring" % (index + 1))
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
