#!/usr/bin/env python3
"""Testcase generator for hp_vec06_erase_many.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

The subtask boundary is a COMPLEXITY boundary:

  * cases 1-5 (50%) are random command mixes with n <= 2,000 and at most about
    2,000 deleted positions per block. Deleting one position at a time costs
    at most a few million element moves there, so it passes — that is the
    partial credit the statement promises.
  * cases 6-10 (50%) use a fixed shape built around two expensive calls: a
    DENSE RUN (`4 start 1 count`, a contiguous block of up to 80,000
    positions) and a SCATTERED SUBSET (`2 k seed`, up to 100,000 positions) on
    a vector of up to a million elements. One compaction pass handles either
    in O(n + k); deleting one position at a time costs k * n, which is 10^10
    moves and up. Case 6 is already far over the limit, which matters because
    the judge stops at the first failure.

Both big shapes are generated INSIDE the grader from a seed or from
(start, stride, count), so a hundred thousand deletions cost one short line of
input: that is what keeps the whole problem's data under 30 kB.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   1 rebuild, 2 scattered erase_many, 3 print one, 4 strided erase_many,
#   5 resize, 6 clear, 7 copy check, 8 digest, 9 print everything,
#   10 empty-list no-op
SMALL = {1: 10, 2: 18, 3: 10, 4: 18, 5: 8, 6: 3, 7: 8, 8: 12, 9: 8, 10: 5}
MID = {1: 10, 2: 20, 3: 8, 4: 20, 5: 8, 6: 2, 7: 6, 8: 16, 9: 4, 10: 6}

# (seed, [(kind, n, commands, mix), ...]) for the small half
SMALL_PLAN = [
    (1601, [(1, 5, 16, SMALL), (2, 4, 14, SMALL)]),
    (1602, [(1, 0, 12, SMALL), (1, 1, 14, SMALL), (3, 3, 16, SMALL)]),
    (1603, [(1, 12, 26, SMALL), (2, 9, 22, SMALL), (3, 10, 22, SMALL)]),
    (1604, [(1, 300, 60, MID), (2, 120, 36, MID)]),
    (1605, [(1, 2000, 90, MID), (3, 1500, 60, MID), (2, 500, 30, MID)]),
]

# (seed, [(kind, n, run, scattered_k, scattered_k2), ...]) for the big half
BIG_PLAN = [
    (1606, [(1, 400_000, 20_000, 40_000, 30_000), (2, 15_000, 1_500, 2_000, 1_500)]),
    (1607, [(1, 600_000, 40_000, 60_000, 40_000), (3, 300_000, 20_000, 30_000, 20_000)]),
    (1608, [(1, 800_000, 50_000, 80_000, 50_000), (2, 20_000, 2_000, 3_000, 2_000)]),
    (1609, [(1, 1_000_000, 60_000, 100_000, 60_000), (3, 500_000, 30_000, 50_000, 30_000),
            (2, 20_000, 2_000, 3_000, 2_000)]),
    (1610, [(1, 1_000_000, 80_000, 100_000, 80_000), (3, 1_000_000, 60_000, 100_000, 60_000),
            (2, 25_000, 2_500, 4_000, 2_500)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"
STRIDES = [1, 1, 2, 3, 7]


def random_block(rng: random.Random, kind: int, n: int, commands: int, mix: dict) -> list[str]:
    size = n
    body = ["1 %d %d" % (n, rng.randrange(1, 10**9))]

    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            body.append("1 %d %d" % (n, rng.randrange(1, 10**9)))
            size = n
        elif op == 2:
            wanted = rng.randrange(0, max(size // 2, 1) + 1)
            body.append("2 %d %d" % (wanted, rng.randrange(1, 10**9)))
            size = max(0, size - wanted)
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 4:
            stride = rng.choice(STRIDES)
            start = rng.randrange(0, max(size, 1))
            count = rng.randrange(0, max((size - start) // stride, 1) + 1)
            body.append("4 %d %d %d" % (start, stride, count))
            size = max(0, size - count)
        elif op == 5:
            wanted = rng.randrange(0, n + 1) if n > 0 else 0
            body.append("5 %d" % wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n: int, run: int,
              scattered_k: int, scattered_k2: int) -> list[str]:
    """A fixed shape: the dense run and the scattered subset are the two calls
    that separate one compaction pass from one-at-a-time deletion, and the
    rebuilds keep the vector full-size for both of them."""
    body = [
        "1 %d %d" % (n, rng.randrange(1, 10**9)),
        "8",
        "4 0 1 %d" % run,                                   # contiguous run at the front
        "8",
        "2 %d %d" % (scattered_k, rng.randrange(1, 10**9)),  # scattered subset
        "8",
        "10",                                               # empty list: a no-op
        "3 %d" % rng.randrange(0, 10**9),
        "1 %d %d" % (n, rng.randrange(1, 10**9)),           # rebuild to full size
        "4 %d 2 %d" % (n // 2, n // 4),                     # every other element, back half
        "2 %d %d" % (scattered_k2, rng.randrange(1, 10**9)),
        "8",
        "4 %d 1 %d" % (max(n // 8, 1), run // 2),           # run in the middle
        "5 %d" % (n // 4),
        "7",
        "8",
    ]
    return ["%d %d" % (kind, len(body))] + body


def build_case(index: int) -> str:
    if index < len(SMALL_PLAN):
        seed, blocks = SMALL_PLAN[index]
        rng = random.Random(seed)
        lines = [str(len(blocks))]
        for kind, n, commands, mix in blocks:
            lines.extend(random_block(rng, kind, n, commands, mix))
        return "\n".join(lines) + "\n"

    seed, blocks = BIG_PLAN[index - len(SMALL_PLAN)]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, run, k1, k2 in blocks:
        lines.extend(big_block(rng, kind, n, run, k1, k2))
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
