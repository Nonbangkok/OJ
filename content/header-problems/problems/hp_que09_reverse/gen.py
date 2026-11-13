#!/usr/bin/env python3
"""Testcase generator for hp_que09_reverse.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-5 are the 50%
subtask (n, q <= 2,000), cases 6-10 the remaining 50% (n up to 80,000), where
an O(n) physical reverse must time out.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5" reverse | "6" size | "7" copy check
"""

import os
import random
import sys

CASES = 10

# A command-mix profile: weight per opcode 1..7.
#   1 push, 2 pop, 3 front, 4 back, 5 reverse, 6 size, 7 copy check
MIXED = {1: 22, 2: 14, 3: 18, 4: 12, 5: 20, 6: 6, 7: 8}
EDGY = {1: 18, 2: 26, 3: 18, 4: 12, 5: 14, 6: 6, 7: 6}
# The big cases are reverse-dominated on purpose: a `reverse` command is two
# bytes of input and no output, but costs an O(n) solution n/2 element moves,
# so this is the cheapest possible way (in archive bytes) to separate O(1)
# from O(n). Queries stay sparse for the same reason — the per-block drain at
# the end already checks the whole logical order.
REVERSE_HEAVY = {1: 7, 2: 4, 3: 2, 4: 1, 5: 85, 6: 1, 7: 0}
REVERSE_DENSE = {1: 5, 2: 3, 3: 1, 4: 1, 5: 89, 6: 1, 7: 0}

# "copy check" prints the whole copied queue, and copies it element by
# element; it is only useful (and only affordable) on small queues.
COPY_CHECK_MAX_N = 300

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long — every case exercises at least two different T.
#
# Cases 1-5 are the 50% subtask and stay small enough that an O(n) physical
# reverse passes them comfortably. EVERY case from 6 on must defeat it,
# because the judge stops at the first failure: if case 6 let the O(n)
# solution through it would score 60%, not the 50% the statement promises. So
# the jump at case 6 is deliberately steep (~2.3e9 element moves for an O(n)
# reverse) and grows from there.
PLAN = [
    (9001, [(1, 3, 12, MIXED), (2, 2, 10, MIXED)]),
    (9002, [(1, 8, 30, MIXED), (2, 6, 25, MIXED), (3, 5, 20, MIXED)]),
    (9003, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (9004, [(1, 200, 800, MIXED), (2, 120, 500, MIXED)]),
    (9005, [(1, 2000, 2000, MIXED), (2, 800, 1200, MIXED), (3, 500, 900, MIXED)]),
    (9006, [(1, 22000, 170000, REVERSE_HEAVY), (2, 400, 800, MIXED)]),
    (9007, [(1, 24000, 170000, REVERSE_HEAVY), (3, 400, 800, MIXED)]),
    (9008, [(1, 28000, 180000, REVERSE_HEAVY), (2, 600, 1200, MIXED)]),
    (9009, [(1, 32000, 190000, REVERSE_HEAVY), (3, 800, 1600, MIXED)]),
    (9010, [(1, 36000, 200000, REVERSE_DENSE), (2, 800, 1600, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[7] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            lines.append("1 " + element(rng, kind))
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
