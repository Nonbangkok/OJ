#!/usr/bin/env python3
"""Testcase generator for hp_que10_merge.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else. It must be DETERMINISTIC (fixed seeds),
because build.py re-derives the expected outputs from these bytes and
verify.py compares them again; a generator that drifts would silently
invalidate every stored output.

Cases are ordered SMALLEST FIRST so that the judge's stop-on-first-failure
prefix score reproduces the statement's subtasks: cases 1-5 are the 50%
subtask (queues of at most a couple of thousand elements, so even a merge
that regrows the array once per element passes), cases 6-10 the remaining
50%, where it cannot.

The large blocks are SCRIPTED rather than random, because the states that
matter here cannot be reached by chance at a sensible number of commands.
Each one walks the two rings through, in order:

  1. the source wrapped around the end of its own array, and the destination's
     free run starting late enough that the copy has to wrap too — both sides
     wrapping at once, with different mCap;
  2. a merge into a destination whose own data is wrapped, small enough that
     no reallocation happens, so the copy writes into the gap before mFront;
  3. the big one: 16,000 elements into 32,000, which is what the naive
     "regrow for every element" version dies on;
  4. a merge in the other direction into a queue that was just emptied, and
     one whose source is empty, which must change nothing.

The Ring class below mirrors queue.h's bookkeeping exactly, so the generator
can assert that each of those states really happened, and can add up what the
two implementations would pay.

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n0 n1 q    kind: 1 = int, 2 = std::string, 3 = long long
    a_1 ... a_n0    into queue 0
    b_1 ... b_n1    into queue 1
    q command lines, each naming a queue s: "1 s x" push | "2 s" pop
                     | "3 s" front | "4 s" back | "5 s" merge(other into s)
                     | "6 s" size | "7 s" copy check | "8 s" digest
"""

import os
import random
import sys

CASES = 10

# Command-mix profile for the small blocks: weight per opcode.
#   1 push, 2 pop, 3 front, 4 back, 5 merge, 6 size, 7 copy, 8 digest
SMALL_MIX = {1: 30, 2: 14, 3: 10, 4: 10, 5: 6, 6: 6, 7: 6, 8: 4}

# `copy` prints the whole copied queue, so it is only affordable on small
# queues; above this size the generator picks another command instead.
COPY_CHECK_MAX = 300

# `digest` costs the REFERENCE O(size) per call, so each block gets a budget.
DIGESTS_PER_BLOCK = 10

# Elements the REFERENCE may copy for the merges of one small block. Without
# a cap, a random stream of merges sends the whole pile back and forth between
# the two queues — O(n) for the reference every time, which is legitimate but
# would put the reference's own running time in the same place as the naive
# version's. The scripted large blocks spend their copies where they matter
# instead.
MERGE_WORK_BUDGET = 200_000

# Element writes the NAIVE merge may be made to pay inside one small block.
# The small subtask exists so that a correct-but-quadratic merge still scores
# 50%, so the small cases have to stay comfortably inside its budget: the
# random stream of merges is quadratic for it, and a pile bouncing between the
# two queues a few dozen times would time it out here instead of at case 6.
NAIVE_BUDGET_PER_SMALL_BLOCK = 6_000_000

# Case plan.
#   small cases: (seed, [(kind, n0, n1, q), ...]) built by small_block
#   large cases: (seed, [(kind, n0, n1, q), ...]) built by big_block
# n0 is chosen so that the capacity (the next power of two) leaves a little
# room above n0, and n1 is a power of two so one pop/push pair is enough to
# wrap the source.
SMALL_PLAN = [
    (2001, [(1, 4, 3, 24), (2, 2, 2, 20)]),
    (2002, [(1, 0, 0, 18), (1, 1, 0, 18), (3, 5, 7, 40)]),
    (2003, [(1, 40, 24, 260), (2, 30, 16, 200)]),
    (2004, [(1, 500, 256, 1500), (3, 300, 128, 900)]),
    (2005, [(1, 1600, 1024, 2500), (2, 700, 512, 1600)]),
]
BIG_PLAN = [
    (2006, [(1, 31500, 2048, 30000), (2, 400, 256, 900)]),
    (2007, [(2, 31500, 2048, 30000), (1, 6000, 1024, 3000)]),
    (2008, [(1, 31000, 2048, 30000), (3, 3000, 512, 2000)]),
    (2009, [(3, 31500, 2048, 29000), (1, 8000, 1024, 3000)]),
    (2010, [(1, 31500, 2048, 30000), (2, 12000, 2048, 4000)]),
]

