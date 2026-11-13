#!/usr/bin/env python3
"""Testcase generator for hp_pair01_equal.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks:

    cases 1-3  (30%)  pair<int,int> only, tiny
    cases 4-6  (30%)  pair<std::string,int> appears as well
    cases 7-10 (40%)  large, and deliberately full of near-misses: pairs that
                      share `first` but differ in `second` (and the other way
                      round), which is what an == that only looks at one
                      component gets wrong

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<std::string,int>
    n lines: a b
    q command lines: "1 i j" | "2 i a b" | "3 i j" | "4 i" | "5 i a b" | "6 i"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: cmp, set, assign, copy, temp, zero.
MIXED = {1: 40, 2: 18, 3: 12, 4: 10, 5: 14, 6: 6}
# Near-miss heavy: mostly cmp and temp, because those are the commands that
# compare two values that agree in one component and not the other.
NEAR_MISS = {1: 52, 2: 10, 3: 8, 4: 6, 5: 20, 6: 4}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
#
# `pool` is how many distinct component values the case draws from: a small
# pool makes genuine equalities and near-misses common, a large one makes
# almost everything unequal. Cases 7-10 use a tiny pool on purpose.
PLAN = [
    (1101, 1000, [(1, 3, 10, MIXED)]),
    (1102, 1000, [(1, 6, 24, MIXED), (1, 2, 12, MIXED)]),
    (1103, 4, [(1, 1, 14, MIXED), (1, 12, 40, NEAR_MISS)]),
    (1104, 1000, [(1, 8, 30, MIXED), (2, 6, 24, MIXED)]),
    (1105, 6, [(2, 20, 80, NEAR_MISS), (1, 20, 80, NEAR_MISS)]),
    (1106, 50, [(1, 300, 1200, MIXED), (2, 200, 900, MIXED)]),
    (1107, 3, [(1, 5000, 15000, NEAR_MISS), (2, 1500, 5000, NEAR_MISS)]),
    (1108, 3, [(2, 8000, 20000, NEAR_MISS), (1, 3000, 8000, MIXED)]),
    (1109, 2, [(1, 12000, 25000, NEAR_MISS), (2, 6000, 12000, NEAR_MISS)]),
    (1110, 2, [(1, 20000, 30000, NEAR_MISS), (2, 20000, 30000, NEAR_MISS),
               (1, 1000, 4000, MIXED)]),
]


def first_value(rng: random.Random, kind: int, pool: int) -> str:
    """A `first` component, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randrange(pool) - pool // 2)
    index = rng.randrange(pool)
    # A short, stable name per index so the same index always gives the same
    # string: that is what makes equal pairs actually equal.
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def second_value(rng: random.Random, pool: int) -> str:
    """A `second` component; always int in this problem's two block kinds."""
    return str(rng.randrange(pool) - pool // 2)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, pool: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(first_value(rng, kind, pool) + " " + second_value(rng, pool))

    # Every command carries an index, so a block must hold at least one pair.
    assert n > 0, "hp_pair01_equal blocks are never empty"

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op in (1, 3):
            j = rng.randrange(n)
            lines.append("%d %d %d" % (op, i, j))
        elif op in (2, 5):
            lines.append("%d %d %s %s" % (op, i, first_value(rng, kind, pool),
                                          second_value(rng, pool)))
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
