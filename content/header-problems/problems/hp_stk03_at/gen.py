#!/usr/bin/env python3
"""Testcase generator for hp_stk03_at.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-3 are the 30% subtask
(n <= 10), cases 4-10 the remaining 70%.

The generator simulates the stack's SIZE (not its contents) so that every
`at(k)` command it writes has k < size, and so that the expensive
"read the whole stack through at()" command stays within a per-block budget.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4 k" print at(k)
                     | "5" size | "6" copy check | "7 k" fold at(k)
                     | "8" fold the whole stack through at()
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..8.
#   1 push, 2 pop, 3 top, 4 print at(k), 5 size, 6 copy check,
#   7 fold at(k), 8 fold the whole stack through at()
MIXED = {1: 24, 2: 16, 3: 8, 4: 22, 5: 4, 6: 8, 7: 12, 8: 6}
# Pop-heavy, so the stack keeps shrinking and the same k lands on a
# different element every time.
EDGY = {1: 24, 2: 32, 3: 8, 4: 24, 5: 4, 6: 4, 7: 4, 8: 0}
# The big cases query through the hash: "7 k" produces no output at all,
# which is the cheapest way to ask for at() hundreds of thousands of times.
QUERY_HEAVY = {1: 20, 2: 14, 3: 1, 4: 3, 5: 1, 6: 0, 7: 60, 8: 1}

COPY_CHECK_MAX_N = 300
# "8" costs Theta(size); on a 50,000-element stack a handful of them is
# plenty to prove at() is right all the way down to the bottom.
SWEEP_BUDGET_LARGE = 12
SWEEP_LARGE_FROM = 2000

PLAN = [
    (1301, [(1, 4, 16, MIXED), (2, 3, 12, MIXED)]),
    (1302, [(1, 10, 60, MIXED), (2, 6, 30, MIXED), (3, 5, 24, MIXED)]),
    (1303, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (1304, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED)]),
    (1305, [(1, 2000, 6000, MIXED), (3, 1500, 4000, MIXED)]),
    (1306, [(1, 20000, 60000, QUERY_HEAVY), (2, 300, 900, EDGY)]),
    (1307, [(2, 20000, 60000, QUERY_HEAVY), (1, 400, 1200, EDGY)]),
    (1308, [(3, 30000, 90000, QUERY_HEAVY), (1, 400, 1200, EDGY)]),
    (1309, [(1, 40000, 110000, QUERY_HEAVY), (3, 500, 1500, EDGY)]),
    (1310, [(1, 50000, 120000, QUERY_HEAVY), (2, 600, 1800, EDGY)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One stack element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def depth(rng: random.Random, size: int) -> int:
    """A k for at(k): the two ends on purpose, the rest uniform."""
    roll = rng.random()
    if roll < 0.30:
        return 0
    if roll < 0.50:
        return size - 1
    return rng.randrange(size)


def block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]
    sweeps_left = SWEEP_BUDGET_LARGE if n >= SWEEP_LARGE_FROM else count

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op in (4, 7) and size == 0:
            op = 1
        if op == 8:
            if sweeps_left == 0:
                op = 5
            else:
                sweeps_left -= 1

        if op == 1:
            lines.append("1 " + element(rng, kind))
            size += 1
        elif op == 2:
            lines.append("2")
            size = max(size - 1, 0)
        elif op in (4, 7):
            lines.append("%d %d" % (op, depth(rng, size)))
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