# The big merge in step 3: how many elements are refilled into the source.
BIG_REFILL = 16000
# Step 2's small merge.
SMALL_REFILL = 200

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


class Ring:
    """A mirror of the header's ring-buffer bookkeeping for one queue."""

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

    def pop(self) -> None:
        if self.size == 0:
            return
        self.front = (self.front + 1) % self.cap
        self.size -= 1

    def absorb(self, other: "Ring") -> None:
        """What the reference merge does to the two rings."""
        if other.size == 0:
            return
        self._ensure(self.size + other.size)
        self.size += other.size
        other.size = 0
        other.front = 0

    @property
    def wrapped(self) -> bool:
        """True when the elements run off the end of the array and continue
        at its start."""
        return self.front + self.size > self.cap

    def straddles(self, m: int) -> bool:
        """True when writing m elements after the back has to wrap around.

        Only meaningful while m fits without a reallocation: expand() re-packs
        everything from slot 0 first, and then nothing wraps.
        """
        if m == 0 or self.size + m > self.cap:
            return False
        start = (self.front + self.size) % self.cap
        return start + m > self.cap


def element(rng: random.Random, kind: int) -> str:
    """One queue element, written the way `std::cin >> value` reads it."""
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 6)))
    return str(rng.randint(-4_000_000_000, 4_000_000_000))


def naive_merge_cost(n: int, m: int) -> int:
    """Element writes the "regrow for every element" merge pays.

    Element number j reallocates to an exact fit of n + j + 1 and copies the
    n + j elements already there, so it is about 2 * (n + j) writes.
    """
    return m * (2 * n + m)


class Counters:
    def __init__(self) -> None:
        self.merges = 0
        self.wrapped_source = 0
        self.wrapped_dest = 0
        self.straddle = 0
        self.empty_source = 0
        self.empty_dest = 0
        self.no_realloc = 0
        self.directions: set[int] = set()
        self.naive_cost = 0
        self.reference_cost = 0


