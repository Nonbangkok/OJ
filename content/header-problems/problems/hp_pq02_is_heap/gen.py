"""Testcase generator for hp_pq02_is_heap.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-3   (30%)  at most 30 elements, int only, every query on a tiny
                       array that is easy to check by hand
    cases 4-6   (30%)  a few hundred elements, adds the min-heap, long long
                       and Item blocks
    cases 7-10  (40%)  up to 30,000 elements built by `fill`, thousands of
                       is_heap() queries on arrays damaged by raw_swap

is_heap() is Theta(n) however it is written, so the big cases bound
(elements x queries) rather than either factor alone and the problem has no
complexity subtask.

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
      7               print is_heap() and the size
      8               print is_heap()
      9 x             raw_push x    (append without fixUp)
      10 i j          raw_swap i j  (exchange two slots)

"""

import os
import random
import sys

CASES = 10

# Weight per opcode. 9 and 10 are the damage: they are what makes half of the
# is_heap() answers false. 6 (copy check) drains a copy of the whole array and
# stays rare for that reason.
MIXED = {1: 24, 2: 12, 3: 6, 4: 3, 6: 4, 7: 3, 8: 22, 9: 12, 10: 14}
EDGY = {1: 22, 2: 26, 3: 8, 4: 4, 6: 3, 7: 3, 8: 18, 9: 8, 10: 8}
BIG = {1: 30, 2: 14, 3: 4, 4: 2, 6: 0, 7: 1, 8: 25, 9: 10, 10: 14}

# (seed, [(kind, prefill, q, mix, drain), ...]); prefill is (count, seed, span)
# or None and becomes a leading `fill` command.
PLAN = [
    (5201, [(1, None, 16, MIXED, 100), (2, None, 14, MIXED, 100)]),
    (5202, [(1, None, 30, EDGY, 100), (2, None, 24, EDGY, 100), (1, None, 20, MIXED, 100)]),
    (5203, [(2, None, 40, MIXED, 100), (1, None, 36, EDGY, 100), (2, None, 24, MIXED, 100)]),
    (5204, [(3, None, 150, MIXED, 400), (4, None, 120, MIXED, 400), (2, None, 80, EDGY, 400)]),
    (5205, [(2, (300, 11, 40), 700, MIXED, 400), (4, (200, 12, 60), 600, MIXED, 400)]),
    (5206, [(1, (900, 21, 1000), 1200, MIXED, 400), (3, (600, 22, 10 ** 9), 1000, MIXED, 400)]),
    (5207, [(1, (8000, 31, 1000), 2000, BIG, 2000), (2, (5000, 32, 50), 1500, BIG, 2000)]),
    (5208, [(2, (14000, 41, 10 ** 6), 2200, BIG, 2000), (4, (7000, 42, 400), 1600, BIG, 2000)]),
    (5209, [(3, (20000, 51, 10 ** 9), 2400, BIG, 3000), (1, (9000, 52, 7), 1800, BIG, 3000)]),
    (5210, [(2, (30000, 61, 10 ** 6), 2600, BIG, 3000), (4, (12000, 62, 1000), 1900, BIG, 3000)]),
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
        if op in (1, 9):
            commands.append("%d %s" % (op, element(rng, kind)))
        elif op == 10:
            # Raw indices; the grader reduces them modulo the current size, so
            # the stream stays valid however many pushes and pops came before.
            commands.append("10 %d %d" % (rng.randrange(10 ** 6), rng.randrange(10 ** 6)))
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
