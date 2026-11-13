#!/usr/bin/env python3
"""Testcase generator for hp_pair02_less.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-2   (20%)  pair<int,int> only, tiny
    cases 3-5   (30%)  pair<std::string,int> and pair<int,std::string> too
    cases 6-10  (50%)  large, and `first` is drawn from a tiny pool so most
                       comparisons are decided by `second` — exactly what an
                       implementation that forgets the tie case gets wrong

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<string,int>,
                          3 = pair<int,string>
    n lines: a b
    q command lines: "1 i j" | "2 i a b" | "3 i j" | "4 i a b" | "5 i" | "6"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: cmp, assign, min, temp, zero, argmin.
MIXED = {1: 34, 2: 14, 3: 18, 4: 20, 5: 8, 6: 6}
# Tie-heavy traffic: cmp and temp dominate, because those are the commands
# whose printed digits change when the `first`-equal case is mishandled.
TIE_HEAVY = {1: 46, 2: 10, 3: 12, 4: 26, 5: 4, 6: 2}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# `argmin` scans the whole array, so its cost is O(n) per call: left in the
# mix on a 20,000-element block it would make the REFERENCE quadratic and eat
# the time limit, which would measure the grader rather than the submission.
# It is therefore only emitted for small blocks, where it is the command that
# checks the ordering over the whole array at once.
ARGMIN_MAX_N = 2000

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "int"), 2: ("str", "int"), 3: ("int", "str")}

# Case plan: (seed, first_pool, second_pool, [(kind, n, q, mix), ...]).
#
# `first_pool` is how many distinct values `first` is drawn from. A pool of 2
# or 3 means almost every comparison is a tie on `first`; the big cases use
# that on purpose.
PLAN = [
    (2101, 1000, 1000, [(1, 3, 12, MIXED)]),
    (2102, 3, 1000, [(1, 10, 40, TIE_HEAVY), (1, 1, 10, MIXED)]),
    (2103, 1000, 1000, [(1, 8, 30, MIXED), (2, 6, 24, MIXED)]),
    (2104, 4, 50, [(2, 20, 90, TIE_HEAVY), (3, 20, 90, TIE_HEAVY)]),
    (2105, 60, 60, [(1, 200, 800, MIXED), (2, 150, 600, MIXED), (3, 150, 600, MIXED)]),
    (2106, 2, 1000, [(1, 3000, 9000, TIE_HEAVY), (3, 1000, 3000, TIE_HEAVY)]),
    (2107, 3, 1000, [(2, 5000, 12000, TIE_HEAVY), (1, 2000, 6000, MIXED)]),
    (2108, 2, 40, [(3, 8000, 16000, TIE_HEAVY), (2, 4000, 8000, TIE_HEAVY)]),
    (2109, 2, 1000000, [(1, 14000, 24000, TIE_HEAVY), (3, 6000, 10000, TIE_HEAVY)]),
    (2110, 2, 1000000000, [(1, 20000, 40000, TIE_HEAVY), (2, 20000, 40000, TIE_HEAVY),
                           (3, 2000, 4000, MIXED)]),
]


def token(rng: random.Random, kind_of_component: str, pool: int) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    if kind_of_component == "int":
        return str(rng.randrange(pool) - pool // 2)
    index = rng.randrange(pool)
    # A stable name per index, so the same index always yields the same string
    # and equal components really are equal.
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def pair_tokens(rng: random.Random, kind: int, first_pool: int, second_pool: int) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, first_pool) + " " + token(rng, second_type, second_pool)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict,
          first_pool: int, second_pool: int) -> list[str]:
    usable = dict(mix)
    if n > ARGMIN_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]

    assert n > 0, "hp_pair02_less blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, first_pool, second_pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 6:
            lines.append("6")
            continue
        i = rng.randrange(n)
        if op in (1, 3):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
        elif op in (2, 4):
            lines.append("%d %d %s" % (op, i, pair_tokens(rng, kind, first_pool, second_pool)))
        else:
            lines.append("%d %d" % (op, i))
    return lines


def build_case(index: int) -> str:
    seed, first_pool, second_pool, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix in blocks:
        lines.extend(block(rng, kind, n, commands, mix, first_pool, second_pool))
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
