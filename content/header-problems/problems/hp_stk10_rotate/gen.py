#!/usr/bin/env python3
"""Testcase generator for hp_stk10_rotate.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly ``input01.txt`` ... ``input10.txt`` into that directory and
nothing else, DETERMINISTICALLY (fixed seeds): build.py derives the expected
outputs from these bytes and verify.py compares them again, so a generator
that drifted would silently invalidate every stored output.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks: cases 1-5 are the 50% subtask
(n <= 2,000, q <= 6,000, where rotating the block for real on every call
still fits in the time limit), cases 6-10 the remaining 50%, where it does
not.

Two different jobs, two different shapes:

  * the SMALL cases are about correctness. k jumps around (0, 1, 2, a random
    depth, exactly size, past size) and rotate is interleaved with push, pop,
    top and copy checks — every one of those is a point where deferred work
    has to be flushed, so a solution that defers and forgets fails here.
  * the LARGE cases are about the time bound. They are built as RUNS: a
    couple of thousand rotate commands with the same, large k, then a short
    interlude of other commands, then a new run with a new k. A run of m
    rotates on a block of k elements costs the intended solution O(k + m)
    and a per-call rotation O(k * m), which is the whole separation. The
    stack is kept at most 30,000 elements, as the statement promises, so
    both numbers that have to share `aux` stay small.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" top | "4" size
                     | "5 k" rotate(k) | "6" copy check | "7" fold top
                     | "8" rotate again with the last k
"""

import os
import random
import sys

CASES = 10

# Weight per opcode 1..7, small cases only.
#   1 push, 2 pop, 3 top, 4 size, 5 rotate(k), 6 copy check, 7 fold top
MIXED = {1: 18, 2: 14, 3: 14, 4: 4, 5: 32, 6: 8, 7: 10}
# Tiny stacks: k = 0, 1, size and size + 1 are nearly the same values here,
# and the stack keeps running dry.
EDGY = {1: 24, 2: 28, 3: 16, 4: 4, 5: 24, 6: 4, 7: 0}

COPY_CHECK_MAX_N = 300
# The statement's ceiling on the number of elements. Both numbers packed
# into aux have to stay below 32,768 for the usual block * 65536 + shift
# encoding, so the stack is never allowed to grow past this.
SIZE_CEILING = 30_000

# (seed, [(kind, n, q, mix | None), ...]). mix None marks a RUN-STRUCTURED
# big block (see big_block).
PLAN = [
    (2001, [(1, 5, 20, MIXED), (2, 4, 16, MIXED)]),
    (2002, [(1, 10, 60, MIXED), (2, 8, 40, MIXED), (3, 6, 30, MIXED)]),
    (2003, [(1, 0, 60, EDGY), (1, 1, 40, EDGY), (2, 3, 60, EDGY)]),
    (2004, [(1, 300, 1500, MIXED), (2, 200, 900, EDGY)]),
    (2005, [(1, 2000, 6000, MIXED), (3, 1200, 3000, MIXED), (2, 300, 900, EDGY)]),
    (2006, [(1, 30000, 220000, None), (2, 300, 900, EDGY)]),
    (2007, [(3, 30000, 220000, None), (1, 400, 1200, EDGY)]),
    (2008, [(2, 20000, 180000, None), (1, 400, 1200, EDGY)]),
    (2009, [(1, 30000, 220000, None), (3, 500, 1500, EDGY)]),
    (2010, [(3, 30000, 220000, None), (2, 600, 1800, EDGY)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    """One stack element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def span(rng: random.Random, size: int) -> int:
    """A k for rotate(k) in the small cases: the edge values on purpose."""
    roll = rng.random()
    if roll < 0.10:
        return 0
    if roll < 0.20:
        return 1
    if roll < 0.32:
        return size
    if roll < 0.40:
        return size + 1
    if roll < 0.46:
        return rng.randint(1_000_000, 4_000_000_000)
    return rng.randint(0, size + 2) if size > 0 else 0


def small_block(rng: random.Random, kind: int, n: int, count: int, mix: dict) -> list[str]:
    usable = dict(mix)
    if n > COPY_CHECK_MAX_N:
        usable[6] = 0
    ops = [op for op, weight in usable.items() if weight > 0]
    weights = [usable[op] for op in ops]

    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n
    for _ in range(count):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1 and size >= SIZE_CEILING:
            op = 2
        if op == 1:
            lines.append("1 " + element(rng, kind))
            size += 1
        elif op == 2:
            lines.append("2")
            size = max(size - 1, 0)
        elif op == 5:
            lines.append("5 %d" % span(rng, size))
        else:
            lines.append(str(op))
    return lines


def big_block(rng: random.Random, kind: int, n: int, count: int) -> list[str]:
    """Long runs of the same large k, separated by short interludes.

    Inside a run nothing changes the stack, so the intended solution pays for
    the block once and then answers every rotate in O(1); the interludes are
    where it has to flush. k is always <= the current size, so a run really
    is one block and not a new one per command.
    """
    lines = ["%d %d %d" % (kind, n, count)]
    lines.append(" ".join(element(rng, kind) for _ in range(n)))

    size = n
    emitted = 0
    while emitted < count:
        low = max(2, (size * 3) // 4)
        k = rng.randint(low, size) if size >= 2 else 0
        run = min(rng.randint(1200, 2600), count - emitted)
        # The first command of a run carries k; the rest are the two-byte
        # "same k again" command, so the bulk of the work costs almost no
        # archive bytes.
        lines.append("5 %d" % k)
        emitted += 1
        for _ in range(run - 1):
            lines.append("8")
            emitted += 1
        # Interlude: the commands that force a flush, plus the edge k values.
        for _ in range(rng.randint(2, 5)):
            if emitted >= count:
                break
            roll = rng.random()
            if roll < 0.22 and size < SIZE_CEILING:
                lines.append("1 " + element(rng, kind))
                size += 1
            elif roll < 0.44:
                lines.append("2")
                size = max(size - 1, 0)
            elif roll < 0.56:
                lines.append("5 %d" % rng.choice([0, 1, size, size + 1]))
            elif roll < 0.68:
                lines.append("3")
            elif roll < 0.74:
                lines.append("4")
            else:
                lines.append("7")
            emitted += 1
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, count, mix in blocks:
        if mix is None:
            lines.extend(big_block(rng, kind, n, count))
        else:
            lines.extend(small_block(rng, kind, n, count, mix))
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
