"""Testcase generator for hp_pq06_descendants.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-5   (50%)  up to 2,000 elements and bursts of at most 200,000
                       queries. A subtree walk still passes, and case 5 is the
                       largest case it survives (~1.5*10^8 visited nodes)
    cases 6-10 (50%)   400,000 to 1,000,000 elements built by `fill`, with the
                       same burst sizes: a subtree walk now needs >10^10
                       visited nodes, the intended solution ~20 steps each

EVERY case from 6 on must defeat the walk, because the judge stops at the
first failure: if case 6 let it through the naive version would score 60%,
not the 50% the statement promises. The jump at case 6 is therefore steep —
200x the elements, the same number of queries.

descendants() does not look at the VALUES at all, only at mSize, so the big
`fill` commands use a wide value span: that keeps the reference's own pushes
cheap (a random element rarely climbs) and leaves the measured difference
where it belongs, in the queries.

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
      8 i             print descendants(i % size)
      9 i             print descendants(i), which usually throws
      10 c s b        burst: c queries at indices below b, folded into a hash
      11 i            print is_leaf(i % size)

"""

import os
import random
import sys

CASES = 10

# Weight per opcode for the hand-written parts of a block. The bursts (op 10)
# are placed explicitly instead, because their size is what the subtasks are
# made of.
MIXED = {1: 26, 2: 16, 3: 6, 4: 4, 6: 4, 7: 4, 8: 24, 9: 6, 11: 10}
EDGY = {1: 24, 2: 28, 3: 6, 4: 6, 6: 3, 7: 3, 8: 18, 9: 6, 11: 6}
BIG = {1: 30, 2: 18, 3: 4, 4: 2, 6: 0, 7: 1, 8: 30, 9: 5, 11: 10}

# (seed, [(kind, prefill, q, mix, bursts, drain), ...]):
#   prefill  (count, seed, span) -> a leading `fill`
#   bursts   list of (count, seed, bound) -> `burst` commands spread through
#            the block, which is where the complexity subtask lives
PLAN = [
    (5601, [(1, None, 18, MIXED, [(40, 7, 3)], 100),
            (2, None, 14, MIXED, [(30, 8, 2)], 100)]),
    (5602, [(1, None, 40, EDGY, [(200, 7, 4)], 100),
            (2, None, 30, EDGY, [(150, 8, 3)], 100),
            (4, None, 24, MIXED, [(100, 9, 2)], 100)]),
    (5603, [(3, None, 150, MIXED, [(2000, 7, 4)], 400),
            (4, None, 120, MIXED, [(1500, 8, 6)], 400),
            (2, None, 90, EDGY, [(1000, 9, 3)], 400)]),
    (5604, [(2, (400, 11, 10 ** 6), 500, MIXED, [(20000, 7, 4), (20000, 8, 2)], 400),
            (4, (300, 12, 10 ** 5), 400, MIXED, [(15000, 9, 6)], 400)]),
    (5605, [(1, (2000, 21, 10 ** 9), 400, MIXED, [(100000, 7, 4), (60000, 8, 2)], 400),
            (3, (1500, 22, 10 ** 9), 300, MIXED, [(40000, 9, 3)], 400)]),
    (5606, [(1, (400000, 31, 10 ** 9), 300, BIG, [(100000, 7, 4), (60000, 8, 2)], 2000),
            (2, (2000, 32, 10 ** 6), 200, MIXED, [(20000, 9, 3)], 500)]),
    (5607, [(2, (500000, 41, 10 ** 9), 300, BIG, [(120000, 7, 3), (80000, 8, 2)], 2000),
            (4, (100000, 42, 10 ** 5), 200, BIG, [(40000, 9, 4)], 1000)]),
    (5608, [(3, (700000, 51, 10 ** 9), 300, BIG, [(140000, 7, 4), (90000, 8, 2)], 2000),
            (1, (50000, 52, 10 ** 6), 200, BIG, [(40000, 9, 3)], 1000)]),
    (5609, [(1, (900000, 61, 10 ** 9), 300, BIG, [(160000, 7, 3), (100000, 8, 2)], 2000),
            (4, (120000, 62, 10 ** 5), 200, BIG, [(50000, 9, 4)], 1000)]),
    (5610, [(2, (1000000, 71, 10 ** 9), 300, BIG, [(180000, 7, 2), (120000, 8, 3)], 2000),
            (3, (200000, 72, 10 ** 9), 200, BIG, [(60000, 9, 2)], 1000)]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-1000, 1000), rng.randint(0, 999))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-10 ** 6, 10 ** 6))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict,
          bursts: list, drain: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            commands.append("1 " + element(rng, kind))
        elif op in (8, 11):
            commands.append("%d %d" % (op, rng.randrange(10 ** 6)))
        elif op == 9:
            commands.append("9 %d" % (rng.randrange(40) if rng.random() < 0.3
                                      else rng.randrange(10 ** 7, 10 ** 8)))
        else:
            commands.append(str(op))

    # Spread the bursts through the block so each one sees a different mSize.
    for position, burst in enumerate(bursts):
        where = min(len(commands), 1 + (position + 1) * (len(commands) - 1) // (len(bursts) + 1))
        commands.insert(where, "10 %d %d %d" % burst)

    return ["%d %d %d" % (kind, len(commands), drain)] + commands


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, prefill, count, mix, bursts, drain in blocks:
        lines.extend(block(rng, kind, prefill, count, mix, bursts, drain))
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
