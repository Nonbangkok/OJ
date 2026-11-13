"""Testcase generator for hp_pq10_kth.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-5   (50%)  up to 2,000 elements and a few thousand queries.
                       Sorting a copy per query still passes, and case 5 is
                       the largest case it survives
    cases 6-10  (50%)  250,000 to 450,000 elements built by `fill`, with
                       thousands of queries whose k is a few hundred, plus a
                       handful with k near 10^5. Sorting a copy now needs
                       >10^10 operations per case; so does copying the heap
                       and popping k times, which is the other tempting
                       wrong-complexity answer

EVERY case from 6 on must defeat those, because the judge stops at the first
failure: if case 6 let them through they would score 60%, not the 50% the
statement promises.

Small k with a huge heap is the shape that separates O(k log k) from anything
proportional to n, so the bursts keep kmax small; the separate large-k queries
(op 8 with k up to ~10^5) are there to catch an O(k^2) candidate set instead.
The `fill` spans are wide, which keeps the reference's own pushes cheap.

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
      8 k             print kth(k % size + 1)
      9 k             print kth(k), which is often out of range (0 included)
      10 c s m        burst: c queries with k in 1..m, folded into a hash

"""

import os
import random
import sys

CASES = 10

# Weight per opcode for the hand-written part of a block; the bursts (op 10)
# are placed explicitly, because their size is what the subtasks are made of.
MIXED = {1: 24, 2: 14, 3: 6, 4: 3, 6: 4, 7: 4, 8: 35, 9: 10}
EDGY = {1: 22, 2: 28, 3: 6, 4: 4, 6: 3, 7: 4, 8: 23, 9: 10}
BIG = {1: 26, 2: 12, 3: 6, 4: 2, 6: 0, 7: 4, 8: 38, 9: 12}

# (seed, [(kind, prefill, q, mix, bursts, drain, kcap), ...]):
#   prefill  (count, seed, span) -> a leading `fill`
#   bursts   list of (count, seed, kmax) -> `burst` commands
#   kcap     the largest k an op-8 query may ask for in this block
#   bigk     explicit op-8 queries with a large k, a few per big block: they
#            are what catches an O(k^2) candidate set, and they are counted
#            rather than random because each one costs the reference k log k
#            random reads into a heap of several hundred thousand elements
PLAN = [
    (6001, [(1, None, 20, MIXED, [(20, 7, 4)], 100, 20, []),
            (2, None, 16, MIXED, [(20, 8, 3)], 100, 20, [])]),
    (6002, [(1, None, 50, EDGY, [(60, 7, 6)], 100, 40, []),
            (2, None, 40, EDGY, [(60, 8, 5)], 100, 40, []),
            (4, None, 30, MIXED, [(40, 9, 4)], 100, 40, [])]),
    (6003, [(3, None, 120, MIXED, [(400, 7, 8)], 400, 60, []),
            (4, None, 90, MIXED, [(300, 8, 10)], 400, 60, []),
            (2, None, 60, EDGY, [(200, 9, 6)], 400, 60, [])]),
    (6004, [(2, (600, 11, 10 ** 6), 200, MIXED, [(1500, 7, 60), (1000, 8, 20)], 400, 300, [599]),
            (4, (400, 12, 10 ** 5), 150, MIXED, [(800, 9, 40)], 400, 200, [399])]),
    # Case 5 is the last case the sort-a-copy version survives, so it is sized
    # to leave that version real headroom (~0.3 s here): the subtask boundary
    # has to hold on a judge box slower than the one this was built on.
    (6005, [(1, (2000, 21, 10 ** 9), 120, MIXED, [(700, 7, 300), (400, 8, 60)], 400, 900, [1999]),
            (3, (1500, 22, 10 ** 9), 100, MIXED, [(300, 9, 150)], 400, 700, [1499])]),
    (6006, [(1, (250000, 31, 10 ** 9), 110, BIG, [(2500, 7, 300), (1500, 8, 60)], 2000, 400,
             [20000, 60000, 100000]),
            (2, (2000, 32, 10 ** 6), 100, MIXED, [(600, 9, 100)], 500, 800, [])]),
    (6007, [(2, (300000, 41, 10 ** 9), 110, BIG, [(2500, 7, 250), (1500, 8, 80)], 2000, 400,
             [25000, 70000, 100000]),
            (4, (3000, 42, 10 ** 5), 100, BIG, [(600, 9, 120)], 500, 900, [])]),
    (6008, [(3, (350000, 51, 10 ** 9), 110, BIG, [(2600, 7, 300), (1600, 8, 60)], 2000, 400,
             [30000, 80000]),
            (1, (3000, 52, 10 ** 6), 100, BIG, [(600, 9, 100)], 500, 900, [])]),
    (6009, [(4, (400000, 61, 10 ** 5), 110, BIG, [(2600, 7, 280), (1600, 8, 70)], 2000, 400,
             [30000, 90000]),
            (2, (4000, 62, 10 ** 9), 100, BIG, [(600, 9, 150)], 500, 1000, [])]),
    (6010, [(1, (450000, 71, 10 ** 9), 110, BIG, [(2800, 7, 320), (1700, 8, 60)], 2000, 400,
             [35000, 100000]),
            (3, (4000, 72, 10 ** 9), 100, BIG, [(600, 9, 200)], 500, 1000, [])]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-1000, 1000), rng.randint(0, 999))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-10 ** 6, 10 ** 6))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict,
          bursts: list, drain: int, kcap: int, bigk: list) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            commands.append("1 " + element(rng, kind))
        elif op == 8:
            # The grader turns this into k = raw % size + 1, so a raw value
            # below the block's k cap keeps the query's k bounded by it.
            commands.append("8 %d" % rng.randrange(kcap))
        elif op == 9:
            # k = 0 and k > size must both throw; a third of these are 0.
            commands.append("9 %d" % (0 if rng.random() < 0.34 else rng.randrange(10 ** 7, 10 ** 8)))
        else:
            commands.append(str(op))

    for raw in bigk:
        commands.append("8 %d" % raw)

    for position, burst in enumerate(bursts):
        where = min(len(commands), 1 + (position + 1) * (len(commands) - 1) // (len(bursts) + 1))
        commands.insert(where, "10 %d %d %d" % burst)

    return ["%d %d %d" % (kind, len(commands), drain)] + commands


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, prefill, count, mix, bursts, drain, kcap, bigk in blocks:
        lines.extend(block(rng, kind, prefill, count, mix, bursts, drain, kcap, bigk))
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
