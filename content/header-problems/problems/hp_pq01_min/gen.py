"""Testcase generator for hp_pq01_min.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-2   (20%)  at most a handful of elements, int only
    cases 3-5   (30%)  adds long long and the Item type, a few hundred
                       elements, and the empty-heap edge
    cases 6-10  (50%)  up to 20,000 elements built by `fill`, thousands of
                       min() calls interleaved with push/pop

min() is Theta(n) by nature, so the big cases bound (elements x min calls)
rather than either factor alone: the reference stays around 10^7 comparisons
per case, which is also why this problem has no complexity subtask.

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
      8               print min()
      9               print all_equal()

"""

import os
import random
import sys

CASES = 10

# Weight per opcode. 8 (min) is the hot one; 6 (copy check) is rare because it
# drains a copy of the whole heap and would otherwise dominate the reference.
MIXED = {1: 30, 2: 16, 3: 10, 4: 4, 6: 4, 7: 4, 8: 26, 9: 6}
EDGY = {1: 20, 2: 34, 3: 12, 4: 6, 6: 3, 7: 3, 8: 18, 9: 4}
BIG = {1: 42, 2: 20, 3: 5, 4: 2, 6: 0, 7: 1, 8: 27, 9: 3}

# (seed, [(kind, prefill, q, mix, drain), ...]); prefill is (count, seed, span)
# or None and becomes a leading `fill` command.
PLAN = [
    (5101, [(1, None, 14, MIXED, 100), (2, None, 12, MIXED, 100)]),
    (5102, [(1, None, 40, EDGY, 100), (2, None, 30, EDGY, 100), (1, None, 20, MIXED, 100)]),
    (5103, [(3, None, 120, MIXED, 400), (4, None, 100, MIXED, 400), (2, None, 60, EDGY, 400)]),
    (5104, [(2, (300, 11, 40), 900, MIXED, 400), (4, (200, 12, 60), 700, MIXED, 400)]),
    (5105, [(1, (900, 21, 1000), 1500, MIXED, 400), (3, (600, 22, 10 ** 9), 1200, MIXED, 400)]),
    (5106, [(1, (6000, 31, 1000), 2600, BIG, 2000), (2, (4000, 32, 50), 1800, BIG, 2000)]),
    (5107, [(2, (9000, 41, 10 ** 6), 2800, BIG, 2000), (4, (5000, 42, 400), 1800, BIG, 2000)]),
    (5108, [(3, (12000, 51, 10 ** 9), 3000, BIG, 2000), (1, (6000, 52, 7), 2000, BIG, 2000)]),
    (5109, [(1, (16000, 61, 10 ** 6), 3200, BIG, 3000), (4, (8000, 62, 1000), 2200, BIG, 3000)]),
    (5110, [(2, (20000, 71, 10 ** 9), 3400, BIG, 3000), (3, (10000, 72, 3), 2400, BIG, 3000)]),
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
