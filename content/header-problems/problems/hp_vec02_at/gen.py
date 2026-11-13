#!/usr/bin/env python3
"""Testcase generator for hp_vec02_at.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds); build.py
derives the expected outputs from these exact bytes.

Cases 1-3 (30%) are tiny and print every element, 4-6 (30%) are mid-sized,
7-10 (40%) hold up to a million elements and are checked with digests.

The interesting part of this generator is the INDEX distribution. It mirrors
the grader's own bookkeeping (size and capacity, following resize() and
ensureCapacity() exactly) so it can aim indices at the three regions that tell
implementations apart:

  * inside the vector                 -> must return the element
  * size() <= index < capacity()      -> mData[index] EXISTS but is not an
                                         element, so at() must still throw;
                                         this is what catches a check written
                                         against mCap instead of mSize
  * index == size()                   -> the off-by-one boundary (> vs >=)
  * far beyond, up to SIZE_MAX        -> must throw, not wrap around
"""

import os
import random
import sys

CASES = 10
SIZE_MAX = 2**64 - 1

# Weight per opcode (see grader_main.cpp):
#   2 read via at(), 3 write via at(), 4 read via the const at(), 5 resize,
#   6 clear, 7 copy check, 8 digest via at(), 9 print everything
SMALL = {2: 22, 3: 16, 4: 18, 5: 8, 6: 4, 7: 8, 8: 14, 9: 10}
MID = {2: 26, 3: 16, 4: 20, 5: 8, 6: 3, 7: 5, 8: 20, 9: 2}
# Digests and copy checks are full passes over a million elements, so they are
# rare in the big blocks; the single-element accesses are what carry the
# out-of-range probing there.
BIG = {2: 40, 3: 18, 4: 26, 5: 4, 6: 1, 7: 2, 8: 9, 9: 0}

# Index-region weights: valid accesses dominate, but every block keeps probing
# the boundaries. An exception costs about a microsecond, and a block has at
# most a few hundred commands, so the throws are free either way.
REGIONS = [
    ("valid", 52),
    ("zero", 6),
    ("last", 8),
    ("at_size", 12),
    ("reserved", 10),
    ("just_over", 6),
    ("far", 6),
]

PLAN = [
    (1201, [(1, 3, 18, SMALL), (2, 2, 16, SMALL)]),
    (1202, [(1, 0, 14, SMALL), (1, 1, 16, SMALL), (3, 2, 16, SMALL)]),
    (1203, [(1, 10, 26, SMALL), (2, 6, 20, SMALL), (3, 9, 22, SMALL)]),
    (1204, [(1, 400, 90, MID), (2, 150, 50, MID)]),
    (1205, [(1, 1500, 140, MID), (3, 1000, 90, MID), (2, 250, 40, MID)]),
    (1206, [(1, 2000, 200, MID), (2, 500, 60, MID), (3, 1800, 120, MID)]),
    (1207, [(1, 200000, 120, BIG), (2, 5000, 40, MID)]),
    (1208, [(1, 500000, 120, BIG), (3, 250000, 60, BIG)]),
    (1209, [(1, 1000000, 90, BIG), (2, 20000, 30, MID), (3, 400000, 50, BIG)]),
    (1210, [(1, 1000000, 110, BIG), (3, 1000000, 40, BIG), (2, 30000, 30, MID)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 5)))
    return str(rng.randint(-2_000_000_000, 2_000_000_000))


def ensure_capacity(cap: int, wanted: int) -> int:
    """Exactly the header's ensureCapacity/expand growth rule."""
    if wanted > cap:
        return wanted if wanted > 2 * cap else 2 * cap
    return cap


def pick_index(rng: random.Random, size: int, cap: int) -> int:
    names = [name for name, _ in REGIONS]
    weights = [weight for _, weight in REGIONS]
    for _ in range(8):
        region = rng.choices(names, weights=weights, k=1)[0]
        if region == "valid" and size > 0:
            return rng.randrange(0, size)
        if region == "zero":
            return 0
        if region == "last" and size > 0:
            return size - 1
        if region == "at_size":
            return size
        if region == "reserved" and cap > size:
            return rng.randrange(size, cap)
        if region == "just_over":
            return size + 1
        if region == "far":
            return rng.choice([size + rng.randrange(1, 1000),
                               cap + rng.randrange(1, 10**6),
                               10**9 + rng.randrange(0, 10**9),
                               SIZE_MAX])
    return size  # the boundary is always a legitimate probe


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict) -> list[str]:
    size, cap = 0, 1
    body = ["1 %d %d" % (n, rng.randrange(1, 10**9))]
    cap = ensure_capacity(cap, n)
    size = n

    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op in (2, 4):
            body.append("%d %d" % (op, pick_index(rng, size, cap)))
        elif op == 3:
            body.append("3 %d %s" % (pick_index(rng, size, cap), element(rng, kind)))
        elif op == 5:
            wanted = rng.randrange(0, n + 1) if n > 0 else 0
            body.append("5 %d" % wanted)
            cap = ensure_capacity(cap, wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix in blocks:
        lines.extend(block(rng, kind, n, commands, mix))
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
