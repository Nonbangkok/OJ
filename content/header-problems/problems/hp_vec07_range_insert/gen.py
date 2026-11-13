#!/usr/bin/env python3
"""Testcase generator for hp_vec07_range_insert.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

The subtask boundary is a COMPLEXITY boundary:

  * cases 1-5 (50%) are random command mixes with n, m <= 600. Inserting the
    block one element at a time does a few million moves there, so it passes —
    the partial credit the statement promises.
  * cases 6-10 (50%) use a fixed shape whose deciding calls insert a block of
    6e4 .. 2e5 values at the FRONT or in the MIDDLE of a vector of up to 5e5
    elements. One slide costs O(n + m); one slide per value costs m * (n-pos),
    i.e. 6e9 moves and up. Appends are included too, but they are NOT what
    separates the two: with pos == size() nothing has to move either way.

The blocks of values are built inside the grader from a seed, so the whole
problem's testcase data stays a few kilobytes.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   1 rebuild, 2 insert a block at pos, 3 print one, 4 append a block,
#   5 resize, 6 clear, 7 copy check, 8 digest, 9 print everything,
#   10 empty block, 11 front block
SMALL = {1: 8, 2: 22, 3: 10, 4: 12, 5: 8, 6: 3, 7: 8, 8: 12, 9: 8, 10: 4, 11: 10}
MID = {1: 8, 2: 24, 3: 8, 4: 14, 5: 8, 6: 2, 7: 6, 8: 14, 9: 2, 10: 4, 11: 14}

POSITIONS = [("front", 22), ("middle", 26), ("random", 18), ("at_size", 18), ("beyond", 16)]

# (seed, [(kind, n, m, commands, mix), ...]) for the small half
SMALL_PLAN = [
    (1701, [(1, 4, 3, 16, SMALL), (2, 3, 2, 14, SMALL)]),
    (1702, [(1, 0, 1, 12, SMALL), (1, 1, 2, 14, SMALL), (3, 3, 3, 16, SMALL)]),
    (1703, [(1, 10, 6, 26, SMALL), (2, 8, 5, 22, SMALL), (3, 9, 6, 22, SMALL)]),
    (1704, [(1, 120, 60, 60, MID), (2, 60, 30, 34, MID)]),
    (1705, [(1, 600, 300, 80, MID), (3, 400, 200, 60, MID), (2, 200, 100, 30, MID)]),
]

# (seed, [(kind, n, m), ...]) for the big half; m is the block size of the
# deciding front/middle insertions.
BIG_PLAN = [
    (1706, [(1, 100_000, 60_000), (2, 4_000, 1_500)]),
    (1707, [(1, 200_000, 100_000), (3, 100_000, 50_000)]),
    (1708, [(1, 300_000, 120_000), (2, 6_000, 2_000)]),
    (1709, [(1, 400_000, 150_000), (3, 200_000, 80_000), (2, 8_000, 2_500)]),
    (1710, [(1, 500_000, 200_000), (3, 400_000, 150_000), (2, 10_000, 3_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def pick_position(rng: random.Random, size: int) -> int:
    names = [name for name, _ in POSITIONS]
    weights = [weight for _, weight in POSITIONS]
    region = rng.choices(names, weights=weights, k=1)[0]
    if size == 0:
        return rng.choice([0, 1, 4])
    if region == "front":
        return 0
    if region == "middle":
        return size // 2
    if region == "random":
        return rng.randrange(0, size)
    if region == "at_size":
        return size
    return size + rng.choice([1, 3, 11])


def random_block(rng: random.Random, kind: int, n: int, m: int,
                 commands: int, mix: dict) -> list[str]:
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
            pos = pick_position(rng, size)
            count = rng.randrange(0, m + 1)
            body.append("2 %d %d %d" % (pos, count, rng.randrange(1, 10**9)))
            if pos <= size:
                size += count
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op in (4, 11):
            count = rng.randrange(0, m + 1)
            body.append("%d %d %d" % (op, count, rng.randrange(1, 10**9)))
            size += count
        elif op == 5:
            wanted = rng.randrange(0, max(n, 1) + 1)
            body.append("5 %d" % wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        elif op == 10:
            body.append("10 %d" % pick_position(rng, size))
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n: int, m: int) -> list[str]:
    """A fixed shape. The two calls that decide the problem are the front
    block (`11 m`) and the middle block (`2 n/2 m`): both move most of the
    vector exactly once for the reference and once per value for the naive
    version."""
    body = [
        "1 %d %d" % (n, rng.randrange(1, 10**9)),
        "8",
        "11 %d %d" % (m, rng.randrange(1, 10**9)),        # block at the front
        "8",
        "2 %d %d %d" % (n // 2, m, rng.randrange(1, 10**9)),  # block in the middle
        "8",
        "4 %d %d" % (m, rng.randrange(1, 10**9)),         # block appended (cheap both ways)
        "10 0",                                           # empty block: a no-op
        "3 %d" % rng.randrange(0, 10**9),
        "5 %d" % n,                                       # back down to n
        "2 %d %d %d" % (n + 5, m, rng.randrange(1, 10**9)),   # pos > size: a no-op
        "2 %d %d %d" % (n, m // 2, rng.randrange(1, 10**9)),  # pos == size: an append
        "8",
        "11 %d %d" % (m // 2, rng.randrange(1, 10**9)),
        "7",
        "8",
    ]
    return ["%d %d" % (kind, len(body))] + body


def build_case(index: int) -> str:
    if index < len(SMALL_PLAN):
        seed, blocks = SMALL_PLAN[index]
        rng = random.Random(seed)
        lines = [str(len(blocks))]
        for kind, n, m, commands, mix in blocks:
            lines.extend(random_block(rng, kind, n, m, commands, mix))
        return "\n".join(lines) + "\n"

    seed, blocks = BIG_PLAN[index - len(SMALL_PLAN)]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, m in blocks:
        lines.extend(big_block(rng, kind, n, m))
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
