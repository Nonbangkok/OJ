#!/usr/bin/env python3
"""Testcase generator for hp_pair10_ordering.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-2   (20%)  pair<int,int> only, tiny
    cases 3-5   (30%)  pair<string,int> and pair<long long,long long> too
    cases 6-10  (50%)  large, with both components drawn from a tiny pool.
                       That makes EQUAL pairs and ties on `first` the common
                       case, which is exactly where six separately written
                       operators stop agreeing with each other

The `laws` command is quadratic in its window, so the window stays short and
the per-block closing sweep (linear, plus one stable merge sort) is what
covers the whole array.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<string,int>,
                          3 = pair<long long,long long>
    n lines: a b
    q command lines: "1 i j" | "2 l len" | "3 i j k" | "4 i a b" | "5 i"
                     | "6 i" | "7 i j"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7: six, laws, clamp, assign, self, zero, sign.
MIXED = {1: 26, 2: 12, 3: 16, 4: 12, 5: 10, 6: 8, 7: 16}
# Equality-heavy traffic: `six`, `self` and `sign` are the commands whose
# digits move when the operators disagree on an equal pair.
EQUAL_HEAVY = {1: 32, 2: 10, 3: 12, 4: 8, 5: 14, 6: 4, 7: 20}

# A `laws` command costs len^2 comparisons and prints one line, so the window
# is short — and shorter still on the big blocks, where the closing sweep and
# the merge sort already cover the array.
LAWS_WINDOW_MAX = 24
LAWS_WINDOW_MAX_LARGE = 8
LARGE_BLOCK_N = 2000

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "int"), 2: ("str", "int"), 3: ("llong", "llong")}

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
#
# `pool` is how many distinct values EACH component is drawn from, so two
# random pairs are exactly equal with probability about 1/pool^2.
PLAN = [
    (10101, 1000, [(1, 3, 12, MIXED)]),
    (10102, 3, [(1, 10, 40, EQUAL_HEAVY), (1, 1, 8, MIXED)]),
    (10103, 1000, [(2, 8, 32, MIXED), (1, 6, 24, MIXED)]),
    (10104, 4, [(2, 16, 64, EQUAL_HEAVY), (3, 16, 64, EQUAL_HEAVY)]),
    (10105, 40, [(1, 200, 800, MIXED), (2, 150, 600, MIXED), (3, 150, 600, MIXED)]),
    (10106, 3, [(1, 2000, 5000, EQUAL_HEAVY), (3, 1000, 2500, EQUAL_HEAVY)]),
    (10107, 4, [(2, 4000, 7000, EQUAL_HEAVY), (1, 2000, 4000, MIXED)]),
    (10108, 3, [(3, 8000, 10000, EQUAL_HEAVY), (2, 3000, 4000, EQUAL_HEAVY)]),
    (10109, 5, [(1, 12000, 13000, EQUAL_HEAVY), (3, 5000, 5000, EQUAL_HEAVY)]),
    (10110, 3, [(1, 20000, 17000, EQUAL_HEAVY), (2, 8000, 8000, EQUAL_HEAVY),
                (3, 2000, 3000, MIXED)]),
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

    assert n > 0, "hp_pair10_ordering blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 2:
            window_max = LAWS_WINDOW_MAX if n <= LARGE_BLOCK_N else LAWS_WINDOW_MAX_LARGE
            lines.append("2 %d %d" % (rng.randrange(n), rng.randint(1, window_max)))
            continue
        i = rng.randrange(n)
        if op in (1, 7):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
        elif op == 3:
            lines.append("3 %d %d %d" % (i, rng.randrange(n), rng.randrange(n)))
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
