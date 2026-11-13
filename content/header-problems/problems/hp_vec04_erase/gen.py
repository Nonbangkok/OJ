#!/usr/bin/env python3
"""Testcase generator for hp_vec04_erase.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

Cases 1-3 (30%) are tiny and print every element, 4-6 (30%) are mid-sized,
7-10 (40%) work on up to 100,000 elements.

Two things this generator is careful about:

  * POSITIONS. Random positions mostly land in the middle, which is the easy
    case. It therefore aims them explicitly at 0, at size-1, at the middle, at
    size (the first out-of-range value) and far beyond — so an off-by-one in
    the shift, or an out-of-range call treated as "erase the last element",
    cannot survive.
  * WORK. erase is Theta(n - pos) by design, so the large cases cannot be "a
    million erases". The generator carries a work budget (element moves spent)
    and sizes every bulk erase against what is left of it, which is the bound
    the statement's last subtask quotes. `10 k pos` erases k times at the same
    position, so one short line buys a lot of movement.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   2 erase one, 3 print one, 4 bulk push_back, 5 resize, 6 clear,
#   7 copy check, 8 digest, 9 print everything, 10 bulk erase at one position
SMALL = {2: 26, 3: 12, 4: 18, 5: 8, 6: 4, 7: 8, 8: 12, 9: 6, 10: 10}
MID = {2: 28, 3: 10, 4: 20, 5: 8, 6: 3, 7: 6, 8: 14, 9: 2, 10: 14}
BIG = {2: 26, 3: 10, 4: 22, 5: 6, 6: 1, 7: 3, 8: 14, 9: 0, 10: 22}

POSITIONS = [
    ("front", 16),
    ("last", 14),
    ("middle", 28),
    ("random", 18),
    ("at_size", 12),
    ("beyond", 12),
]

PLAN = [
    (1401, [(1, 4, 16, SMALL, 400), (2, 3, 14, SMALL, 400)]),
    (1402, [(1, 0, 14, SMALL, 400), (1, 1, 16, SMALL, 400), (3, 2, 14, SMALL, 400)]),
    (1403, [(1, 10, 24, SMALL, 2000), (2, 8, 20, SMALL, 2000), (3, 9, 20, SMALL, 2000)]),
    (1404, [(1, 400, 70, MID, 200_000), (2, 150, 40, MID, 60_000)]),
    (1405, [(1, 1500, 110, MID, 1_500_000), (3, 1200, 80, MID, 1_200_000)]),
    (1406, [(1, 2000, 140, MID, 3_000_000), (2, 400, 50, MID, 200_000), (3, 1800, 90, MID, 2_500_000)]),
    (1407, [(1, 40000, 80, BIG, 8_000_000), (2, 2000, 40, MID, 400_000)]),
    (1408, [(1, 80000, 90, BIG, 12_000_000), (3, 40000, 60, BIG, 8_000_000)]),
    (1409, [(1, 100000, 100, BIG, 14_000_000), (2, 5000, 40, MID, 600_000), (3, 60000, 60, BIG, 8_000_000)]),
    (1410, [(1, 100000, 110, BIG, 16_000_000), (3, 100000, 80, BIG, 14_000_000), (2, 6000, 40, MID, 700_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 5)))
    return str(rng.randint(-2_000_000_000, 2_000_000_000))


class Simulator:
    """Mirrors the header's growth rule so the generator knows the cost (and
    the valid position range) of every command it emits."""

    def __init__(self) -> None:
        self.size = 0
        self.cap = 1

    def ensure(self, wanted: int) -> None:
        if wanted > self.cap:
            self.cap = wanted if wanted > 2 * self.cap else 2 * self.cap

    def push(self, count: int) -> int:
        for _ in range(count):
            self.ensure(self.size + 1)
            self.size += 1
        return count

    def erase(self, pos: int) -> int:
        if pos >= self.size:
            return 0
        moves = self.size - pos - 1
        self.size -= 1
        return moves

    def resize(self, wanted: int) -> int:
        cost = self.size if wanted > self.cap else abs(wanted - self.size)
        self.ensure(wanted)
        self.size = wanted
        return cost


def pick_position(rng: random.Random, size: int) -> int:
    names = [name for name, _ in POSITIONS]
    weights = [weight for _, weight in POSITIONS]
    region = rng.choices(names, weights=weights, k=1)[0]
    if size == 0:
        return rng.choice([0, 1, 10**6])
    if region == "front":
        return 0
    if region == "last":
        return size - 1
    if region == "middle":
        return size // 2
    if region == "random":
        return rng.randrange(0, size)
    if region == "at_size":
        return size
    return size + rng.choice([1, 2, 17, 10**6])


def block(rng: random.Random, kind: int, n: int, commands: int,
          mix: dict, budget: int) -> list[str]:
    sim = Simulator()
    body = ["1 %d %d" % (n, rng.randrange(1, 10**9))]
    budget -= sim.push(n)

    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]
    for _ in range(max(commands - 1, 0)):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 2:
            pos = pick_position(rng, sim.size)
            body.append("2 %d" % pos)
            budget -= sim.erase(pos)
        elif op == 3:
            body.append("3 %d" % rng.randrange(0, 10**9))
        elif op == 4:
            count = rng.randrange(1, max(2, n // 4 + 2))
            body.append("4 %d %d" % (count, rng.randrange(1, 10**9)))
            budget -= sim.push(count)
        elif op == 5:
            wanted = rng.randrange(0, n + 1) if n > 0 else 0
            body.append("5 %d" % wanted)
            budget -= sim.resize(wanted)
        elif op == 6:
            body.append("6")
            sim.size = 0
        elif op == 7:
            body.append("7")
            budget -= 4 * sim.size
        elif op == 8:
            body.append("8")
            budget -= sim.size
        elif op == 10:
            pos = pick_position(rng, sim.size)
            span = max(1, sim.size - pos)
            affordable = max(1, budget // max(span, 1))
            count = rng.randrange(1, max(2, min(affordable, span + 3)))
            body.append("10 %d %d" % (count, pos))
            for _ in range(count):
                budget -= sim.erase(pos)
        else:
            body.append(str(op))
        if budget <= 0:
            break
    return ["%d %d" % (kind, len(body))] + body


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix, budget in blocks:
        lines.extend(block(rng, kind, n, commands, mix, budget))
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
