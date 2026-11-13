"""Testcase generator for hp_pq07_update.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-5   (50%)  up to 20,000 elements and a few thousand updates.
                       Rebuilding the whole heap on every update still passes,
                       and case 5 is the largest case it survives
    cases 6-10 (50%)   150,000 to 300,000 elements built by `fill`, with the
                       same number of updates: a rebuild now needs >10^9
                       element moves, the intended repair ~18 steps each

EVERY case from 6 on must defeat the rebuild, because the judge stops at the
first failure: if case 6 let it through the naive version would score 60%,
not the 50% the statement promises.

The update VALUES come from the same span as the elements, so about half the
updates have to sift up and half have to sift down; several blocks use a
narrow span as well, which puts equally important parents and children next to
each other and separates a strict comparison from a non-strict one.

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
      8 i x           update(i % size, x)
      9 i x           update(i, x), which usually throws
      10 c s p        burst: c generated updates, then one summary line

"""

import os
import random
import sys

CASES = 10

# Weight per opcode for the hand-written part of a block; the bursts (op 10)
# are placed explicitly, because their size is what the subtasks are made of.
MIXED = {1: 24, 2: 14, 3: 10, 4: 3, 6: 4, 7: 5, 8: 28, 9: 6}
EDGY = {1: 22, 2: 26, 3: 10, 4: 4, 6: 3, 7: 5, 8: 20, 9: 8}
BIG = {1: 26, 2: 16, 3: 8, 4: 2, 6: 0, 7: 2, 8: 36, 9: 6}

# (seed, [(kind, prefill, q, mix, bursts, drain), ...]):
#   prefill  (count, seed, span) -> a leading `fill`
#   bursts   list of (count, seed, span) -> `burst` commands spread through
#            the block, which is where the complexity subtask lives
PLAN = [
    (5701, [(1, None, 20, MIXED, [(30, 7, 50)], 100),
            (2, None, 16, MIXED, [(20, 8, 20)], 100)]),
    (5702, [(1, None, 44, EDGY, [(120, 7, 40)], 100),
            (2, None, 30, EDGY, [(80, 8, 15)], 100),
            (4, None, 24, MIXED, [(60, 9, 30)], 100)]),
    (5703, [(3, None, 150, MIXED, [(1500, 7, 10 ** 9)], 400),
            (4, None, 120, MIXED, [(1200, 8, 60)], 400),
            (2, None, 90, EDGY, [(800, 9, 25)], 400)]),
    (5704, [(2, (3000, 11, 10 ** 6), 500, MIXED, [(2000, 7, 10 ** 6), (1500, 8, 40)], 500),
            (4, (2000, 12, 10 ** 5), 400, MIXED, [(1200, 9, 10 ** 5)], 500)]),
    # Case 5 is the last case the rebuild survives, so it is sized to leave
    # that version real headroom (~0.25 s here): the boundary has to hold on a
    # judge box slower than the one the content was built on.
    (5705, [(1, (12000, 21, 10 ** 6), 500, MIXED, [(2000, 7, 10 ** 6), (1200, 8, 30)], 1000),
            (3, (8000, 22, 10 ** 9), 400, MIXED, [(1000, 9, 10 ** 9)], 1000)]),
    (5706, [(1, (200000, 31, 10 ** 6), 400, BIG, [(3000, 7, 10 ** 6), (2000, 8, 30)], 2000),
            (2, (8000, 32, 10 ** 6), 300, MIXED, [(1000, 9, 40)], 1000)]),
    (5707, [(2, (220000, 41, 10 ** 9), 400, BIG, [(3000, 7, 10 ** 9), (2000, 8, 25)], 2000),
            (4, (40000, 42, 10 ** 5), 300, BIG, [(1200, 9, 10 ** 5)], 1000)]),
    (5708, [(3, (250000, 51, 10 ** 9), 400, BIG, [(3200, 7, 10 ** 9), (2000, 8, 20)], 2000),
            (1, (40000, 52, 10 ** 6), 300, BIG, [(1200, 9, 50)], 1000)]),
    (5709, [(4, (260000, 61, 10 ** 5), 400, BIG, [(3200, 7, 10 ** 5), (2000, 8, 30)], 2000),
            (2, (50000, 62, 10 ** 6), 300, BIG, [(1200, 9, 10 ** 6)], 1000)]),
    (5710, [(1, (300000, 71, 10 ** 6), 400, BIG, [(3400, 7, 10 ** 6), (2200, 8, 15)], 2000),
            (3, (60000, 72, 10 ** 9), 300, BIG, [(1400, 9, 10 ** 9)], 1000)]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-1000, 1000), rng.randint(0, 20))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-20, 20))


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
        elif op == 8:
            commands.append("8 %d %s" % (rng.randrange(10 ** 6), element(rng, kind)))
        elif op == 9:
            index = rng.randrange(40) if rng.random() < 0.3 else rng.randrange(10 ** 7, 10 ** 8)
            commands.append("9 %d %s" % (index, element(rng, kind)))
        else:
            commands.append(str(op))

    # Spread the bursts through the block so each one meets a different heap.
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
