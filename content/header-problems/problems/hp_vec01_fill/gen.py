#!/usr/bin/env python3
"""Testcase generator for hp_vec01_fill.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: 1-3 (30%) are tiny and print every
element, 4-6 (30%) are mid-sized, 7-10 (40%) hold up to a million elements and
are checked with digests only.

The `1 n seed` command manufactures n elements from a seed inside the grader,
so a two-token line can demand a million assignments: that is what keeps the
input under a few kilobytes while still filling a million-element vector.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   2 fill, 3 print one, 4 assign one, 5 resize, 6 clear, 7 copy check,
#   8 size+digest, 9 print everything
SMALL = {2: 26, 3: 14, 4: 12, 5: 10, 6: 4, 7: 10, 8: 14, 9: 10}
MID = {2: 30, 3: 12, 4: 12, 5: 10, 6: 4, 7: 8, 8: 22, 9: 2}
# The big blocks are fill-dominated: a `fill` is one short line of input and
# costs a full pass over a million elements, while `9` (print everything)
# would cost megabytes of output, so it is switched off entirely.
BIG = {2: 60, 3: 8, 4: 6, 5: 6, 6: 1, 7: 3, 8: 16, 9: 0}

# (seed, [(kind, n, commands, mix), ...]); kind 1 = int, 2 = std::string,
# 3 = long long. Every case uses at least two different T.
#
# The big blocks are budgeted by PASSES over the data, not by command count:
# a fill is one pass, a digest is one pass, a copy check is about five. Case 10
# is ~45 passes of a million elements, which the reference does in well under
# a tenth of the limit while still being large enough that an implementation
# which is not O(n) per fill has no chance.
PLAN = [
    (1101, [(1, 3, 14, SMALL), (2, 2, 12, SMALL)]),
    (1102, [(1, 0, 12, SMALL), (1, 1, 14, SMALL), (3, 2, 12, SMALL)]),
    (1103, [(1, 10, 22, SMALL), (2, 7, 18, SMALL), (3, 9, 18, SMALL)]),
    (1104, [(1, 300, 60, MID), (2, 120, 40, MID)]),
    (1105, [(1, 1200, 80, MID), (3, 900, 60, MID), (2, 200, 30, MID)]),
    (1106, [(1, 2000, 120, MID), (2, 400, 40, MID), (3, 1500, 60, MID)]),
    (1107, [(1, 250000, 40, BIG), (2, 4000, 20, MID)]),
    (1108, [(1, 500000, 40, BIG), (3, 200000, 20, BIG)]),
    (1109, [(1, 1000000, 30, BIG), (2, 20000, 14, MID), (3, 300000, 16, BIG)]),
    (1110, [(1, 1000000, 36, BIG), (3, 1000000, 12, BIG), (2, 30000, 12, MID)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 5)))
    return str(rng.randint(-2_000_000_000, 2_000_000_000))


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict) -> list[str]:
    body = ["1 %d %d" % (n, rng.randrange(1, 10**9))]
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 2:
            body.append("2 " + element(rng, kind))
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 4:
            body.append("4 %d %s" % (rng.randrange(0, 10**9), element(rng, kind)))
        elif op == 5:
            body.append("5 %d" % rng.randrange(0, n + 1))
        else:
            body.append(str(op))
    # A block always ends with a resize back up and one more fill, so the
    # final digest covers a full-size vector even if the last random command
    # happened to be `clear`.
    body.append("5 %d" % n)
    body.append("2 " + element(rng, kind))
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
