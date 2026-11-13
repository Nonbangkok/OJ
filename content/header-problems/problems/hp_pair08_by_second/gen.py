#!/usr/bin/env python3
"""Testcase generator for hp_pair08_by_second.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-2   (20%)  pair<string,int> only, tiny
    cases 3-5   (30%)  pair<int,long long> and pair<string,string> too
    cases 6-10  (50%)  large, and `second` is drawn from a tiny pool so most
                       comparisons are ties on the primary key and the sorted
                       permutation is decided by the `first` tie-break — plus
                       a share of fully duplicated pairs, where the comparator
                       must answer false in both directions or the stable
                       merge sort lands somewhere else

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<string,int>, 2 = pair<int,long long>,
                          3 = pair<string,string>
    n lines: a b
    q command lines: "1 i j" | "2 i a b" | "3 l len" | "4 i j" | "5 i"
                     | "6 i j"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: cmp, assign, sort, gt, zero, viacopy.
MIXED = {1: 30, 2: 14, 3: 16, 4: 18, 5: 8, 6: 14}
# Tie-heavy traffic: comparisons and window sorts, the two places where the
# `first` tie-break and the strictness on equal pairs are both visible.
TIE_HEAVY = {1: 34, 2: 10, 3: 24, 4: 14, 5: 4, 6: 14}

# A window sort prints its whole window, so the window stays short: the
# closing full-array sort is what covers scale. On the big blocks the window
# shrinks further, because 32 elements per command would blow the per-problem
# testcase budget without testing anything the full sort does not.
SORT_WINDOW_MAX = 32
SORT_WINDOW_MAX_LARGE = 6
LARGE_BLOCK_N = 2000

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("str", "int"), 2: ("int", "llong"), 3: ("str", "str")}

# Case plan: (seed, first_pool, second_pool, duplicate_share,
#             [(kind, n, q, mix), ...]).
#
# `second_pool` is the number of distinct PRIMARY keys: small means ties.
# `duplicate_share` is the fraction of pairs re-emitted identically to the
# previous one, which creates pairs that are equal in both components.
PLAN = [
    (8101, 1000, 1000, 0.10, [(1, 3, 12, MIXED)]),
    (8102, 1000, 3, 0.25, [(1, 10, 40, TIE_HEAVY), (1, 1, 8, MIXED)]),
    (8103, 1000, 1000, 0.10, [(2, 8, 32, MIXED), (1, 6, 24, MIXED)]),
    (8104, 6, 3, 0.30, [(3, 16, 64, TIE_HEAVY), (2, 16, 64, TIE_HEAVY)]),
    (8105, 50, 40, 0.15, [(1, 200, 800, MIXED), (2, 150, 600, MIXED),
                          (3, 150, 600, MIXED)]),
    (8106, 1000, 2, 0.25, [(1, 2000, 5000, TIE_HEAVY), (2, 1000, 2500, TIE_HEAVY)]),
    (8107, 1000, 3, 0.25, [(3, 4000, 7000, TIE_HEAVY), (1, 2000, 4000, MIXED)]),
    (8108, 1000, 2, 0.30, [(2, 8000, 10000, TIE_HEAVY), (3, 3000, 4000, TIE_HEAVY)]),
    (8109, 1000, 2, 0.30, [(1, 12000, 13000, TIE_HEAVY), (2, 5000, 5000, TIE_HEAVY)]),
    (8110, 1000, 2, 0.35, [(1, 20000, 17000, TIE_HEAVY), (3, 7000, 7000, TIE_HEAVY),
                           (2, 2000, 3000, MIXED)]),
]


def token(rng: random.Random, component_type: str, pool: int) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    index = rng.randrange(pool)
    if component_type == "int":
        return str(index * 7919 - 1_000_000_000 + pool)
    if component_type == "llong":
        return str(index * 104_729 - 4_000_000_000 + pool)
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def pair_tokens(rng: random.Random, kind: int, first_pool: int, second_pool: int) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, first_pool) + " " + token(rng, second_type, second_pool)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict,
          first_pool: int, second_pool: int, duplicate_share: float) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair08_by_second blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    previous = pair_tokens(rng, kind, first_pool, second_pool)
    lines.append(previous)
    for _ in range(n - 1):
        if rng.random() < duplicate_share:
            lines.append(previous)
        else:
            previous = pair_tokens(rng, kind, first_pool, second_pool)
            lines.append(previous)

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 3:
            left = rng.randrange(n)
            window_max = SORT_WINDOW_MAX if n <= LARGE_BLOCK_N else SORT_WINDOW_MAX_LARGE
            length = rng.randint(1, window_max)
            lines.append("3 %d %d" % (left, length))
            continue
        i = rng.randrange(n)
        if op in (1, 4, 6):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
        elif op == 2:
            lines.append("2 %d %s" % (i, pair_tokens(rng, kind, first_pool, second_pool)))
        else:
            lines.append("%d %d" % (op, i))
    return lines


def build_case(index: int) -> str:
    seed, first_pool, second_pool, duplicate_share, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix in blocks:
        lines.extend(block(rng, kind, n, commands, mix, first_pool, second_pool, duplicate_share))
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
