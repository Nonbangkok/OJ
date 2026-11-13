#!/usr/bin/env python3
"""Testcase generator for hp_pair04_swapped.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-3   (30%)  pair<int,std::string> only, tiny
    cases 4-6   (30%)  pair<std::string,long long> and pair<int,int> too
    cases 7-10  (40%)  large, and dominated by the nesting commands (round
                       trip, become, swap-a-copy-of-a-swap), which are the
                       ones that instantiate swapped() on the mirrored type

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,string>, 2 = pair<string,long long>,
                          3 = pair<int,int>
    n lines: a b
    q command lines: "1 i" | "2 i" | "3 i j" | "4 i a b" | "5 i" | "6 i"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: swap, trip, become, assign, twice, raw.
MIXED = {1: 28, 2: 18, 3: 16, 4: 18, 5: 12, 6: 8}
# Nesting-heavy: the commands that go through swapped() more than once.
NESTED = {1: 14, 2: 26, 3: 24, 4: 10, 5: 20, 6: 6}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "str"), 2: ("str", "llong"), 3: ("int", "int")}

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
PLAN = [
    (4101, 1000, [(1, 3, 10, MIXED)]),
    (4102, 1000, [(1, 6, 24, MIXED), (1, 1, 8, NESTED)]),
    (4103, 5, [(1, 12, 48, NESTED)]),
    (4104, 1000, [(1, 10, 40, MIXED), (2, 8, 32, MIXED)]),
    (4105, 6, [(2, 20, 80, NESTED), (3, 20, 80, NESTED)]),
    (4106, 80, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED), (3, 200, 800, MIXED)]),
    (4107, 1000, [(1, 4000, 10000, NESTED), (3, 2000, 5000, NESTED)]),
    (4108, 1000, [(2, 8000, 16000, NESTED), (1, 3000, 6000, MIXED)]),
    (4109, 1000, [(3, 12000, 18000, NESTED), (2, 5000, 8000, NESTED)]),
    (4110, 1000, [(1, 20000, 26000, NESTED), (2, 9000, 12000, NESTED),
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

    assert n > 0, "hp_pair04_swapped blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op == 3:
            lines.append("3 %d %d" % (i, rng.randrange(n)))
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
