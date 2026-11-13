#!/usr/bin/env python3
"""Testcase generator for hp_vec05_insert.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

The subtask boundary here is a COMPLEXITY boundary, so the two halves are
sized against the two implementations rather than just "small" and "large":

  * cases 1-5 (50%) are random command mixes with at most a couple of thousand
    elements and insertions per block. A solution that grows the array by one
    slot per insert does a few million element moves here, comfortably inside
    the limit — that is the partial credit the statement promises.
  * cases 6-10 (50%) use a fixed, hand-built shape whose centrepiece is one
    `10 K seed` command appending K = 4e5 .. 1e6 elements with
    insert(size(), x). Doubling the capacity costs O(K) in total; growing by
    one slot costs K^2/2, i.e. 8e10 moves or more. Case 6 is already far over
    the limit, which matters because the judge stops at the FIRST failure: if
    case 6 let the quadratic version through it would score 60%, not the 50%
    the statement promises.

Front (`11`) and scattered (`12`) insertions are Theta(n) per call for every
implementation, so the big blocks use them only a handful of times: they are
there to check the shifting, not the growth.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   2 insert one, 3 print one, 5 resize, 6 clear, 7 copy check, 8 digest,
#   9 print everything, 10 bulk append, 11 bulk front insert,
#   12 bulk scattered insert
SMALL = {2: 30, 3: 12, 5: 8, 6: 4, 7: 8, 8: 12, 9: 8, 10: 10, 11: 6, 12: 6}
MID = {2: 26, 3: 10, 5: 8, 6: 3, 7: 6, 8: 14, 9: 2, 10: 14, 11: 8, 12: 10}

POSITIONS = [("front", 18), ("last", 14), ("middle", 22), ("random", 16),
             ("at_size", 16), ("beyond", 14)]

# Random small/mid blocks: (kind, n, commands, mix, appends)
SMALL_PLAN = [
    (1501, [(1, 4, 16, SMALL, 40), (2, 3, 14, SMALL, 30)]),
    (1502, [(1, 0, 14, SMALL, 30), (1, 1, 16, SMALL, 40), (3, 2, 14, SMALL, 40)]),
    (1503, [(1, 10, 24, SMALL, 200), (2, 8, 20, SMALL, 150), (3, 9, 20, SMALL, 200)]),
    (1504, [(1, 300, 70, MID, 700), (2, 120, 40, MID, 250)]),
    (1505, [(1, 1000, 110, MID, 1000), (3, 800, 70, MID, 900), (2, 300, 40, MID, 400)]),
]

# Hand-built big blocks: (kind, n0, first_append, second_append)
BIG_PLAN = [
    (1506, [(1, 2000, 400_000, 120_000), (2, 400, 4_000, 2_000)]),
    (1507, [(1, 3000, 600_000, 200_000), (3, 2000, 300_000, 100_000)]),
    (1508, [(1, 4000, 800_000, 150_000), (2, 600, 8_000, 3_000)]),
    (1509, [(1, 5000, 1_000_000, 200_000), (3, 4000, 500_000, 150_000), (2, 800, 10_000, 4_000)]),
    (1510, [(1, 8000, 1_000_000, 400_000), (3, 8000, 800_000, 300_000), (2, 1000, 12_000, 5_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 5)))
    return str(rng.randint(-2_000_000_000, 2_000_000_000))


def pick_position(rng: random.Random, size: int) -> int:
    names = [name for name, _ in POSITIONS]
    weights = [weight for _, weight in POSITIONS]
    region = rng.choices(names, weights=weights, k=1)[0]
    if size == 0:
        return rng.choice([0, 1, 5])
    if region == "front":
        return 0
    if region == "last":
        return size - 1
    if region == "middle":
        return size // 2
    if region == "random":
        return rng.randrange(0, size)
    if region == "at_size":
        return size
    return size + rng.choice([1, 2, 9])


def random_block(rng: random.Random, kind: int, n: int, commands: int,
                 mix: dict, appends: int) -> list[str]:
    size = n
    appends_left = appends
    body = ["1 %d %d" % (n, rng.randrange(1, 10**9))]

    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 2:
            pos = pick_position(rng, size)
            body.append("2 %d %s" % (pos, element(rng, kind)))
            if pos <= size:
                size += 1
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 5:
            wanted = rng.randrange(0, max(n, 1) + 1)
            body.append("5 %d" % wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        elif op in (7, 8, 9):
            body.append(str(op))
        elif op == 10:
            count = min(appends_left, rng.randrange(1, max(2, appends // 3 + 2)))
            if count <= 0:
                body.append("8")
                continue
            body.append("10 %d %d" % (count, rng.randrange(1, 10**9)))
            appends_left -= count
            size += count
        else:  # 11 or 12: Theta(n) per element for everybody, so keep it tiny
            count = rng.randrange(1, 12)
            body.append("%d %d %d" % (op, count, rng.randrange(1, 10**9)))
            size += count
    if appends_left > 0:
        body.append("10 %d %d" % (appends_left, rng.randrange(1, 10**9)))
        body.append("8")
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n0: int, first: int, second: int) -> list[str]:
    """A fixed shape, so the quadratic killer is guaranteed to be there and
    the reference's cost is easy to reason about: roughly (first + second)
    appends, a handful of full-length shifts and four passes for digests."""
    body = [
        "1 %d %d" % (n0, rng.randrange(1, 10**9)),
        "8",
        "2 0 %s" % element(rng, kind),
        "2 %d %s" % (n0 + 1, element(rng, kind)),          # == size(): an append
        "2 %d %s" % (n0 + 50, element(rng, kind)),         # out of range: a no-op
        "10 %d %d" % (first, rng.randrange(1, 10**9)),     # the big append
        "8",
        "3 %d" % rng.randrange(0, 10**9),
        "2 0 %s" % element(rng, kind),
        "2 %d %s" % (first // 2, element(rng, kind)),
        "11 3 %d" % rng.randrange(1, 10**9),
        "12 3 %d" % rng.randrange(1, 10**9),
        "8",
        "5 %d" % (first // 2),
        "10 %d %d" % (second, rng.randrange(1, 10**9)),
        "3 %d" % rng.randrange(0, 10**9),
        "7",
        "8",
    ]
    return ["%d %d" % (kind, len(body))] + body


def build_case(index: int) -> str:
    if index < len(SMALL_PLAN):
        seed, blocks = SMALL_PLAN[index]
        rng = random.Random(seed)
        lines = [str(len(blocks))]
        for kind, n, commands, mix, appends in blocks:
            lines.extend(random_block(rng, kind, n, commands, mix, appends))
        return "\n".join(lines) + "\n"

    seed, blocks = BIG_PLAN[index - len(SMALL_PLAN)]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n0, first, second in blocks:
        lines.extend(big_block(rng, kind, n0, first, second))
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
