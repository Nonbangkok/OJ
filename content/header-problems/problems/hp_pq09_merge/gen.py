"""Testcase generator for hp_pq09_merge.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds), because build.py re-derives the
expected outputs from these bytes and verify.py compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks.

    cases 1-5   (50%)  merges of at most 1.7 million elements in total per
                       case. Absorbing the other heap with m pushes still
                       passes, and case 5 is the largest case it survives
    cases 6-10  (50%)  one template heap of 262,144 identical elements merged
                       125-138 times. m pushes now need ~6*10^8 element moves
                       per case; the bottom-up build needs ~3 per element

EVERY case from 6 on must defeat the push-by-push version, because the judge
stops at the first failure: if case 6 let it through it would score 60%, not
the 50% the statement promises.

Two things make the big cases work:

  * the operands are built ONCE (commands 8 and 9) and then copied, so what
    the case measures is the merging, not the building. Rebuilding a 500,000
    element heap with push() before every merge would cost the reference just
    as much as the naive merge costs, and the difference would vanish into it.
  * the value span is 2 or 3. Equal elements are what make fixUp climb to the
    root on every single push (its loop breaks only when the parent is
    strictly more important), so the naive version really does pay
    m*log(n+m) rather than the O(m) that random data would give it.

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
      8 c s p         build the restore template (c generated values)
      9 c s p         build the merge template  (c generated values)
      10              restore the working heap from the first template
      11              merge a copy of the second template, then report
      12 c v...       merge a heap built from c values given here
      13              merge an EMPTY heap

"""

import os
import random
import sys

CASES = 10

# Weight per opcode for the hand-written part of a block. Op 12 (merge a small
# explicit heap) is the one that covers the odd shapes; op 13 is the empty
# operand.
MIXED = {1: 22, 2: 12, 3: 8, 4: 4, 6: 4, 7: 5, 12: 35, 13: 10}
EDGY = {1: 20, 2: 26, 3: 8, 4: 4, 6: 3, 7: 5, 12: 24, 13: 10}

# (seed, [(kind, prefill, q, mix, drain, big), ...]):
#   prefill  (count, seed, span) -> a leading `fill`
#   big      None, or (a_count, a_span, b_count, b_span, repeats): build the
#            two templates once, then repeat "restore + merge" `repeats` times
PLAN = [
    (5901, [(1, None, 20, MIXED, 100, None), (2, None, 16, MIXED, 100, None)]),
    (5902, [(1, None, 60, EDGY, 200, None), (2, None, 40, EDGY, 200, None),
            (4, None, 30, MIXED, 200, None)]),
    (5903, [(3, None, 80, MIXED, 400, None), (4, None, 60, MIXED, 400, None),
            (2, None, 40, EDGY, 400, None)]),
    # The heavy blocks are all int: what is being separated is the number of
    # element moves per merge, and a wider element only scales both sides.
    # Two details keep the REFERENCE cheap while the naive version pays:
    #   * the merge template's size is a power of two, so the heap's array is
    #     exactly full and the grader's copy of it costs m rather than ~1.75m;
    #   * its value span is 1 (every element identical) and the destination's
    #     is 2 (one weaker value mixed in). Identical elements never satisfy
    #     fixUp's strict stopping test, so every naive push climbs the full
    #     log2(n+m) levels, while the bottom-up build stays O(n+m).
    (5904, [(2, (2000, 11, 3), 40, MIXED, 400, (1024, 2, 8192, 1, 10)),
            (4, (1000, 12, 20), 30, MIXED, 400, None)]),
    (5905, [(1, (4000, 21, 3), 30, MIXED, 400, (1024, 2, 65536, 1, 25)),
            (3, (2000, 22, 10 ** 9), 20, MIXED, 400, None)]),
    (5906, [(1, None, 12, MIXED, 2000, (1024, 2, 262144, 1, 125)),
            (2, (2000, 32, 5), 20, MIXED, 500, (512, 5, 16384, 1, 8))]),
    (5907, [(2, None, 12, MIXED, 2000, (1024, 2, 262144, 1, 128)),
            (4, (2000, 42, 4), 20, MIXED, 500, None)]),
    (5908, [(1, None, 12, MIXED, 2000, (1024, 2, 262144, 1, 131)),
            (3, (2000, 52, 10 ** 9), 20, MIXED, 500, None)]),
    (5909, [(2, None, 12, MIXED, 2000, (1024, 2, 262144, 1, 134)),
            (4, (2000, 62, 3), 20, MIXED, 500, None)]),
    (5910, [(1, None, 12, MIXED, 2000, (1024, 2, 262144, 1, 138)),
            (3, (2000, 72, 3), 20, MIXED, 500, (512, 3, 16384, 1, 8))]),
]


def element(rng: random.Random, kind: int) -> str:
    """One element, written the way the grader's `std::cin >> value` reads it."""
    if kind == 4:
        return "%d %d" % (rng.randint(-10, 10), rng.randint(0, 3))
    if kind == 3:
        return str(rng.randint(-4 * 10 ** 9, 4 * 10 ** 9))
    return str(rng.randint(-6, 6))


def block(rng: random.Random, kind: int, prefill, count: int, mix: dict,
          drain: int, big) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    commands = []
    if prefill is not None:
        commands.append("5 %d %d %d" % prefill)
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            commands.append("1 " + element(rng, kind))
        elif op == 12:
            # Small explicit heaps: 0, 1, 2 elements and a handful more, so the
            # edge shapes are all covered.
            size = rng.choice([0, 1, 1, 2, 2, 3, 5, 8, 13])
            parts = ["12 %d" % size] + [element(rng, kind) for _ in range(size)]
            commands.append(" ".join(parts))
        else:
            commands.append(str(op))

    if big is not None:
        a_count, a_span, b_count, b_span, repeats = big
        heavy = ["8 %d %d %d" % (a_count, 101, a_span),
                 "9 %d %d %d" % (b_count, 202, b_span)]
        for _ in range(repeats):
            heavy.append("10")
            heavy.append("11")
        # The heavy part goes first, so the hand-written commands afterwards
        # keep working on the heap the last merge produced.
        commands = heavy + commands

    return ["%d %d %d" % (kind, len(commands), drain)] + commands


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, prefill, count, mix, drain, big in blocks:
        lines.extend(block(rng, kind, prefill, count, mix, drain, big))
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
