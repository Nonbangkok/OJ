#!/usr/bin/env python3
"""Testcase generator for hp_vec10_rotate.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

This problem has TWO things to separate, and the two halves are built for
them:

  * cases 1-5 (50%) are random command mixes with n <= 1,500. Rotating one
    position at a time costs at most a few tens of millions of moves there,
    and a temporary array of 1,500 elements is nothing — so both wrong
    approaches pass. That is the partial credit the statement promises.
  * cases 6-10 (50%) each start with a block of 2,000,000 `long long`, i.e.
    16 MB of data inside a 32 MB limit, and rotate it by amounts close to n.
      - TIME: one position at a time costs k * n, about 2 * 10^12 moves.
      - MEMORY: a rotation that copies the data into a temporary array needs
        another 16 MB, which does not fit. (The harness's slow.h check can
        only express the time half; the memory half is enforced by the
        problem's 32 MB limit and is measured separately in the report.)

The big blocks are built with ONE resize(n), so the vector's buffer is exactly
n elements with no doubling slack, and they only ever resize DOWNWARDS
afterwards. Every later command is chosen to keep the grader's own footprint
negligible: no copy-check (that would allocate a second vector), no element
dumps, and the digest allocates nothing.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   1 rebuild, 2 rotate by k, 3 print one, 4 rotate by size (no-op),
#   5 resize, 6 clear, 7 copy check, 8 digest, 9 print everything,
#   10 several generated rotations
SMALL = {1: 8, 2: 30, 3: 10, 4: 8, 5: 8, 6: 3, 7: 8, 8: 10, 9: 8, 10: 7}
MID = {1: 8, 2: 32, 3: 8, 4: 8, 5: 8, 6: 2, 7: 6, 8: 12, 9: 4, 10: 12}

KS = [("zero", 8), ("one", 10), ("size_minus_one", 10), ("size", 8),
      ("size_plus_one", 10), ("far_multiple", 10), ("half", 12), ("random", 32)]

# (seed, [(kind, n, commands, mix), ...]) for the small half
SMALL_PLAN = [
    (2001, [(1, 5, 18, SMALL), (2, 4, 16, SMALL)]),
    (2002, [(1, 0, 12, SMALL), (1, 1, 14, SMALL), (3, 3, 18, SMALL)]),
    (2003, [(1, 12, 28, SMALL), (2, 9, 24, SMALL), (3, 11, 24, SMALL)]),
    (2004, [(1, 200, 70, MID), (2, 80, 40, MID)]),
    (2005, [(1, 1500, 90, MID), (3, 1200, 60, MID), (2, 300, 40, MID)]),
]

# (seed, [(kind, n), ...]) for the big half. The first block of every case is
# the 16 MB long long one: a submission that allocates a copy of the data goes
# over the 32 MB limit on case 6, not only on case 10.
BIG_PLAN = [
    (2006, [(3, 2_000_000), (1, 400_000), (2, 20_000)]),
    (2007, [(3, 2_000_000), (1, 600_000)]),
    (2008, [(3, 2_000_000), (1, 800_000), (2, 25_000)]),
    (2009, [(3, 2_000_000), (1, 1_000_000)]),
    (2010, [(3, 2_000_000), (1, 1_000_000), (2, 30_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def pick_k(rng: random.Random, size: int) -> int:
    names = [name for name, _ in KS]
    weights = [weight for _, weight in KS]
    region = rng.choices(names, weights=weights, k=1)[0]
    if size == 0:
        return rng.choice([0, 1, 7])
    if region == "zero":
        return 0
    if region == "one":
        return 1
    if region == "size_minus_one":
        return size - 1
    if region == "size":
        return size
    if region == "size_plus_one":
        return size + 1
    if region == "far_multiple":
        return size * rng.randrange(2, 5) + rng.randrange(0, 3)
    if region == "half":
        return size // 2
    return rng.randrange(0, 2 * size + 1)


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
            body.append("2 %d" % pick_k(rng, size))
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
            body.append("10 %d %d" % (rng.randrange(1, 6), rng.randrange(1, 10**9)))
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n: int) -> list[str]:
    """A fixed shape with a small, known number of full-length rotations, so
    the reference stays near a tenth of the time limit while a one-position-
    at-a-time rotation needs k * n moves for the very first one."""
    body = [
        "1 %d %d" % (n, rng.randrange(1, 10**9)),
        "8",
        "2 %d" % (n // 3),            # a big k: k*n for the naive version
        "8",
        "4",                          # rotate by size(): a no-op
        "2 %d" % (n + 7),             # k > size
        "3 %d" % rng.randrange(0, 10**9),
        "10 2 %d" % rng.randrange(1, 10**9),
        "8",
        "5 %d" % (n // 2),            # shrink (no reallocation)
        "2 %d" % (n // 5),
        "3 %d" % rng.randrange(0, 10**9),
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
    for kind, n in blocks:
        lines.extend(big_block(rng, kind, n))
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