class Block:
    """Command builder for one block, with both rings simulated alongside."""

    def __init__(self, rng: random.Random, kind: int, n0: int, n1: int, hits: Counters) -> None:
        self.rng = rng
        self.kind = kind
        self.hits = hits
        self.rings = [Ring(), Ring()]
        self.elements = [
            [element(rng, kind) for _ in range(n0)],
            [element(rng, kind) for _ in range(n1)],
        ]
        for _ in range(n0):
            self.rings[0].push()
        for _ in range(n1):
            self.rings[1].push()
        self.commands: list[str] = []
        self.digests = 0
        self.merge_work = 0
        self.naive_work = 0

    # --- single commands ---------------------------------------------------

    def push(self, which: int, times: int = 1) -> None:
        for _ in range(times):
            self.commands.append("1 %d %s" % (which, element(self.rng, self.kind)))
            self.rings[which].push()

    def pop(self, which: int, times: int = 1) -> None:
        for _ in range(times):
            self.commands.append("2 %d" % which)
            self.rings[which].pop()

    def query(self, op: int, which: int) -> None:
        self.commands.append("%d %d" % (op, which))

    def digest(self, which: int) -> None:
        self.commands.append("8 %d" % which)
        self.digests += 1

    def merge(self, into: int) -> None:
        source = self.rings[1 - into]
        target = self.rings[into]
        m = source.size
        hits = self.hits
        hits.merges += 1
        hits.directions.add(into)
        if source.wrapped:
            hits.wrapped_source += 1
        if target.wrapped:
            hits.wrapped_dest += 1
        if target.straddles(m):
            hits.straddle += 1
        if m == 0:
            hits.empty_source += 1
        if target.size == 0:
            hits.empty_dest += 1
        if m > 0 and target.size + m <= target.cap:
            hits.no_realloc += 1
        hits.naive_cost += naive_merge_cost(target.size, m)
        hits.reference_cost += m
        self.merge_work += m
        self.naive_work += naive_merge_cost(target.size, m)
        target.absorb(source)
        self.commands.append("5 %d" % into)

    # --- shaping helpers ---------------------------------------------------

    def wrap(self, which: int, limit: int = 20000) -> bool:
        """Pop-then-push until the ring crosses the end of its array.

        A pop moves mFront one slot right and a push puts the element back at
        the far end, so each pair leaves the length alone and pushes
        mFront + mSize one past where it was. Once that sum exceeds mCap the
        queue is wrapped, and it stays wrapped while only pops follow.
        """
        ring = self.rings[which]
        steps = 0
        while not ring.wrapped and steps < limit:
            if ring.size == 0:
                return False
            # The pop first, so the push that follows can never reallocate:
            # after it the length is one below the capacity at worst.
            self.pop(which)
            self.push(which)
            steps += 1
        return ring.wrapped

    def make_straddle(self, into: int, margin: int = 220) -> bool:
        """Pop from the destination until the pending copy has to wrap."""
        target = self.rings[into]
        m = self.rings[1 - into].size
        if m == 0:
            return False
        excess = target.size + m - target.cap
        if excess > 0:
            self.pop(into, excess + margin)
        return target.straddles(m)

    # --- assembly ----------------------------------------------------------

    def finish(self, kind: int, budget: int) -> list[str]:
        lines = ["%d %d %d %d" % (kind, len(self.elements[0]), len(self.elements[1]),
                                  len(self.commands))]
        lines.append(" ".join(self.elements[0]))
        lines.append(" ".join(self.elements[1]))
        lines.extend(self.commands)
        return lines


def big_block(rng: random.Random, kind: int, n0: int, n1: int, budget: int,
              hits: Counters) -> list[str]:
    block = Block(rng, kind, n0, n1, hits)

    # 1. both sides wrapped at once, and the copy itself has to wrap.
    if not block.wrap(1):
        raise RuntimeError("could not wrap the source ring (n1 must be a power of two)")
    if not block.make_straddle(0):
        raise RuntimeError("could not make the destination's copy straddle the array end")
    block.digest(0)
    block.digest(1)
    block.merge(0)
    block.digest(0)

    # 2. a small merge into a destination whose own data is wrapped, with no
    #    reallocation, so the copy lands in the gap that sits before mFront.
    block.push(1, SMALL_REFILL)
    block.wrap(1)
    headroom = block.rings[0].cap - block.rings[0].size
    if block.rings[1].size > headroom:
        raise RuntimeError("step 2 would reallocate: %d elements into %d of headroom"
                           % (block.rings[1].size, headroom))
    block.merge(0)
    block.digest(0)

    # 3. the big one: this is the merge the naive version cannot afford.
    block.push(1, BIG_REFILL)
    block.wrap(1)
    block.merge(0)
    block.digest(0)
    block.query(3, 0)
    block.query(4, 0)
    block.query(6, 0)

    # 4. the other direction, into a queue that was just emptied, then a merge
    #    whose source is empty (which must do nothing at all).
    block.merge(1)
    block.query(6, 0)
    block.query(6, 1)
    block.merge(1)
    block.digest(1)
    block.push(0, 50)
    block.merge(1)
    block.digest(1)

    # 5. whatever is left of the budget goes on cheap queries, split between
    #    the two queues.
    while len(block.commands) < budget:
        which = rng.randint(0, 1)
        roll = rng.random()
        if roll < 0.35:
            block.push(which)
        elif roll < 0.55:
            block.pop(which)
        elif roll < 0.70:
            block.query(3, which)
        elif roll < 0.85:
            block.query(4, which)
        elif roll < 0.95:
            block.query(6, which)
        elif block.digests < DIGESTS_PER_BLOCK:
            block.digest(which)
        else:
            block.query(6, which)

    return block.finish(kind, budget)


