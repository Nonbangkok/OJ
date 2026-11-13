#!/usr/bin/env python3
"""Testcase generator for hp_pair03_gte.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-3   (30%)  pair<int,int> only, tiny
    cases 4-5   (20%)  pair<string,string> and pair<long long,int> too
    cases 6-10  (50%)  large, with both components drawn from a tiny pool so
                       a large share of every comparison is between pairs that
                       are EQUAL — the edge an >= implemented as a strict > or
                       as "> or first-equal" gets wrong

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<string,string>,
                          3 = pair<long long,int>
    n lines: a b
    q command lines: "1 i j" | "2 i a b" | "3 i j" | "4 i a b" | "5 i"
                     | "6 i" | "7 i"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7: cmp, assign, clamp, temp, self, zero, copy.
MIXED = {1: 30, 2: 12, 3: 16, 4: 18, 5: 8, 6: 8, 7: 8}
# Equality-heavy traffic: the commands whose digits move when the equal case
# is wrong (cmp against a near-identical element, self, copy) dominate.
EQUAL_HEAVY = {1: 34, 2: 8, 3: 10, 4: 20, 5: 12, 6: 4, 7: 12}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "int"), 2: ("str", "str"), 3: ("llong", "int")}

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
#
# `pool` is how many distinct values EACH component is drawn from, so the
# chance that two random pairs are exactly equal is about 1/pool^2. The big
# cases use a pool of 3-5, which makes equal pairs the common case rather than
# an afterthought.
PLAN = [
    (3101, 1000, [(1, 3, 12, MIXED)]),
    (3102, 3, [(1, 8, 36, EQUAL_HEAVY), (1, 1, 10, MIXED)]),
    (3103, 1000, [(1, 10, 40, MIXED), (1, 4, 20, EQUAL_HEAVY)]),
    (3104, 4, [(2, 16, 70, EQUAL_HEAVY), (3, 16, 70, EQUAL_HEAVY)]),
    (3105, 40, [(1, 200, 800, MIXED), (2, 150, 600, MIXED), (3, 150, 600, MIXED)]),
    (3106, 3, [(1, 3000, 9000, EQUAL_HEAVY), (3, 1000, 3000, EQUAL_HEAVY)]),
    (3107, 4, [(2, 4000, 10000, EQUAL_HEAVY), (1, 2000, 6000, MIXED)]),
    (3108, 3, [(3, 8000, 16000, EQUAL_HEAVY), (2, 3000, 6000, EQUAL_HEAVY)]),
    (3109, 5, [(1, 12000, 18000, EQUAL_HEAVY), (3, 5000, 8000, EQUAL_HEAVY)]),
    (3110, 3, [(1, 20000, 26000, EQUAL_HEAVY), (2, 10000, 14000, EQUAL_HEAVY),
               (3, 2000, 4000, MIXED)]),
]


def token(rng: random.Random, component_type: str, pool: int) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    index = rng.randrange(pool)
    if component_type == "int":
        return str(index * 7919 - 1_000_000_000 + pool)
    if component_type == "llong":
        return str(index * 104_729 - 4_000_000_000 + pool)
    # A stable name per index, so equal indices really give equal strings.
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def pair_tokens(rng: random.Random, kind: int, pool: int) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, pool) + " " + token(rng, second_type, pool)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, pool: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair03_gte blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op in (1, 3):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
        elif op in (2, 4):
            lines.append("%d %d %s" % (op, i, pair_tokens(rng, kind, pool)))
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
