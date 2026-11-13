#!/usr/bin/env python3
"""Testcase generator for hp_vec08_block_swap.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

The subtask boundary is a COMPLEXITY boundary:

  * cases 1-5 (50%) are random command mixes with n <= 2,000 and at most about
    2,000 swaps per block. A solution that snapshots the whole vector on every
    call does a few million element copies there, so it passes — the partial
    credit the statement promises.
  * cases 6-10 (50%) hinge on `10 count seed maxlen`: up to 20,000 generated
    swaps with len <= 8 on a vector of up to a million elements. O(len) per
    call is 1.6e5 element copies in total; O(n) per call is 2e10.

The explicit `2 i j len` commands carry the awkward arguments instead:
len == 0, i == j, overlapping ranges, blocks that would run past the end, and
len > size. All of them must be no-ops, and the digest printed at the end of
the block proves nothing moved.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   1 rebuild, 2 explicit swap, 3 print one, 4 swap halves, 5 resize,
#   6 clear, 7 copy check, 8 digest, 9 print everything, 10 generated swaps
SMALL = {1: 6, 2: 30, 3: 10, 4: 8, 5: 6, 6: 3, 7: 8, 8: 12, 9: 8, 10: 9}
MID = {1: 6, 2: 30, 3: 8, 4: 8, 5: 6, 6: 2, 7: 6, 8: 14, 9: 4, 10: 16}

ARGUMENTS = [
    ("valid", 34),
    ("adjacent", 14),
    ("halves", 8),
    ("overlap", 14),
    ("same", 8),
    ("zero_len", 8),
    ("past_end", 8),
    ("len_too_big", 6),
]

# (seed, [(kind, n, commands, mix), ...]) for the small half
SMALL_PLAN = [
    (1801, [(1, 6, 18, SMALL), (2, 5, 16, SMALL)]),
    (1802, [(1, 0, 12, SMALL), (1, 1, 14, SMALL), (3, 4, 18, SMALL)]),
    (1803, [(1, 12, 28, SMALL), (2, 9, 22, SMALL), (3, 11, 24, SMALL)]),
    (1804, [(1, 200, 70, MID), (2, 80, 40, MID)]),
    (1805, [(1, 2000, 110, MID), (3, 1500, 70, MID), (2, 400, 40, MID)]),
]

# (seed, [(kind, n, count, maxlen), ...]) for the big half
BIG_PLAN = [
    (1806, [(1, 400_000, 8_000, 8), (2, 5_000, 1_000, 6)]),
    (1807, [(1, 600_000, 12_000, 8), (3, 300_000, 8_000, 6)]),
    (1808, [(1, 800_000, 16_000, 6), (2, 8_000, 1_500, 5)]),
    (1809, [(1, 1_000_000, 20_000, 6), (3, 500_000, 12_000, 8), (2, 10_000, 2_000, 5)]),
    (1810, [(1, 1_000_000, 20_000, 8), (3, 1_000_000, 20_000, 6), (2, 12_000, 2_500, 4)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def pick_arguments(rng: random.Random, size: int) -> tuple[int, int, int]:
    names = [name for name, _ in ARGUMENTS]
    weights = [weight for _, weight in ARGUMENTS]
    region = rng.choices(names, weights=weights, k=1)[0]
    if size < 2:
        return (0, 0, rng.choice([0, 1, 5]))
    half = size // 2
    if region == "halves":
        return (0, size - half, half)
    if region == "zero_len":
        return (rng.randrange(0, size), rng.randrange(0, size), 0)
    if region == "same":
        pos = rng.randrange(0, size)
        return (pos, pos, rng.randrange(1, half + 1))
    if region == "len_too_big":
        return (0, 0, size + rng.choice([1, 7, 1000]))
    if region == "past_end":
        length = rng.randrange(1, half + 1)
        return (size - length + 1, 0, length)
    if region == "overlap":
        length = rng.randrange(2, max(half, 2) + 1)
        start = rng.randrange(0, max(size - length, 1))
        shift = rng.randrange(1, length)
        if start + length + shift > size:
            return (0, 0, 0)
        return (start, start + shift, length)
    # a valid pair: two disjoint blocks of the same length
    length = rng.randrange(1, half + 1)
    room = size - 2 * length
    a = rng.randrange(0, room + 1)
    b = a + length + rng.randrange(0, room - a + 1)
    if region == "adjacent":
        b = a + length
        if b + length > size:
            b = size - length
            a = b - length
    return (a, b, length)


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
            i, j, length = pick_arguments(rng, size)
            body.append("2 %d %d %d" % (i, j, length))
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 5:
            wanted = rng.randrange(0, max(n, 1) + 1)
            body.append("5 %d" % wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        elif op == 10:
            count = rng.randrange(1, max(2, min(600, size * 2 + 2)))
            body.append("10 %d %d %d" % (count, rng.randrange(1, 10**9),
                                         rng.randrange(1, max(2, size // 4 + 2))))
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n: int, count: int, maxlen: int) -> list[str]:
    """A fixed shape: the generated short swaps are the complexity test, the
    explicit ones carry the awkward arguments, and `4` does the largest legal
    swap (the two halves)."""
    body = [
        "1 %d %d" % (n, rng.randrange(1, 10**9)),
        "8",
        "10 %d %d %d" % (count, rng.randrange(1, 10**9), maxlen),
        "8",
        "2 0 %d %d" % (n // 2, n // 2),          # the two halves, explicitly
        "8",
        "2 1 %d %d" % (n // 2, n // 2),          # shifted by one, so the ranges overlap: a no-op
        "2 0 1 %d" % (n // 2),                   # overlapping: a no-op
        "2 %d %d %d" % (n // 3, n // 3, 4),      # i == j: a no-op
        "2 0 %d 0" % (n // 2),                   # len == 0: a no-op
        "2 0 0 %d" % (n + 10),                   # len > size: a no-op
        "8",
        "4",                                     # swap the halves again
        "3 %d" % rng.randrange(0, 10**9),
        "10 %d %d %d" % (count // 2, rng.randrange(1, 10**9), maxlen),
        "8",
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
    for kind, n, count, maxlen in blocks:
        lines.extend(big_block(rng, kind, n, count, maxlen))
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
