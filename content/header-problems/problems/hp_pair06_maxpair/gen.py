#!/usr/bin/env python3
"""Testcase generator for hp_pair06_maxpair.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-3   (30%)  pair<int,int> only, tiny
    cases 4-6   (30%)  pair<std::string,int> and pair<long long,long long> too
    cases 7-10  (40%)  large, with both components drawn from a small pool so
                       equal pairs are common — that is the case where the
                       "ties return *this" rule, and therefore the L/R marker
                       the grader prints, decides the verdict

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<string,int>,
                          3 = pair<long long,long long>
    n lines: a b
    q command lines: "1 i j" | "2 i j k" | "3 i j" | "4 i a b" | "5 i" | "6 i"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: max, max3, dom, assign, self, zero.
MIXED = {1: 30, 2: 18, 3: 20, 4: 14, 5: 10, 6: 8}
# Tie-heavy traffic: the commands whose L/R marker changes when equal pairs
# are resolved the wrong way round.
TIE_HEAVY = {1: 30, 2: 16, 3: 30, 4: 8, 5: 12, 6: 4}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "int"), 2: ("str", "int"), 3: ("llong", "llong")}

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
#
# `pool` is how many distinct values EACH component is drawn from, so two
# random pairs are exactly equal with probability about 1/pool^2.
PLAN = [
    (6101, 1000, [(1, 3, 12, MIXED)]),
    (6102, 3, [(1, 8, 32, TIE_HEAVY), (1, 1, 8, MIXED)]),
    (6103, 1000, [(1, 12, 48, MIXED), (1, 4, 20, TIE_HEAVY)]),
    (6104, 4, [(2, 16, 64, TIE_HEAVY), (3, 16, 64, TIE_HEAVY)]),
    (6105, 50, [(1, 200, 800, MIXED), (2, 150, 600, MIXED), (3, 150, 600, MIXED)]),
    (6106, 3, [(1, 2000, 6000, TIE_HEAVY), (3, 1000, 3000, TIE_HEAVY)]),
    (6107, 4, [(2, 4000, 9000, TIE_HEAVY), (1, 2000, 5000, MIXED)]),
    (6108, 3, [(3, 8000, 14000, TIE_HEAVY), (2, 3000, 6000, TIE_HEAVY)]),
    (6109, 5, [(1, 12000, 18000, TIE_HEAVY), (3, 5000, 8000, TIE_HEAVY)]),
    (6110, 3, [(1, 20000, 26000, TIE_HEAVY), (2, 9000, 12000, TIE_HEAVY),
               (3, 2000, 4000, MIXED)]),
]


def token(rng: random.Random, component_type: str, pool: int) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    index = rng.randrange(pool)
    if component_type == "int":
        return str(index * 7919 - 1_000_000_000 + pool)
    if component_type == "llong":
        return str(index * 104_729 - 4_000_000_000 + pool)
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def pair_tokens(rng: random.Random, kind: int, pool: int) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, pool) + " " + token(rng, second_type, pool)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, pool: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair06_maxpair blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op in (1, 3):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
        elif op == 2:
            lines.append("2 %d %d %d" % (i, rng.randrange(n), rng.randrange(n)))
        elif op == 4:
            lines.append("4 %d %s" % (i, pair_tokens(rng, kind, pool)))
        else:
            lines.append("%d %d" % (op, i))
    return lines


def build_case(index: int) -> str:
    seed, pool, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix in blocks:
        lines.extend(block(rng, kind, n, commands, mix, pool))
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
