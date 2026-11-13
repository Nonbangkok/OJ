#!/usr/bin/env python3
"""Testcase generator for hp_vec03_pop_front.

    python3 gen.py <output-directory>

writes input01.txt ... input10.txt deterministically (fixed seeds).

Cases 1-3 (30%) are tiny and print every element, 4-6 (30%) are mid-sized,
7-10 (40%) work on up to 100,000 elements.

pop_front is Theta(n) BY DESIGN — the whole point of an array-backed vector is
that removing the front element costs a shift — so the large cases cannot
simply be "a million pop_fronts". The generator therefore carries a WORK
BUDGET (the number of element moves it has spent) and sizes every bulk
pop_front against what is left of it, which is exactly the bound the
statement's last subtask quotes. The `2 k` / `4 k seed` commands keep the
input tiny: one short line buys k element moves inside the grader.
"""

import os
import random
import sys

CASES = 10

# Weight per opcode (see grader_main.cpp):
#   2 bulk pop_front, 3 print one, 4 bulk push_back, 5 resize, 6 clear,
#   7 copy check, 8 digest, 9 print everything
SMALL = {2: 30, 3: 12, 4: 20, 5: 8, 6: 4, 7: 8, 8: 12, 9: 6}
MID = {2: 34, 3: 10, 4: 22, 5: 8, 6: 3, 7: 6, 8: 15, 9: 2}
BIG = {2: 40, 3: 10, 4: 24, 5: 6, 6: 1, 7: 3, 8: 16, 9: 0}

# (seed, [(kind, n, commands, mix, budget), ...]); kind 1 = int,
# 2 = std::string, 3 = long long. `budget` is the number of element moves the
# block may spend; string blocks get a smaller one because moving a
# std::string is an order of magnitude more expensive than moving an int.
PLAN = [
    (1301, [(1, 4, 16, SMALL, 400), (2, 3, 14, SMALL, 400)]),
    (1302, [(1, 0, 14, SMALL, 400), (1, 1, 16, SMALL, 400), (3, 2, 14, SMALL, 400)]),
    (1303, [(1, 10, 24, SMALL, 2000), (2, 8, 20, SMALL, 2000), (3, 9, 20, SMALL, 2000)]),
    (1304, [(1, 400, 70, MID, 200_000), (2, 150, 40, MID, 60_000)]),
    (1305, [(1, 1500, 110, MID, 1_500_000), (3, 1200, 80, MID, 1_200_000)]),
    (1306, [(1, 2000, 140, MID, 3_000_000), (2, 400, 50, MID, 200_000), (3, 1800, 90, MID, 2_500_000)]),
    (1307, [(1, 40000, 80, BIG, 8_000_000), (2, 2000, 40, MID, 400_000)]),
    (1308, [(1, 80000, 90, BIG, 12_000_000), (3, 40000, 60, BIG, 8_000_000)]),
    (1309, [(1, 100000, 100, BIG, 14_000_000), (2, 5000, 40, MID, 600_000), (3, 60000, 60, BIG, 8_000_000)]),
    (1310, [(1, 100000, 110, BIG, 16_000_000), (3, 100000, 80, BIG, 14_000_000), (2, 6000, 40, MID, 700_000)]),
]

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def element(rng: random.Random, kind: int) -> str:
    if kind == 1:
        return str(rng.randint(-1_000_000, 1_000_000))
    if kind == 2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 5)))
    return str(rng.randint(-2_000_000_000, 2_000_000_000))


class Simulator:
    """Mirrors the header's own growth rule so the generator knows the size
    (and so the cost) of every command it emits."""

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

    def pop(self, count: int) -> int:
        moves = 0
        for _ in range(min(count, self.size)):
            moves += self.size - 1
            self.size -= 1
        return moves

    def resize(self, wanted: int) -> int:
        cost = self.size if wanted > self.cap else abs(wanted - self.size)
        self.ensure(wanted)
        self.size = wanted
        return cost


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
            affordable = max(1, budget // max(sim.size, 1))
            if sim.size == 0:
                count = rng.randrange(1, 4)  # must be a no-op
            elif rng.random() < 0.12 and sim.size + 3 <= affordable:
                count = sim.size + rng.randrange(1, 4)  # empties it, then no-ops
            else:
                count = rng.randrange(1, max(2, min(affordable, sim.size) + 1))
            body.append("2 %d" % count)
            budget -= sim.pop(count)
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
