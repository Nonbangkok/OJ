"""Testcase generator for hp_pq08_erase.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-2   (20%)  a few dozen elements, int only, erases that hit and
                       erases that miss, including the last slot and the root
    cases 3-5   (30%)  a few hundred to 1,500 elements, adds the min-heap,
                       long long and Item blocks. From here on the heaps are
                       tall enough that repairing the hole in one direction
                       only is caught
    cases 6-10  (50%)  up to 20,000 elements built by `fill`, with bursts of
                       erases: narrow-span blocks where nearly every erase
                       hits (and duplicates are everywhere) and wide-span
                       blocks where nearly every erase misses

Locating the value is Omega(n) however erase() is written, so the big cases
bound (elements x erases) rather than either factor alone and the problem has
no complexity subtask.

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
      8 x             erase(x), then print the size and the top
      9               erase(top()), then print the size and the top
      10 c s p        burst: c generated erases, then one summary line

"""

import os
import random
import sys

CASES = 10

# Weight per opcode for the hand-written part of a block; the bursts (op 10)
# are placed explicitly.
MIXED = {1: 26, 2: 12, 3: 8, 4: 3, 6: 4, 7: 5, 8: 28, 9: 14}
EDGY = {1: 28, 2: 20, 3: 8, 4: 4, 6: 3, 7: 5, 8: 22, 9: 10}
BIG = {1: 30, 2: 14, 3: 6, 4: 2, 6: 0, 7: 2, 8: 32, 9: 14}

# (seed, [(kind, prefill, q, mix, bursts, drain), ...]):
#   prefill  (count, seed, span) -> a leading `fill`
#   bursts   list of (count, seed, span) -> `burst` commands
PLAN = [
    # The small cases are deliberately erase-dense rather than merely small:
    # repairing the hole in one direction only goes wrong when the slot found
    # is deep and the element that fills it is strong, and that needs a few
    # dozen erases on a heap several levels tall before it shows up.
    (5801, [(1, None, 60, MIXED, [], 100), (2, None, 50, MIXED, [], 100)]),
    (5802, [(1, None, 120, EDGY, [(10, 7, 12)], 100),
            (2, None, 90, EDGY, [(10, 8, 10)], 100),
            (1, None, 60, MIXED, [], 100)]),
    # From case 3 on the heaps are hundreds of elements tall, which is what it
    # takes for a one-directional repair of the hole to be caught: the slot
    # found has to be deep and the element that fills it strong.
    (5803, [(2, (300, 11, 30), 400, MIXED, [(100, 7, 30)], 200),
            (4, (200, 12, 50), 300, MIXED, [(80, 8, 50)], 200)]),
    (5804, [(3, None, 150, MIXED, [(60, 7, 10 ** 9)], 400),
            (4, (300, 13, 60), 300, MIXED, [(100, 8, 60)], 400),
            (2, (200, 14, 20), 200, EDGY, [(60, 9, 20)], 400)]),
    (5805, [(2, (400, 11, 30), 600, MIXED, [(200, 7, 30), (150, 8, 10 ** 6)], 400),
            (4, (300, 12, 50), 500, MIXED, [(150, 9, 50)], 400)]),
    (5806, [(1, (1500, 21, 60), 700, MIXED, [(300, 7, 60), (200, 8, 10 ** 6)], 400),
            (3, (1000, 22, 10 ** 9), 500, MIXED, [(200, 9, 10 ** 9)], 400)]),
    (5807, [(1, (9000, 31, 300), 500, BIG, [(400, 7, 300), (300, 8, 10 ** 9)], 1500),
            (2, (6000, 32, 40), 400, BIG, [(300, 9, 40)], 1500)]),
    (5808, [(2, (13000, 41, 10 ** 6), 500, BIG, [(400, 7, 10 ** 6), (300, 8, 50)], 1500),
            (4, (8000, 42, 80), 400, BIG, [(300, 9, 80)], 1500)]),
    (5809, [(3, (17000, 51, 10 ** 9), 500, BIG, [(400, 7, 10 ** 9), (300, 8, 40)], 2000),
            (1, (9000, 52, 20), 400, BIG, [(300, 9, 20)], 2000)]),
    (5810, [(2, (20000, 61, 400), 500, BIG, [(450, 7, 400), (300, 8, 10 ** 9)], 2000),
            (4, (11000, 62, 1000), 400, BIG, [(300, 9, 1000)], 2000)]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-12, 12), rng.randint(0, 3))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-7, 7))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict,
          bursts: list, drain: int) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op in (1, 8):
            # Op 8 draws its value from the same narrow pool as the pushes, so
            # roughly half of the hand-written erases hit.
            commands.append("%d %s" % (op, element(rng, kind)))
        else:
            commands.append(str(op))

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
