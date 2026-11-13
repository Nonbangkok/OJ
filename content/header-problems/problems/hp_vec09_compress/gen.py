#!/usr/bin/env python3
"""Testcase generator for hp_vec09_compress.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

The subtask boundary is a COMPLEXITY boundary:

  * cases 1-5 (50%) are random command mixes with n <= 2,000. Removing one
    duplicate at a time and shifting the tail costs a few million element
    moves there, so it passes — the partial credit the statement promises.
  * cases 6-10 (50%) rebuild a vector of up to a million elements in runs of
    about four equal values, so roughly three quarters of it has to go. One
    pass costs O(n); one shift per removed element costs about 10^11 moves.

Note that the expensive moment for the naive version is the FIRST compress
after each rebuild — compress is idempotent, so a second call has nothing left
to remove. The big cases therefore rebuild several times, each time handing it
another 10^10 moves, and every case covers the two extremes the catalogue asks
for: runlen 1 (nothing to remove) and runlen >= n (everything but one
element).
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   1 rebuild with runs, 2 compress, 3 print one, 4 push a run of equals,
#   5 resize, 6 clear, 7 copy check, 8 digest, 9 print everything,
#   10 compress twice
SMALL = {1: 12, 2: 22, 3: 10, 4: 14, 5: 8, 6: 3, 7: 8, 8: 10, 9: 8, 10: 10}
MID = {1: 12, 2: 24, 3: 8, 4: 14, 5: 8, 6: 2, 7: 6, 8: 12, 9: 4, 10: 12}

# (seed, [(kind, n, commands, mix), ...]) for the small half
SMALL_PLAN = [
    (1901, [(1, 8, 18, SMALL), (2, 6, 16, SMALL)]),
    (1902, [(1, 0, 12, SMALL), (1, 1, 14, SMALL), (3, 4, 18, SMALL)]),
    (1903, [(1, 14, 28, SMALL), (2, 10, 24, SMALL), (3, 12, 24, SMALL)]),
    (1904, [(1, 300, 70, MID), (2, 120, 40, MID)]),
    (1905, [(1, 2000, 110, MID), (3, 1500, 70, MID), (2, 400, 40, MID)]),
]

# (seed, [(kind, n), ...]) for the big half
BIG_PLAN = [
    (1906, [(1, 300_000), (2, 8_000)]),
    (1907, [(1, 500_000), (3, 300_000)]),
    (1908, [(1, 700_000), (2, 12_000)]),
    (1909, [(1, 1_000_000), (3, 500_000), (2, 15_000)]),
    (1910, [(1, 1_000_000), (3, 1_000_000), (2, 20_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"
WORDS = ["a", "bb", "ccc", "dd", "e", "ffff"]
RUNLENS = [1, 1, 2, 3, 4, 8, 50]


def element(rng: random.Random, kind: int) -> str:
    if kind == 1:
        return str(rng.randint(-3, 3))
    if kind == 2:
        return rng.choice(WORDS)
    return str(rng.randint(-4, 4))


def random_block(rng: random.Random, kind: int, n: int, commands: int, mix: dict) -> list[str]:
    size = n
    body = ["1 %d %d %d" % (n, rng.randrange(1, 10**9), rng.choice(RUNLENS))]

    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            runlen = rng.choice(RUNLENS + [max(n, 1)])
            body.append("1 %d %d %d" % (n, rng.randrange(1, 10**9), runlen))
            size = n
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 4:
            count = rng.randrange(1, max(2, n // 4 + 2))
            body.append("4 %d %s" % (count, element(rng, kind)))
            size += count
        elif op == 5:
            wanted = rng.randrange(0, max(n, 1) + 1)
            body.append("5 %d" % wanted)
            size = wanted
        elif op == 6:
            body.append("6")
            size = 0
        else:
            body.append(str(op))
    return ["%d %d" % (kind, len(body))] + body


def big_block(rng: random.Random, kind: int, n: int) -> list[str]:
    """A fixed shape. Every rebuild with a short runlen hands a one-at-a-time
    implementation another ~n^2/2 element moves; the runlen 1 and runlen n
    rebuilds cover the all-distinct and all-equal extremes."""
    body = [
        "1 %d %d 4" % (n, rng.randrange(1, 10**9)),      # ~75% duplicates
        "8",
        "2",                                             # the expensive compress
        "8",
        "10",                                            # compress twice: must be idempotent
        "3 %d" % rng.randrange(0, 10**9),
        "1 %d %d %d" % (n, rng.randrange(1, 10**9), n),  # all equal
        "2",
        "8",
        "1 %d %d 1" % (n, rng.randrange(1, 10**9)),      # almost all distinct
        "2",
        "8",
        "1 %d %d 3" % (n, rng.randrange(1, 10**9)),
        "4 %d %s" % (n // 4, element(rng, kind)),        # a long run at the end
        "2",
        "8",
        "5 %d" % (n // 2),                               # resize up: a run of T() appears
        "2",
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
