#!/usr/bin/env python3
"""Testcase generator for hp_stk04_pop_many.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-3 are the 30% subtask
(n <= 10), cases 4-10 the remaining 70%.

The generator simulates the stack's SIZE (not its contents) so that the
`pop k` commands it writes hit the interesting values on purpose: k = 0,
k = 1, k = size - 1, k = size, k = size + 1 and k in the billions (the
values where `mSize -= k` wraps around).

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop() | "3" top | "4" size
                     | "5 k" pop(k) and print the new size | "6" copy check
                     | "7" fold top into the hash
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7.
#   1 push, 2 pop(), 3 top, 4 size, 5 pop(k), 6 copy check, 7 fold top
MIXED = {1: 40, 2: 8, 3: 14, 4: 6, 5: 20, 6: 6, 7: 6}
# Small stacks that keep running dry: k = size and k > size all the time.
EDGY = {1: 34, 2: 14, 3: 16, 4: 8, 5: 24, 6: 4, 7: 0}
# The big cases push hard and take small bites out of the top, so the stack
# stays tall while pop(k) is called tens of thousands of times.
BULK = {1: 62, 2: 6, 3: 2, 4: 1, 5: 17, 6: 0, 7: 12}

COPY_CHECK_MAX_N = 300

PLAN = [
    (1401, [(1, 5, 18, EDGY), (2, 3, 12, EDGY)]),
    (1402, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 24, MIXED)]),
    (1403, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (1404, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED)]),
    (1405, [(1, 2000, 6000, MIXED), (3, 1500, 4000, MIXED)]),
    (1406, [(1, 10000, 60000, BULK), (2, 300, 900, EDGY)]),
    (1407, [(2, 10000, 60000, BULK), (1, 400, 1200, EDGY)]),
    (1408, [(3, 20000, 90000, BULK), (1, 400, 1200, EDGY)]),
    (1409, [(1, 30000, 110000, BULK), (3, 500, 1500, EDGY)]),
    (1410, [(1, 40000, 120000, BULK), (2, 600, 1800, EDGY)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One stack element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def bite(rng: random.Random, size: int, bulk: bool) -> int:
    """A k for pop(k). The edge values are deliberately over-represented."""
    roll = rng.random()
    if roll < 0.06:
        return 0
    if roll < 0.12:
        return 1
    if roll < 0.18:
        return size
    if roll < 0.24:
        return size + 1
    if roll < 0.30:
        return rng.randint(1_000_000_000, 4_000_000_000)
    if bulk:
        # Small bites keep the stack tall, so the big cases really do run
        # pop(k) against a 10^4-element stack over and over.
        return rng.randint(1, 12)
    return rng.randint(0, size + 2)


def block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]
    bulk = mix is BULK

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            lines.append("1 " + element(rng, kind))
            size += 1
        elif op == 2:
            lines.append("2")
            size = max(size - 1, 0)
        elif op == 5:
            k = bite(rng, size, bulk)
            lines.append("5 %d" % k)
            size = 0 if k >= size else size - k
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
