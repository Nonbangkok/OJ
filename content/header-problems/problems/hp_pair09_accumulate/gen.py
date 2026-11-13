#!/usr/bin/env python3
"""Testcase generator for hp_pair09_accumulate.

Harness contract (the same for all 50 problems):

    python3 gen.py <output-directory>

writes exactly the problem's inputs as ``input01.txt`` ... ``input10.txt``
into that directory and nothing else, deterministically (fixed seeds), because
build.py re-derives the expected outputs from these bytes and verify.py
compares them again.

Cases are ordered SMALLEST FIRST so the judge's stop-on-first-failure prefix
score reproduces the statement's subtasks:

    cases 1-3   (30%)  tiny, mostly numeric components
    cases 4-6   (30%)  medium, pair<string,string> appears. Case 6 is the
                       largest case a += that rebuilds the pair still passes
    cases 7-10  (40%)  40,000-55,000 accumulations into ONE accumulator whose
                       two string components grow to a few hundred thousand
                       characters. An O(L)-per-call += copies ~12*q^2 bytes in
                       total and runs out of time; the in-place one is O(L)

EVERY case from 7 on must defeat the naive version, because the judge stops at
the first failure: if case 7 let it through it would score 70%, not the 60%
the statement promises. So the jump from case 6 (q = 4,000 hot commands,
~2*10^8 bytes copied) to case 7 (q = 40,000, ~2*10^10 bytes) is deliberately
steep, and grows from there.

Component values stay tiny (|value| <= 1000) and the array is read-only, so
the accumulated integers never come close to overflowing (the judge compiles
with -fsanitize=signed-integer-overflow, which aborts on overflow).

Input format is the secret grader's command stream (see grader_main.cpp):

    B
    kind n q        kind: 1 = pair<int,int>, 2 = pair<long long,string>,
                          3 = pair<string,string>
    n lines: a b
    q command lines: "1 k i" | "2 k" | "3 i j k" | "4 i j" | "5 i j"
                     | "6 k" | "7 i j"
"""

import os
import random
import sys

CASES = 10
ACCUMULATORS = 4

# Weight per opcode 1..7: acc, show, chain, twice, agree, reset, absorb.
MIXED = {1: 40, 2: 12, 3: 14, 4: 10, 5: 10, 6: 4, 7: 10}
# The hot profile: almost every command folds another element into ONE
# accumulator. `show` is rare on purpose — it streams the whole accumulator,
# so it costs the reference O(L) and, left at a percent or two of the stream,
# it would dominate the reference's running time rather than the submission's.
# `reset` is absent, because it would throw the accumulated string away.
HOT = {1: 4000, 2: 1, 3: 3, 4: 3, 5: 3, 6: 0, 7: 3}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"
# The hot blocks use a longer element than the small ones: the naive version's
# cost grows with the SQUARE of the accumulated length, so 16 characters per
# element instead of 6 buys roughly 7x the separation for the same number of
# commands (and the same number of input bytes per command).
STRING_LENGTH_HOT = 16
VALUE_LIMIT = 1000

# kind -> (type of first, type of second)
KIND_TYPES = {1: ("int", "int"), 2: ("llong", "str"), 3: ("str", "str")}

# Case plan: (seed, [(kind, n, q, mix, hot), ...]).
# `hot` aims every `acc` command at accumulator 0 and makes every string
# exactly STRING_LENGTH_HOT characters, so the accumulator's growth — and
# therefore the quadratic cost of the naive version — is predictable.
PLAN = [
    (9101, [(1, 3, 20, MIXED, False)]),
    (9102, [(1, 6, 40, MIXED, False), (2, 5, 40, MIXED, False)]),
    (9103, [(2, 8, 60, MIXED, False), (1, 5, 40, MIXED, False)]),
    (9104, [(3, 20, 400, MIXED, False), (2, 20, 400, MIXED, False)]),
    (9105, [(3, 200, 2500, HOT, True), (2, 100, 1500, MIXED, False)]),
    (9106, [(3, 300, 4000, HOT, True), (1, 200, 2000, MIXED, False)]),
    (9107, [(3, 500, 40000, HOT, True)]),
    (9108, [(3, 600, 45000, HOT, True), (2, 200, 2000, MIXED, False)]),
    (9109, [(3, 800, 50000, HOT, True), (3, 200, 2000, MIXED, False)]),
    (9110, [(3, 1000, 55000, HOT, True), (2, 500, 4000, MIXED, False)]),
]


def token(rng: random.Random, component_type: str, hot: bool) -> str:
    """One component, written the way `std::cin >> value` reads it."""
    if component_type in ("int", "llong"):
        return str(rng.randint(-VALUE_LIMIT, VALUE_LIMIT))
    length = STRING_LENGTH_HOT if hot else rng.randint(1, 6)
    return "".join(rng.choice(ALPHABET) for _ in range(length))


def pair_tokens(rng: random.Random, kind: int, hot: bool) -> str:
    first_type, second_type = KIND_TYPES[kind]
    return token(rng, first_type, hot) + " " + token(rng, second_type, hot)


def block(rng: random.Random, kind: int, n: int, commands: int, mix: dict, hot: bool) -> list[str]:
    ops = [op for op, weight in mix.items() if weight > 0]
    weights = [mix[op] for op in ops]

    assert n > 0, "hp_pair09_accumulate blocks are never empty"
    lines = ["%d %d %d" % (kind, n, commands)]
    for _ in range(n):
        lines.append(pair_tokens(rng, kind, hot))

    for _ in range(commands):
        op = rng.choices(ops, weights=weights, k=1)[0]
        if op == 1:
            slot = 0 if hot else rng.randrange(ACCUMULATORS)
            lines.append("1 %d %d" % (slot, rng.randrange(n)))
        elif op in (2, 6):
            slot = 0 if hot else rng.randrange(ACCUMULATORS)
            lines.append("%d %d" % (op, slot))
        elif op == 3:
            lines.append("3 %d %d %d" % (rng.randrange(n), rng.randrange(n), rng.randrange(n)))
        else:
            lines.append("%d %d %d" % (op, rng.randrange(n), rng.randrange(n)))
    return lines


def build_case(index: int) -> str:
    seed, blocks = PLAN[index]
    rng = random.Random(seed)
    lines = [str(len(blocks))]
    for kind, n, commands, mix, hot in blocks:
        lines.extend(block(rng, kind, n, commands, mix, hot))
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
