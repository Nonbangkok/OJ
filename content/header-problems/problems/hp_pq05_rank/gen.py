"""Testcase generator for hp_pq05_rank.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-3   (30%)  a handful of elements, int only
    cases 4-6   (30%)  a few hundred elements, adds the min-heap, long long
                       and Item blocks
    cases 7-10  (40%)  up to 20,000 elements built by `fill`, with hundreds of
                       rank() queries each

rank() is Omega(n) in the worst case however it is written (its answer can be
n-1), so the big cases bound (elements x queries) rather than either factor
alone and the problem has no complexity subtask.

Value spans are small in several blocks so that equally important elements are
everywhere: that is what separates `mLess(x, y)` from `!mLess(y, x)`.

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
      8 i             print rank(i % size)
      9 i             print rank(i), which usually throws
      10 i            print is_top(i % size)

"""

import os
import random
import sys

CASES = 10

# Weight per opcode. 8 is the hot one; 9 (the out-of-range probe) and 10 keep
# the strictness of the comparison under pressure.
MIXED = {1: 26, 2: 14, 3: 6, 4: 3, 6: 4, 7: 3, 8: 28, 9: 6, 10: 10}
EDGY = {1: 24, 2: 28, 3: 8, 4: 4, 6: 3, 7: 3, 8: 18, 9: 6, 10: 6}
BIG = {1: 30, 2: 16, 3: 4, 4: 2, 6: 0, 7: 1, 8: 35, 9: 4, 10: 8}

# (seed, [(kind, prefill, q, mix, drain), ...]); prefill is (count, seed, span)
# or None and becomes a leading `fill` command.
PLAN = [
    (5501, [(1, None, 18, MIXED, 100), (2, None, 14, MIXED, 100)]),
    (5502, [(1, None, 40, EDGY, 100), (2, None, 30, EDGY, 100), (1, None, 24, MIXED, 100)]),
    (5503, [(2, None, 60, MIXED, 100), (1, None, 40, EDGY, 100), (2, None, 30, MIXED, 100)]),
    (5504, [(3, None, 150, MIXED, 400), (4, None, 120, MIXED, 400), (2, None, 90, EDGY, 400)]),
    (5505, [(2, (400, 11, 20), 900, MIXED, 400), (4, (300, 12, 40), 700, MIXED, 400)]),
    (5506, [(1, (1200, 21, 60), 1400, MIXED, 400), (3, (900, 22, 10 ** 9), 1000, MIXED, 400)]),
    (5507, [(1, (9000, 31, 300), 1400, BIG, 1500), (2, (5000, 32, 20), 1000, BIG, 1500)]),
    (5508, [(2, (13000, 41, 10 ** 6), 1400, BIG, 1500), (4, (7000, 42, 60), 1000, BIG, 1500)]),
    (5509, [(3, (17000, 51, 10 ** 9), 1400, BIG, 2000), (1, (9000, 52, 7), 1000, BIG, 2000)]),
    (5510, [(2, (20000, 61, 400), 1500, BIG, 2000), (4, (11000, 62, 1000), 1000, BIG, 2000)]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-20, 20), rng.randint(0, 3))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    # A narrow range even in the tiny cases: ties are the whole point of this
    # problem, so case 1 already has to contain some.
    return str(rng.randint(-7, 7))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict, drain: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            commands.append("1 " + element(rng, kind))
        elif op in (8, 10):
            # Raw indices: the grader reduces them modulo the current size, so
            # the stream stays valid however many pushes and pops came before.
            commands.append("%d %d" % (op, rng.randrange(10 ** 6)))
        elif op == 9:
            # Mostly out of range on purpose, sometimes (small i) not.
            commands.append("9 %d" % (rng.randrange(40) if rng.random() < 0.3
                                      else rng.randrange(10 ** 5, 10 ** 6)))
        else:
            commands.append(str(op))

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
