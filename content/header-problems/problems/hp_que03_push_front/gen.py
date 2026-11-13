#!/usr/bin/env python3
"""Testcase generator for hp_que03_push_front.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-4 are the 40%
subtask (hand-checkable sizes, including an empty and a one-element queue),
cases 5-7 the next 30% (n up to 2,000), cases 8-10 the last 30% (n up to
40,000). This problem has no complexity subtask, so the big cases are about
scale, not speed.

The generator simulates the ring (see Ring below) so it can place commands on
the two states this problem is about and ASSERT that it reached them:

  * push_front while mFront == 0, where the new slot has to wrap to mCap - 1
    (writing `mFront - 1` on a size_t gives a huge number instead);
  * push_front on a ring that is exactly full, where ensureCapacity re-packs
    the elements and resets mFront, so a slot computed before the call is
    stale.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n
    q command lines: "1 x" push | "2" pop | "3" front | "4" back
                     | "5 x" push_front | "6" size | "7" copy check
                     | "8" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profiles: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 push_front, 6 size, 7 copy, 8 digest
TINY = {1: 18, 2: 16, 3: 12, 4: 10, 5: 28, 6: 6, 7: 8, 8: 2}
EDGY = {1: 20, 2: 30, 3: 10, 4: 8, 5: 24, 6: 4, 7: 4, 8: 0}
MIXED = {1: 20, 2: 18, 3: 8, 4: 7, 5: 34, 6: 4, 7: 7, 8: 2}
BIG = {1: 24, 2: 24, 3: 2, 4: 2, 5: 45, 6: 1, 7: 0, 8: 1}

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
    (1301, [(1, 3, 16, TINY), (2, 2, 12, TINY)]),
    (1302, [(1, 0, 20, EDGY), (1, 1, 16, EDGY), (3, 2, 16, EDGY)]),
    (1303, [(1, 8, 44, MIXED), (2, 6, 30, MIXED), (3, 5, 24, TINY)]),
    (1304, [(1, 16, 90, MIXED), (2, 12, 70, MIXED), (3, 9, 60, EDGY)]),
    (1305, [(1, 300, 1500, MIXED), (2, 200, 1200, MIXED)]),
    (1306, [(1, 2000, 4000, MIXED), (3, 1200, 2500, MIXED)]),
    (1307, [(2, 1500, 3000, MIXED), (1, 2000, 6000, EDGY)]),
    (1308, [(1, 25000, 50000, BIG), (2, 2000, 4000, MIXED)]),
    (1309, [(3, 25000, 60000, BIG), (1, 20000, 40000, BIG)]),
    (1310, [(1, 40000, 100000, BIG), (2, 10000, 25000, BIG), (3, 8000, 20000, MIXED)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping.

    mCap / mSize / mFront evolve exactly as queue.h keeps them: capacity 1,
    doubling through ensureCapacity, expand() re-packing from slot 0 and
    resetting mFront. push_front is modelled the way the reference does it,
    which is what lets the generator recognise the interesting states.
    """

    def __init__(self) -> None:
        self.cap = 1
        self.size = 0
        self.front = 0

    def _ensure(self, capacity: int) -> bool:
        if capacity > self.cap:
            self.cap = max(capacity, 2 * self.cap)
            self.front = 0
            return True
        return False

    def push(self) -> None:
        self._ensure(self.size + 1)
        self.size += 1

    def push_front(self) -> tuple[bool, bool]:
        """Returns (mFront was 0, the array had to grow) before the write."""
        at_zero = self.front == 0
        grew = self._ensure(self.size + 1)
        self.front = (self.front + self.cap - 1) % self.cap
        self.size += 1
        return at_zero, grew

    def pop(self) -> None:
        if self.size == 0:
            return
        self.front = (self.front + 1) % self.cap
        self.size -= 1

    @property
    def full(self) -> bool:
        return self.size == self.cap


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


class Counters:
    def __init__(self) -> None:
        self.at_zero = 0
        self.grew = 0


def primer(rng: random.Random, ring: Ring, kind: int, n: int, hits: Counters) -> list[str]:
    """Force both interesting push_front states, back to back.

    After n pushes mFront is 0, so the very first push_front here is the
    "wrap to mCap - 1" case. Filling the ring to exactly mCap and pushing
    once more is the "ensureCapacity moves everything" case.
    """
    commands: list[str] = []
    commands.append("5 " + element(rng, kind))
    at_zero, grew = ring.push_front()
    hits.at_zero += int(at_zero)
    hits.grew += int(grew)
    commands.append("3")
    commands.append("4")

    while not ring.full:
        commands.append("1 " + element(rng, kind))
        ring.push()
    commands.append("5 " + element(rng, kind))
    at_zero, grew = ring.push_front()
    hits.at_zero += int(at_zero)
    hits.grew += int(grew)
    commands.append("8")
    return commands


def block(rng: random.Random, kind: int, n: int, budget: int, mix: dict,
          hits: Counters) -> list[str]:
    ring = Ring()
    elements = [element(rng, kind) for _ in range(n)]
    for _ in range(n):
        ring.push()

    commands = primer(rng, ring, kind, n, hits)

    ops = sorted(mix)
    weights = [mix[op] for op in ops]
    digests = sum(1 for line in commands if line == "8")
    while len(commands) < budget:
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
            commands.append("5 " + element(rng, kind))
            at_zero, grew = ring.push_front()
            hits.at_zero += int(at_zero)
            hits.grew += int(grew)
        else:
            commands.append(str(op))

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
    # Self-check: both traps have to be present, or the case does not test
    # what the statement says it tests.
    if hits.at_zero == 0:
        raise RuntimeError("case %d never calls push_front with mFront == 0" % (index + 1))
    if hits.grew == 0:
        raise RuntimeError("case %d never calls push_front on a full ring" % (index + 1))
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
