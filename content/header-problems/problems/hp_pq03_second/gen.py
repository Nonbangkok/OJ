"""Testcase generator for hp_pq03_second.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-5   (50%)  up to 2,000 elements. An O(n) scan still passes here,
                       and case 5 is the largest case it survives
    cases 6-10 (50%)   100,000 elements built by `fill` and ~10,000 second()
                       queries, where a scan needs ~10^9 comparisons

EVERY case from 6 on must defeat the scan, because the judge stops at the
first failure: if case 6 let it through the naive version would score 60%,
not the 50% the statement promises. So the jump at case 6 is deliberately
steep (2,000 -> 100,000 elements with five times the queries).

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind q drain      kind: 1 = int/less, 2 = int/greater (min-heap),
                            3 = long long/less, 4 = Item/ItemOrder
    q command lines:
      1 x             push x        (Item blocks write two numbers: w id)
      2               pop
      3               print top
      4               print size
      5 c s p         fill: push c generated values (seed s, value span p)
      6               copy check
      7               print the heap-property flag and the size
      8               print second()
      9               print take_two()  (pops the two most important)

"""

import os
import random
import sys

CASES = 10

# Weight per opcode. In the big blocks 8 (second) dominates: it is two bytes
# of input and one comparison for the reference, but a whole pass over 100,000
# elements for a scan — the cheapest possible way, in archive bytes, to
# separate O(1) from O(n).
MIXED = {1: 26, 2: 14, 3: 10, 4: 4, 6: 4, 7: 4, 8: 26, 9: 8}
EDGY = {1: 22, 2: 30, 3: 10, 4: 6, 6: 3, 7: 3, 8: 16, 9: 10}
HOT = {1: 8, 2: 5, 3: 2, 4: 1, 6: 0, 7: 1, 8: 76, 9: 7}

# (seed, [(kind, prefill, q, mix, drain), ...]); prefill is (count, seed, span)
# or None and becomes a leading `fill` command.
PLAN = [
    (5301, [(1, None, 16, MIXED, 100), (2, None, 14, MIXED, 100)]),
    (5302, [(1, None, 40, EDGY, 100), (2, None, 30, EDGY, 100), (4, None, 24, MIXED, 100)]),
    (5303, [(3, None, 150, MIXED, 400), (4, None, 120, MIXED, 400), (2, None, 90, EDGY, 400)]),
    (5304, [(2, (400, 11, 40), 1200, MIXED, 400), (4, (300, 12, 60), 900, MIXED, 400)]),
    (5305, [(1, (2000, 21, 1000), 9000, HOT, 400), (3, (1500, 22, 10 ** 9), 7000, HOT, 400)]),
    (5306, [(1, (100000, 31, 10 ** 6), 14000, HOT, 1000), (2, (2000, 32, 50), 1500, MIXED, 500)]),
    (5307, [(2, (100000, 41, 10 ** 9), 15000, HOT, 1000), (4, (3000, 42, 400), 1500, MIXED, 500)]),
    (5308, [(3, (110000, 51, 10 ** 9), 15000, HOT, 1000), (1, (3000, 52, 7), 1500, MIXED, 500)]),
    (5309, [(4, (110000, 61, 1000), 15000, HOT, 1000), (2, (4000, 62, 10 ** 6), 1500, MIXED, 500)]),
    (5310, [(1, (120000, 71, 3), 16000, HOT, 1000), (3, (5000, 72, 10 ** 9), 1500, MIXED, 500)]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-1000, 1000), rng.randint(0, 999))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-1000, 1000))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict, drain: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        commands.append("1 " + element(rng, kind) if op == 1 else str(op))

    return ["%d %d %d" % (kind, len(commands), drain)] + commands


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, prefill, count, mix, drain in blocks:
        lines.extend(block(rng, kind, prefill, count, mix, drain))
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: gen.py <output-directory>", file=sys.stderr)
        return 2
    os.makedirs(argv[1], exist_ok=True)
    for index in range(CASES):
        path = os.path.join(argv[1], "input%02d.txt" % (index + 1))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(build_case(index))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
