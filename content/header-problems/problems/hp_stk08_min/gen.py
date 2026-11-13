#!/usr/bin/env python3
"""Testcase generator for hp_stk08_min.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-5 are the 50% subtask
(n <= 2,000, q <= 6,000, where scanning the array inside min() still fits in
the time limit), cases 6-10 the remaining 50%, where it does not.

Two different jobs, two different shapes:

  * the SMALL cases are about correctness. They push long DESCENDING runs, so
    every pop removes the current minimum and min() has to fall back to the
    one below it, and they use the "pop then print min" command heavily. A
    solution that only ever remembers the smallest value it has seen dies
    here.
  * the LARGE cases are about the time bound. They are min-query dominated —
    a query is two bytes of input and no output at all, which is the cheapest
    way in archive bytes to ask for min() a hundred thousand times — and they
    keep the stack TALL and its minimum at the BOTTOM, so the reference never
    has to rescan while the naive version scans 50,000 elements per query.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size | "5" min
                     | "6" copy check | "7" fold min | "8" pop then print min
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..8.
#   1 push, 2 pop, 3 top, 4 size, 5 print min, 6 copy check, 7 fold min,
#   8 pop then print min
MIXED = {1: 26, 2: 10, 3: 8, 4: 4, 5: 22, 6: 6, 7: 10, 8: 14}
# Small and brutal on the minimum: mostly descending pushes (see below) and
# pops that take the minimum away again.
PEEL = {1: 30, 2: 12, 3: 6, 4: 2, 5: 18, 6: 4, 7: 8, 8: 20}
# The big cases: ask for min() as often as possible, grow the stack, and
# almost never pop.
MIN_HEAVY = {1: 22, 2: 4, 3: 1, 4: 1, 5: 2, 6: 0, 7: 68, 8: 2}

COPY_CHECK_MAX_N = 300
LARGE_FROM = 2000
# Values strictly below everything else the generator emits, so a block can
# park its minimum at the very bottom of the stack.
SENTINEL = {1: "-2000000", 2: "a", 3: "-8000000000"}

PLAN = [
    (1801, [(1, 5, 20, PEEL), (3, 4, 16, PEEL)]),
    (1802, [(1, 10, 60, PEEL), (2, 8, 40, MIXED), (3, 6, 30, PEEL)]),
    (1803, [(1, 0, 60, PEEL), (1, 1, 40, PEEL), (2, 2, 40, MIXED)]),
    (1804, [(1, 300, 1500, PEEL), (2, 200, 900, MIXED)]),
    (1805, [(1, 1200, 4000, PEEL), (3, 900, 2500, PEEL), (2, 300, 900, MIXED)]),
    (1806, [(1, 50000, 130000, MIN_HEAVY), (2, 300, 900, PEEL)]),
    (1807, [(2, 50000, 130000, MIN_HEAVY), (1, 400, 1200, PEEL)]),
    (1808, [(3, 50000, 130000, MIN_HEAVY), (1, 400, 1200, PEEL)]),
    (1809, [(1, 50000, 130000, MIN_HEAVY), (3, 500, 1500, PEEL)]),
    (1810, [(1, 50000, 130000, MIN_HEAVY), (2, 600, 1800, PEEL)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One stack element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]
    large = n >= LARGE_FROM
    descending = mix is PEEL and kind != 2

    lines = ["%d %d %d" % (kind, n, count)]
    # The large blocks put their minimum at the bottom on purpose: the
    # reference then never rescans, while the naive min() still has to walk
    # every element on every query.
    initial = [element(rng, kind) for _ in range(n)]
    if large and initial:
        initial[0] = SENTINEL[kind]
    lines.append(" ".join(initial))

    size = n
    # For the descending runs: the smallest value emitted so far, so the next
    # "descend" push is guaranteed to become the new minimum.
    low = -1_000_000 if kind == 1 else -4_000_000_000

    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        # Keep the large blocks from ever draining past their sentinel.
        if large and op in (2, 8) and size <= 2:
            op = 1

        if op == 1:
            if descending and rng.random() < 0.6:
                low -= rng.randint(1, 3)
                lines.append("1 %d" % low)
            else:
                lines.append("1 " + element(rng, kind))
            size += 1
        elif op in (2, 8):
            lines.append(str(op))
            size = max(size - 1, 0)
        else:
            lines.append(str(op))
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, count, mix in blocks:
        lines.extend(block(rng, kind, n, count, mix))
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
