#!/usr/bin/env python3
"""Testcase generator for hp_que01_at.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-4 are the 40%
subtask (hand-checkable sizes, including an empty and a one-element queue),
cases 5-7 the next 30% (n up to 2,000), cases 8-10 the last 30% (n up to
50,000). This problem has no complexity subtask — an O(i) walk is fine — so
the point of the big cases is scale and wrap-around, not speed.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5 i" at(i) | "6" size | "7" copy check | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 at, 6 size, 7 copy check, 8 digest
TINY = {1: 20, 2: 16, 3: 14, 4: 12, 5: 22, 6: 6, 7: 8, 8: 2}
EDGY = {1: 26, 2: 30, 3: 12, 4: 10, 5: 14, 6: 4, 7: 4, 8: 0}
MIXED = {1: 24, 2: 18, 3: 8, 4: 7, 5: 32, 6: 4, 7: 5, 8: 2}
# The big cases keep the output small: `at` queries print one value, so they
# are the expensive part of the archive, and `digest` reads the WHOLE queue
# through at() for a single line of output.
BIG = {1: 34, 2: 28, 3: 2, 4: 3, 5: 32, 6: 1, 7: 0, 8: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call — it is the only command here
# that is not O(1) — so each block gets a hard budget of them. A dozen scans
# of the whole queue, spread through the block, pins the order down without
# putting the reference anywhere near the time limit.
DIGESTS_PER_BLOCK = 12

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long — every case but the degenerate one exercises at least two
# different T, which is what breaks an int-only student.h.
PLAN = [
    (1101, [(1, 3, 14, TINY), (2, 2, 12, TINY)]),
    (1102, [(1, 0, 18, EDGY), (1, 1, 16, EDGY), (3, 2, 16, EDGY)]),
    (1103, [(1, 8, 44, MIXED), (2, 6, 30, MIXED), (3, 5, 24, TINY)]),
    (1104, [(1, 16, 90, MIXED), (2, 12, 70, MIXED), (3, 9, 60, EDGY)]),
    (1105, [(1, 300, 1500, MIXED), (2, 200, 1200, MIXED)]),
    (1106, [(1, 2000, 4000, MIXED), (3, 1200, 2500, MIXED)]),
    (1107, [(2, 1500, 3000, MIXED), (1, 2000, 6000, EDGY)]),
    (1108, [(1, 30000, 60000, BIG), (2, 2000, 4000, MIXED)]),
    (1109, [(3, 30000, 70000, BIG), (1, 20000, 50000, BIG)]),
    (1110, [(1, 50000, 130000, BIG), (2, 12000, 30000, BIG), (3, 8000, 20000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    The generator simulates mCap / mSize / mFront exactly as queue.h keeps
    them (capacity 1, doubling through ensureCapacity, expand() resetting
    mFront to 0) so that it can TELL when the queue is wrapped and aim `at`
    queries at indices whose physical slot is past the end of the array. That
    is the trap this problem is about, so the generator asserts it really
    happened instead of hoping random commands stumble into it.
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


def query_index(rng: random.Random, ring: Ring) -> int:
    """An index to ask `at` about, biased towards the interesting ones."""
    roll = rng.random()
    if roll < 0.15:
        return 0
    if roll < 0.30:
        return ring.size - 1
    if roll < 0.70:
        first = ring.first_wrapped_index()
        if first is not None and first < ring.size:
            return rng.randint(first, ring.size - 1)
    return rng.randint(0, ring.size - 1)


def wrap_primer(rng: random.Random, ring: Ring, kind: int, n: int) -> tuple[list[str], int]:
    """Commands that drive the ring into wrap-around, then read across it.

    After n pushes the capacity is the next power of two >= n and mFront is 0,
    so nothing is wrapped yet. Popping p elements moves mFront to p and
    pushing p back makes the tail run off the end of the array as soon as
    p + mSize > mCap.
    """
    if n == 0:
        return [], 0
    commands: list[str] = []
    needed = ring.cap - ring.size + 1 + n // 4
    steps = min(n, max(1, needed))
    for _ in range(steps):
        commands.append("2")
        ring.pop()
    for _ in range(steps):
        commands.append("1 " + element(rng, kind))
        ring.push()

    wrapped = 0
    first = ring.first_wrapped_index()
    if first is not None and first < ring.size:
        commands.append("5 %d" % first)
        commands.append("5 %d" % (ring.size - 1))
        commands.append("8")
        wrapped = 3
    return commands, wrapped


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict) -> tuple[list[str], int]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    commands, wrapped_reads = wrap_primer(rng, ring, kind, n)

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    digests = sum(1 for line in commands if line == "8")
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
            index = query_index(rng, ring)
            commands.append("5 %d" % index)
            first = ring.first_wrapped_index()
            if first is not None and index >= first:
                wrapped_reads += 1
        else:
            commands.append(str(op))
            if op == 8 and ring.wrapped:
                wrapped_reads += 1

    lines = ["%d %d %d" % (kind, n, len(commands))]
    lines.append(" ".join(elements))
    lines.extend(commands)
    return lines, wrapped_reads


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    wrapped_reads = 0
    biggest = 0
    for kind, n, budget, mix in blocks:
        produced, wrapped = block(rng, kind, n, budget, mix)
        lines.extend(produced)
        wrapped_reads += wrapped
        biggest = max(biggest, n)
    # Self-check: a case whose queue never wraps would not test this problem
    # at all. Four elements are enough for the primer to force it.
    if biggest >= 4 and wrapped_reads == 0:
        raise RuntimeError("case %d never reads across the wrap-around" % (index + 1))
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
