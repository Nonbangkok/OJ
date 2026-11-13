#!/usr/bin/env python3
"""Testcase generator for hp_pair07_normalize.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-2   (20%)  pair<int,int> only, tiny
    cases 3-5   (30%)  pair<string,string> and pair<long long,long long> too
    cases 6-10  (50%)  large, and the inputs are deliberately biased towards
                       pairs that are ALREADY sorted or whose components are
                       EQUAL. Those are the pairs an unconditional swap gets
                       wrong, and `norm` prints the pair after a first and a
                       second call, so the mistake is visible on one line

Both components are drawn from the same value set so that T1 == T2 ordering is
meaningful; a share of the pairs is emitted pre-sorted and another share with
both components identical.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<string,string>,
                          3 = pair<long long,long long>
    n lines: a b
    q command lines: "1 i" | "2 i" | "3 i" | "4 i a b" | "5 i j" | "6 i"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: norm, twice, ask, assign, from, copy.
MIXED = {1: 28, 2: 18, 3: 14, 4: 16, 5: 12, 6: 12}
# Idempotence-heavy: `norm` (two calls, printed twice) and `twice` dominate.
REPEATED = {1: 40, 2: 26, 3: 8, 4: 10, 5: 8, 6: 8}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> component type (T1 == T2 for every kind, as normalize() requires)
KIND_TYPES = {1: "int", 2: "str", 3: "llong"}

# Case plan: (seed, pool, equal_share, sorted_share, [(kind, n, q, mix), ...]).
#
# equal_share  — fraction of generated pairs whose components are identical
# sorted_share — fraction of the remaining pairs emitted already in order
PLAN = [
    (7101, 1000, 0.20, 0.40, [(1, 3, 12, MIXED)]),
    (7102, 6, 0.35, 0.50, [(1, 8, 32, REPEATED), (1, 1, 8, MIXED)]),
    (7103, 1000, 0.20, 0.40, [(1, 10, 40, MIXED), (2, 8, 30, MIXED)]),
    (7104, 8, 0.40, 0.50, [(2, 16, 64, REPEATED), (3, 16, 64, REPEATED)]),
    (7105, 60, 0.30, 0.50, [(1, 200, 800, MIXED), (2, 150, 600, MIXED),
                            (3, 150, 600, MIXED)]),
    (7106, 1000, 0.40, 0.60, [(1, 2000, 5000, REPEATED), (3, 1000, 2500, REPEATED)]),
    (7107, 1000, 0.45, 0.60, [(2, 4000, 7000, REPEATED), (1, 2000, 4000, MIXED)]),
    (7108, 10, 0.50, 0.70, [(3, 8000, 10000, REPEATED), (2, 3000, 4000, REPEATED)]),
    (7109, 1000, 0.50, 0.70, [(1, 12000, 13000, REPEATED), (3, 5000, 5000, REPEATED)]),
    (7110, 1000, 0.55, 0.75, [(1, 20000, 17000, REPEATED), (2, 7000, 7000, REPEATED),
                              (3, 2000, 3000, MIXED)]),
]


def value(rng: random.Random, component_type: str, pool: int) -> tuple:
    """One component, as (sort key, text written the way std::cin reads it)."""
    index = rng.randrange(pool)
    if component_type == "int":
        number = index * 7919 - 1_000_000_000 + pool
        return (number, str(number))
    if component_type == "llong":
        number = index * 104_729 - 4_000_000_000 + pool
        return (number, str(number))
    text = "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))
    return (text, text)


def pair_tokens(rng: random.Random, kind: int, pool: int,
                equal_share: float, sorted_share: float) -> str:
    component_type = KIND_TYPES[kind]
    left = value(rng, component_type, pool)
    if rng.random() < equal_share:
        return left[1] + " " + left[1]
    right = value(rng, component_type, pool)
    if rng.random() < sorted_share and right[0] < left[0]:
        left, right = right, left
    return left[1] + " " + right[1]


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, pool: int,
          equal_share: float, sorted_share: float) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair07_normalize blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool, equal_share, sorted_share))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op == 4:
            lines.append("4 %d %s" % (i, pair_tokens(rng, kind, pool, equal_share, sorted_share)))
        elif op == 5:
            lines.append("5 %d %d" % (i, rng.randrange(n)))
        else:
            lines.append("%d %d" % (op, i))
    return lines


def build_case(index: int) -> str:
    seed, pool, equal_share, sorted_share, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix in blocks:
        lines.extend(block(rng, kind, n, commands, mix, pool, equal_share, sorted_share))
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
