#!/usr/bin/env python3
"""Testcase generator for hp_que02_back.

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
50,000). This problem has no complexity subtask — an O(n) walk to the last
element is fine — so the big cases are about scale and wrap-around, not speed.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5" size | "6" copy check | "7" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 size, 6 copy check, 7 digest
TINY = {1: 20, 2: 16, 3: 14, 4: 26, 5: 6, 6: 8, 7: 2}
EDGY = {1: 26, 2: 32, 3: 10, 4: 20, 5: 4, 6: 4, 7: 0}
MIXED = {1: 24, 2: 18, 3: 8, 4: 36, 5: 4, 6: 5, 7: 2}
# `back` is the function under test, so it dominates every mix. The big cases
# keep the output cheap: one value per `back`, and `digest` boils a whole
# front/back walk down to a single line.
BIG = {1: 34, 2: 28, 3: 2, 4: 34, 5: 1, 6: 0, 7: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call — it is the only command here
# that is not O(1) — so each block gets a hard budget of them.
DIGESTS_PER_BLOCK = 12

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long — every case but the degenerate one exercises at least two
# different T, which is what breaks an int-only student.h.
PLAN = [
    (1201, [(1, 3, 14, TINY), (2, 2, 12, TINY)]),
    (1202, [(1, 0, 18, EDGY), (1, 1, 16, EDGY), (3, 2, 16, EDGY)]),
    (1203, [(1, 8, 44, MIXED), (2, 6, 30, MIXED), (3, 5, 24, TINY)]),
    (1204, [(1, 16, 90, MIXED), (2, 12, 70, MIXED), (3, 9, 60, EDGY)]),
    (1205, [(1, 300, 1500, MIXED), (2, 200, 1200, MIXED)]),
    (1206, [(1, 2000, 4000, MIXED), (3, 1200, 2500, MIXED)]),
    (1207, [(2, 1500, 3000, MIXED), (1, 2000, 6000, EDGY)]),
    (1208, [(1, 30000, 60000, BIG), (2, 2000, 4000, MIXED)]),
    (1209, [(3, 30000, 70000, BIG), (1, 20000, 50000, BIG)]),
    (1210, [(1, 50000, 130000, BIG), (2, 12000, 30000, BIG), (3, 8000, 20000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    The generator simulates mCap / mSize / mFront exactly as queue.h keeps
    them (capacity 1, doubling through ensureCapacity, expand() resetting
    mFront to 0) so that it can TELL when the queue is wrapped, aim `back`
    queries at those states and assert that they really happened instead of
    hoping random commands stumble into them.
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


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def wrap_primer(rng: random.Random, ring: Ring, kind: int, n: int) -> tuple[list[str], int]:
    """Commands that drive the ring into wrap-around, then read its back.

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

    if not ring.wrapped:
        return commands, 0
    # back() on a wrapped ring, then once more after a pop and a push so the
    # tail slot moves while wrapped.
    commands.append("4")
    commands.append("7")
    commands.append("2")
    ring.pop()
    commands.append("1 " + element(rng, kind))
    ring.push()
    commands.append("4")
    return commands, 3


def shrink_to_one(rng: random.Random, ring: Ring) -> list[str]:
    """Pop down to a single element, reading back() at the smallest sizes.

    front() and back() must agree once one element is left, and that is the
    one size where an off-by-one in back() is unmistakable.
    """
    commands: list[str] = []
    while ring.size > 1:
        commands.append("2")
        ring.pop()
        if ring.size <= 3:
            commands.append("4")
    if ring.size == 1:
        commands.append("3")
        commands.append("4")
        commands.append("7")
    return commands


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict) -> tuple[list[str], int]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    commands, wrapped_reads = wrap_primer(rng, ring, kind, n)

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    digests = sum(1 for line in commands if line == "7")
    while len(commands) < budget:
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 7 and ring.size == 0:
            op = 1
        if op == 6 and ring.size > COPY_CHECK_MAX:
            op = 3
        if op == 7:
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
        else:
            commands.append(str(op))
            if op == 4 and ring.wrapped:
                wrapped_reads += 1

    # Small blocks end by draining down to a single element, which is the
    # cheapest way to hit the size-1 case where front() == back().
    if ring.size <= 40:
        commands.extend(shrink_to_one(rng, ring))

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
        raise RuntimeError("case %d never reads back() across the wrap-around" % (index + 1))
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
