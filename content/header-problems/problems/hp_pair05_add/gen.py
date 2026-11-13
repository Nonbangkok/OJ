#!/usr/bin/env python3
"""Testcase generator for hp_pair05_add.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-2   (20%)  pair<long long,long long> only, tiny — pure arithmetic
    cases 3-6   (40%)  pair<int,std::string> appears, so the second component
                       is a concatenation and the operand order starts to matter
    cases 7-10  (40%)  large, and pair<std::string,std::string> makes BOTH
                       components non-commutative

Component values stay well inside the statement's bounds and the grader never
stores a sum, so no sum can overflow a long long (the judge compiles with
-fsanitize=signed-integer-overflow, which aborts on overflow).

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<long long,long long>,
                          2 = pair<int,string>, 3 = pair<string,string>
    n lines: a b
    q command lines: "1 i j" | "2 i" | "3 i j" | "4 i a b" | "5 i" | "6 i j"
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..6: add, dbl, twice, assign, zero, chain.
MIXED = {1: 30, 2: 14, 3: 16, 4: 16, 5: 10, 6: 14}
# Order-sensitive traffic: `chain` and `twice` put the same two operands on
# both sides of a +, so a swapped operand order is impossible to hide.
ORDERED = {1: 20, 2: 10, 3: 24, 4: 10, 5: 8, 6: 28}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("llong", "llong"), 2: ("int", "str"), 3: ("str", "str")}

# Case plan: (seed, pool, [(kind, n, q, mix), ...]).
PLAN = [
    (5101, 1000, [(1, 3, 12, MIXED)]),
    (5102, 1000, [(1, 8, 30, MIXED), (1, 1, 8, ORDERED)]),
    (5103, 1000, [(2, 6, 24, MIXED), (1, 4, 16, MIXED)]),
    (5104, 8, [(2, 16, 64, ORDERED)]),
    (5105, 60, [(2, 200, 800, MIXED), (1, 150, 600, MIXED)]),
    (5106, 1000, [(1, 2000, 6000, MIXED), (2, 1500, 4000, ORDERED)]),
    (5107, 1000, [(3, 4000, 9000, ORDERED), (2, 2000, 5000, MIXED)]),
    (5108, 12, [(3, 8000, 14000, ORDERED), (1, 3000, 6000, MIXED)]),
    (5109, 1000, [(3, 12000, 18000, ORDERED), (2, 5000, 8000, ORDERED)]),
    (5110, 1000, [(3, 20000, 26000, ORDERED), (1, 9000, 12000, MIXED),
                  (2, 2000, 4000, MIXED)]),
]


def token(rng: random.Random, component_type: str, pool: int) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    index = rng.randrange(pool)
    if component_type == "int":
        # |value| <= 10^8, so four of them still fit comfortably in an int.
        return str(index * 97_777 - 50_000_000)
    if component_type == "llong":
        # |value| <= 10^12, so four of them still fit in a long long.
        return str(index * 999_999_937 - 500_000_000_000)
    return "".join(ALPHABET[(index * 7 + step * 11) % 26] for step in range(1 + index % 6))


def pair_tokens(rng: random.Random, kind: int, pool: int) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, pool) + " " + token(rng, second_type, pool)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, pool: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair05_add blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, pool))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        i = rng.randrange(n)
        if op in (1, 3, 6):
            lines.append("%d %d %d" % (op, i, rng.randrange(n)))
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
