#!/usr/bin/env python3
"""Testcase generator for hp_stk05_swap_top.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-3 are the 30% subtask
(n <= 10, and the ones that run the stack down to one element and to empty,
where swap_top() must do nothing), cases 4-10 the remaining 70%.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size
                     | "5" swap_top | "6" copy check | "7" fold top
                     | "8" swap twice and print the top
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..8.
#   1 push, 2 pop, 3 top, 4 size, 5 swap_top, 6 copy check, 7 fold top,
#   8 swap twice and print
MIXED = {1: 20, 2: 14, 3: 14, 4: 4, 5: 26, 6: 8, 7: 6, 8: 8}
# Pop-heavy: the stack keeps falling to one element and to empty, which is
# where swap_top() must not touch anything.
EDGY = {1: 22, 2: 30, 3: 16, 4: 4, 5: 20, 6: 4, 7: 0, 8: 4}
# The big cases swap and read the top through the hash, both of which are
# two bytes of input and no output.
SWAP_HEAVY = {1: 18, 2: 12, 3: 1, 4: 1, 5: 40, 6: 0, 7: 26, 8: 2}

COPY_CHECK_MAX_N = 300

PLAN = [
    (1501, [(1, 4, 18, MIXED), (2, 3, 14, MIXED)]),
    (1502, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 24, MIXED)]),
    (1503, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (1504, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED)]),
    (1505, [(1, 2000, 6000, MIXED), (3, 1500, 4000, MIXED)]),
    (1506, [(1, 20000, 60000, SWAP_HEAVY), (2, 300, 900, EDGY)]),
    (1507, [(2, 20000, 60000, SWAP_HEAVY), (1, 400, 1200, EDGY)]),
    (1508, [(3, 30000, 90000, SWAP_HEAVY), (1, 400, 1200, EDGY)]),
    (1509, [(1, 40000, 110000, SWAP_HEAVY), (3, 500, 1500, EDGY)]),
    (1510, [(1, 50000, 120000, SWAP_HEAVY), (2, 600, 1800, EDGY)]),
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
