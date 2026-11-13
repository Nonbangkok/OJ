#!/usr/bin/env python3
"""Testcase generator for hp_que04_pop_back.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-4 are the 40%
subtask (hand-checkable sizes), cases 5-7 the next 30% (n up to 2,000),
cases 8-10 the last 30% (n up to 50,000). This problem has no complexity
subtask, so the big cases are about scale, not speed.

The generator simulates the ring and COUNTS the two states that matter, then
refuses to write a case that missed them:

  * pop_back on an already empty queue (the grader does not guard it, so an
    implementation without the `mSize == 0` check wraps mSize to 2^64 - 1);
  * a queue emptied by pop_back and then refilled, which is where a solution
    that moved mFront instead of shortening the queue falls apart.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5" pop_back | "6" size | "7" copy check | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 pop_back, 6 size, 7 copy, 8 digest
TINY = {1: 24, 2: 10, 3: 12, 4: 12, 5: 26, 6: 6, 7: 8, 8: 2}
EDGY = {1: 18, 2: 14, 3: 10, 4: 10, 5: 40, 6: 4, 7: 4, 8: 0}
MIXED = {1: 28, 2: 12, 3: 8, 4: 8, 5: 32, 6: 4, 7: 6, 8: 2}
BIG = {1: 34, 2: 12, 3: 2, 4: 2, 5: 47, 6: 1, 7: 0, 8: 1}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call — it is the only command here
# that is not O(1) — so each block gets a hard budget of them.
DIGESTS_PER_BLOCK = 12

# Case plan: (seed, [(kind, n, q, mix), ...]). Kind 1 = int, 2 = string,
# 3 = long long — every case but the degenerate one exercises at least two
# different T, which is what breaks an int-only student.h.
PLAN = [
    (1401, [(1, 3, 16, TINY), (2, 2, 14, TINY)]),
    (1402, [(1, 0, 20, EDGY), (1, 1, 16, EDGY), (3, 2, 16, EDGY)]),
    (1403, [(1, 8, 44, MIXED), (2, 6, 30, MIXED), (3, 5, 24, TINY)]),
    (1404, [(1, 16, 90, MIXED), (2, 12, 70, MIXED), (3, 9, 60, EDGY)]),
    (1405, [(1, 300, 1500, MIXED), (2, 200, 1200, EDGY)]),
    (1406, [(1, 2000, 4000, MIXED), (3, 1200, 2500, MIXED)]),
    (1407, [(2, 1500, 3000, MIXED), (1, 2000, 6000, EDGY)]),
    (1408, [(1, 60000, 150000, BIG), (2, 2000, 4000, MIXED)]),
    (1409, [(2, 60000, 150000, BIG), (1, 40000, 60000, BIG)]),
    (1410, [(1, 60000, 150000, BIG), (3, 20000, 30000, BIG), (2, 8000, 20000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    Only the counters the generator needs: how many elements the queue holds
    and whether mFront has drifted away from 0 (it must NOT move when
    pop_back runs, and a block whose mFront never moved would not notice a
    solution that pops the front instead).
    """

    def __init__(self) -> None:
        self.cap = 1
        self.size = 0
        self.front = 0

    def push(self) -> None:
        if self.size + 1 > self.cap:
            self.cap = max(self.size + 1, 2 * self.cap)
            self.front = 0
        self.size += 1

    def pop(self) -> None:
        if self.size == 0:
            return
        self.front = (self.front + 1) % self.cap
        self.size -= 1

    def pop_back(self) -> bool:
        """Returns True when the call lands on an already empty queue."""
        if self.size == 0:
            return True
        self.size -= 1
        return False

    @property
    def wrapped(self) -> bool:
        return self.front + self.size > self.cap


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


class Counters:
    def __init__(self) -> None:
        self.on_empty = 0
        self.refills = 0
        self.wrapped = 0


def drain_and_refill(rng: random.Random, ring: Ring, kind: int, n: int,
                     hits: Counters) -> list[str]:
    """pop_back all the way to empty, three times past it, then start over.

    This is the shape the statement promises: emptied by pop_back, called
    again on the empty queue, then pushed into and used normally.
    """
    commands: list[str] = []
    # A few pops first, so mFront is not 0 while pop_back runs.
    for _ in range(min(3, ring.size)):
        commands.append("2")
        ring.pop()
    guard = 0
    while ring.size > 0 and guard < 4 * n + 16:
        commands.append("5")
        ring.pop_back()
        guard += 1
    for _ in range(3):
        commands.append("5")
        hits.on_empty += int(ring.pop_back())
    commands.append("6")
    commands.append("3")
    for _ in range(4):
        commands.append("1 " + element(rng, kind))
        ring.push()
    commands.append("4")
    commands.append("8")
    hits.refills += 1
    return commands


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict,
          hits: Counters) -> list[str]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    # Every block, big or small, is taken past empty once in the middle: the
    # random mix works the full-size queue first, then pop_back drains it,
    # overshoots, and the queue is refilled and used again.
    commands: list[str] = []
    digests = 0

    def random_mix(until: int) -> None:
        nonlocal digests
        ops = sorted(mix)
        weights = [mix[op] for op in ops]
        while len(commands) < until:
            op = rng.choices(ops, weights=weights, k=1)[0]
            if op == 8 and ring.size == 0:
                op = 1
            if op == 7 and ring.size > COPY_CHECK_MAX:
                op = 3
            if op == 8:
                if digests >= DIGESTS_PER_BLOCK:
                    op = 4
                else:
                    digests += 1
            if op == 1:
                commands.append("1 " + element(rng, kind))
                ring.push()
            elif op == 2:
                commands.append("2")
                ring.pop()
            elif op == 5:
                commands.append("5")
                if ring.pop_back():
                    hits.on_empty += 1
            else:
                commands.append(str(op))
                if op == 4 and ring.wrapped:
                    hits.wrapped += 1

    # The drain sits late in the block on purpose: everything after it works
    # on a queue that was just refilled to a handful of elements, which is
    # cheap for every implementation, so the long-queue phase should have the
    # bulk of the commands.
    random_mix(max(1, (budget * 4) // 5))
    commands.extend(drain_and_refill(rng, ring, kind, n, hits))
    digests = sum(1 for line in commands if line == "8")
    random_mix(budget)

    lines = ["%d %d %d" % (kind, n, len(commands))]
    lines.append(" ".join(elements))
    lines.extend(commands)
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    hits = Counters()
    lines = [str(len(blocks))]
    for kind, n, budget, mix in blocks:
        lines.extend(block(rng, kind, n, budget, mix, hits))
    if hits.on_empty == 0:
        raise RuntimeError("case %d never calls pop_back on an empty queue" % (index + 1))
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
