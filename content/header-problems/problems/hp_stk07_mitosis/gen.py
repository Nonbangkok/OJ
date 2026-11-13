#!/usr/bin/env python3
"""Testcase generator for hp_stk07_mitosis.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-3 are the 30% subtask
(n <= 10, and the ones that hit k = 0, k = size and k > size on a tiny
stack), cases 4-10 the remaining 70%.

The generator simulates the stack's SIZE (not its contents) for three
reasons: mitosis GROWS the stack, so the simulation keeps it under the
60,000 the statement promises; the k values have to straddle the current
height on purpose; and a mitosis is emitted on purpose while the size is an
exact power of two, which is where mSize == mCap and the array has to be
reallocated in the middle of the operation.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size
                     | "5 k" mitosis(k) and print the new size
                     | "6" copy check | "7" fold top
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7.
#   1 push, 2 pop, 3 top, 4 size, 5 mitosis(k), 6 copy check, 7 fold top
MIXED = {1: 16, 2: 24, 3: 12, 4: 4, 5: 28, 6: 8, 7: 8}
# Tiny stacks, where k = 0, k = size and k > size are a handful of values
# and the stack keeps running dry.
EDGY = {1: 24, 2: 26, 3: 16, 4: 6, 5: 22, 6: 6, 7: 0}
# The big cases are mitosis-dominated. Pops have to outnumber the growth, so
# the stack hovers near its ceiling instead of exploding.
SPLIT_HEAVY = {1: 10, 2: 44, 3: 1, 4: 1, 5: 32, 6: 0, 7: 12}

COPY_CHECK_MAX_N = 300
# The statement's ceiling. The simulation clamps k so the stack never grows
# past it, which keeps both the memory and the reference's copying bounded.
# Small blocks get a much lower ceiling of their own: they are the ones that
# still run the expensive copy check, which copies the WHOLE stack, so a
# 300-element block that grew to 60,000 would cost more than the big cases.
SIZE_CEILING = 60_000
# How many full-height duplications a big block may spend (each one is
# Theta(size)).
FULL_QUOTA_LARGE = 60
LARGE_FROM = 2000

PLAN = [
    (1701, [(1, 3, 18, EDGY), (2, 2, 14, EDGY)]),
    (1702, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 24, MIXED)]),
    (1703, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (1704, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED)]),
    (1705, [(1, 2000, 6000, MIXED), (3, 1500, 4000, MIXED)]),
    (1706, [(1, 12000, 50000, SPLIT_HEAVY), (2, 300, 900, EDGY)]),
    (1707, [(2, 12000, 50000, SPLIT_HEAVY), (1, 400, 1200, EDGY)]),
    (1708, [(3, 18000, 70000, SPLIT_HEAVY), (1, 400, 1200, EDGY)]),
    (1709, [(1, 24000, 80000, SPLIT_HEAVY), (3, 500, 1500, EDGY)]),
    (1710, [(1, 30000, 90000, SPLIT_HEAVY), (2, 600, 1800, EDGY)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One stack element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def is_power_of_two(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]
    large = n >= LARGE_FROM
    full_quota = FULL_QUOTA_LARGE if large else count
    ceiling = SIZE_CEILING if large else max(64, 4 * n + 32)

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n

    def clone_size() -> int:
        """A k for mitosis, kept inside the statement's size ceiling."""
        nonlocal full_quota
        room = max(ceiling - size, 0)
        roll = rng.random()
        if roll < 0.08:
            return 0
        if roll < 0.16:
            return 1
        if roll < 0.30 and full_quota > 0 and size <= room:
            full_quota -= 1
            # k = size and k > size both mean "duplicate everything".
            return rng.choice([size, size + 1, 4_000_000_000])
        return rng.randint(1, max(1, min(16 if large else size + 2, room)))

    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        # A mitosis exactly when mSize == mCap (size a power of two after a
        # run of pushes) is the reallocation case; spend one on purpose.
        if op != 5 and is_power_of_two(size) and size >= 4 and rng.random() < 0.25:
            op = 5

        if op == 1:
            lines.append("1 " + element(rng, kind))
            size += 1
        elif op == 2:
            lines.append("2")
            size = max(size - 1, 0)
        elif op == 5:
            k = clone_size()
            lines.append("5 %d" % k)
            size += min(k, size)
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
