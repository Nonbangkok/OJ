#!/usr/bin/env python3
"""Testcase generator for hp_stk06_deep_push.

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

The generator simulates the stack's SIZE (not its contents) for two reasons:
the k values have to straddle the current height on purpose, and the sum of
the shifted elements has to stay inside the budget the statement promises
(2 * 10^7), since the intended solution is O(k) per call. Every block
therefore spends its "deep" k values out of a fixed quota.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size
                     | "5 k x" deep_push(k, x) | "6" copy check
                     | "7" fold top | "8 k" deep_push(k, top())
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..8.
#   1 push, 2 pop, 3 top, 4 size, 5 deep_push(k, x), 6 copy check,
#   7 fold top, 8 deep_push(k, top())
MIXED = {1: 18, 2: 14, 3: 12, 4: 4, 5: 30, 6: 8, 7: 6, 8: 8}
# Tiny stacks: k = 0, k = size and k > size are all the same handful of
# values here, which is exactly the boundary this mix is for.
EDGY = {1: 24, 2: 24, 3: 16, 4: 6, 5: 20, 6: 4, 7: 0, 8: 6}
# The big cases are deep_push-dominated, with shallow k so the O(k) bound is
# what keeps them fast, plus a quota of full-height inserts.
PUSH_HEAVY = {1: 20, 2: 14, 3: 1, 4: 1, 5: 42, 6: 0, 7: 12, 8: 10}

COPY_CHECK_MAX_N = 300
# How many Theta(size) inserts (k = size, k > size, or a four-digit k) a big
# block may spend. 200 of them on a 30,000-element stack is 6 * 10^6
# element moves, well inside the statement's 2 * 10^7 budget.
DEEP_QUOTA_LARGE = 200
DEEP_LARGE_FROM = 2000

PLAN = [
    (1601, [(1, 4, 18, EDGY), (2, 3, 14, EDGY)]),
    (1602, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 24, MIXED)]),
    (1603, [(1, 0, 40, EDGY), (1, 1, 30, EDGY), (2, 2, 40, EDGY)]),
    (1604, [(1, 300, 1200, MIXED), (2, 200, 800, MIXED)]),
    (1605, [(1, 2000, 6000, MIXED), (3, 1500, 4000, MIXED)]),
    (1606, [(1, 12000, 50000, PUSH_HEAVY), (2, 300, 900, EDGY)]),
    (1607, [(2, 12000, 50000, PUSH_HEAVY), (1, 400, 1200, EDGY)]),
    (1608, [(3, 18000, 70000, PUSH_HEAVY), (1, 400, 1200, EDGY)]),
    (1609, [(1, 24000, 80000, PUSH_HEAVY), (3, 500, 1500, EDGY)]),
    (1610, [(1, 30000, 90000, PUSH_HEAVY), (2, 600, 1800, EDGY)]),
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
    large = n >= DEEP_LARGE_FROM
    deep_quota = DEEP_QUOTA_LARGE if large else count

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n

    def depth() -> int:
        """A k for deep_push. Shallow by default; the expensive values
        (the bottom, past the bottom) come out of the block's quota."""
        nonlocal deep_quota
        roll = rng.random()
        if roll < 0.12:
            return 0
        if roll < 0.20:
            return 1
        if roll < 0.40 or not large:
            if deep_quota > 0 and rng.random() < 0.25:
                deep_quota -= 1
                return rng.choice([size, size + 1, rng.randint(0, size + 2)])
            return rng.randint(0, min(size, 32))
        if roll < 0.46 and deep_quota > 0:
            deep_quota -= 1
            return rng.choice([size, size + 1, 4_000_000_000])
        return rng.randint(0, min(size, 48))

    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            lines.append("1 " + element(rng, kind))
            size += 1
        elif op == 2:
            lines.append("2")
            size = max(size - 1, 0)
        elif op == 5:
            lines.append("5 %d %s" % (depth(), element(rng, kind)))
            size += 1
        elif op == 8:
            lines.append("8 %d" % depth())
            if size > 0:
                size += 1
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
