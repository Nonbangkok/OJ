#!/usr/bin/env python3
"""Testcase generator for hp_stk09_reverse.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-5 are the 50% subtask
(n <= 2,000, q <= 6,000, where physically reversing the array on every call
still fits in the time limit), cases 6-10 the remaining 50%, where it does
not.

Two different jobs, two different shapes:

  * the SMALL cases are about correctness. They alternate reverse with push
    and pop so the stack is grown and shortened from BOTH ends many times
    over, which is where a window offset that is not maintained properly
    falls apart, and they run the stack down to empty and back up.
  * the LARGE cases are about the time bound: they are reverse-dominated. A
    reverse is two bytes of input and produces no output at all, while
    costing an O(n) solution n/2 element moves, so this is the cheapest
    possible way in archive bytes to separate O(1) from O(n). Pushes stay
    frequent enough that a solution which only works while the stack is left
    alone between reverses cannot survive.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size
                     | "5" reverse | "6" copy check | "7" fold top
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7.
#   1 push, 2 pop, 3 top, 4 size, 5 reverse, 6 copy check, 7 fold top
MIXED = {1: 22, 2: 16, 3: 14, 4: 4, 5: 26, 6: 8, 7: 10}
# Pop-heavy, so the stack repeatedly empties and refills while the direction
# keeps flipping.
EDGY = {1: 24, 2: 30, 3: 16, 4: 4, 5: 22, 6: 4, 7: 0}
# The big cases: reverse as often as the file can afford, with enough pushes
# and pops that both ends of the window are worked.
REVERSE_HEAVY = {1: 8, 2: 6, 3: 1, 4: 1, 5: 78, 6: 0, 7: 6}
REVERSE_DENSE = {1: 6, 2: 5, 3: 1, 4: 1, 5: 84, 6: 0, 7: 3}

COPY_CHECK_MAX_N = 300

PLAN = [
    (1901, [(1, 4, 20, MIXED), (2, 3, 14, MIXED)]),
    (1902, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 30, MIXED)]),
    (1903, [(1, 0, 60, EDGY), (1, 1, 40, EDGY), (2, 2, 40, EDGY)]),
    (1904, [(1, 300, 1500, MIXED), (2, 200, 900, EDGY)]),
    (1905, [(1, 2000, 6000, MIXED), (3, 1200, 3000, MIXED), (2, 300, 900, EDGY)]),
    (1906, [(1, 24000, 130000, REVERSE_HEAVY), (2, 300, 900, EDGY)]),
    (1907, [(2, 24000, 130000, REVERSE_HEAVY), (1, 400, 1200, EDGY)]),
    (1908, [(3, 28000, 135000, REVERSE_HEAVY), (1, 400, 1200, EDGY)]),
    (1909, [(1, 32000, 140000, REVERSE_HEAVY), (3, 500, 1500, EDGY)]),
    (1910, [(1, 36000, 140000, REVERSE_DENSE), (2, 600, 1800, EDGY)]),
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