def small_block(rng: random.Random, kind: int, n0: int, n1: int, budget: int,
                hits: Counters) -> list[str]:
    block = Block(rng, kind, n0, n1, hits)

    # The same four shapes as the large blocks, at a size that can be checked
    # by hand, and then a random mix on top.
    if block.rings[1].size > 0:
        block.wrap(1)
    block.make_straddle(0, margin=2)
    block.digest(0)
    block.merge(0)
    block.merge(0)  # the same direction twice: the source is empty now, so
                    # this one must change nothing at all
    block.merge(1)  # and the other direction, into a queue just emptied
    block.digest(0)
    block.digest(1)

    ops = sorted(SMALL_MIX)
    weights = [SMALL_MIX[op] for op in ops]
    while len(block.commands) < budget:
        which = rng.randint(0, 1)
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 7 and block.rings[which].size > COPY_CHECK_MAX:
            op = 3
        if op == 8 and block.digests >= DIGESTS_PER_BLOCK:
            op = 6
        if op == 5 and (block.merge_work > MERGE_WORK_BUDGET
                        or block.naive_work > NAIVE_BUDGET_PER_SMALL_BLOCK):
            op = 6
        if op == 1:
            block.push(which)
        elif op == 2:
            block.pop(which)
        elif op == 5:
            block.merge(which)
        elif op == 8:
            block.digest(which)
        else:
            block.query(op, which)

    return block.finish(kind, budget)


def build_case(index: int) -> str:
    big = index >= 5
    seed, blocks = (BIG_PLAN[index - 5] if big else SMALL_PLAN[index])
    rng = random.Random(seed)
    hits = Counters()
    lines = [str(len(blocks))]
    for position, (kind, n0, n1, budget) in enumerate(blocks):
        builder = big_block if (big and position == 0) else small_block
        lines.extend(builder(rng, kind, n0, n1, budget, hits))

    # Self-checks: the shapes the statement promises to test...
    if hits.wrapped_source == 0:
        raise RuntimeError("case %d never merges a wrapped source" % (index + 1))
    if hits.empty_source == 0:
        raise RuntimeError("case %d never merges an empty source" % (index + 1))
    if hits.empty_dest == 0:
        raise RuntimeError("case %d never merges into an empty queue" % (index + 1))
    if hits.directions != {0, 1}:
        raise RuntimeError("case %d does not merge in both directions" % (index + 1))
    if big:
        if hits.wrapped_dest == 0:
            raise RuntimeError("case %d never merges into a wrapped destination" % (index + 1))
        if hits.straddle == 0:
            raise RuntimeError("case %d never makes the copy wrap the array end" % (index + 1))
        if hits.no_realloc == 0:
            raise RuntimeError("case %d never merges without a reallocation" % (index + 1))
        # ... and the complexity subtask really separating the two versions.
        # Measured on the build image: the regrow-per-element merge runs out
        # of its 1000 ms somewhere around 3e8 element writes, so every large
        # case is held to at least three times that.
        if hits.naive_cost < 1_000_000_000:
            raise RuntimeError("case %d gives the naive merge only %d element writes; want >= 1e9"
                               % (index + 1, hits.naive_cost))
        if hits.naive_cost < 100 * max(1, hits.reference_cost):
            raise RuntimeError("case %d does not separate the two implementations: %d vs %d"
                               % (index + 1, hits.naive_cost, hits.reference_cost))
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
