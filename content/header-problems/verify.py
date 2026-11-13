#!/usr/bin/env python3
"""Enforce the verification contract from CATALOGUE.md on built problems.

    ./run.sh verify --all
    ./run.sh verify hp_que09_reverse [--measure]

It checks the BUILT bundle in dist/ — the exact bytes that get imported — not
the sources, so a stale dist/ fails instead of passing on the strength of the
sources it was built from.

The contract, one check each:

  1. starter/ compiles with solution.h substituted as the submission file and
     reproduces the statement's own sample;
  2. grader/ + solution.h is Accepted on all 10 cases (inside the time limit,
     inside the memory limit, exit 0, output matching);
  3. grader/ + slow.h times out on the LAST case while still being Accepted on
     the first (so the timeout is slowness, not a crash) — skipped when
     meta.json says has_tle_subtask is false;
  4. grader/ holds at least one .cpp and no submission file;
  5. every stored output is byte-identical to what the reference produces now.

Plus the things a bad bundle would otherwise only reveal at import time: the
layout and case count, config.json agreeing with meta.json, the shipped
student template compiling, and the Thai text and the rendered math surviving
into the PDF's text layer.

Exit status is 0 only if every problem passed every check.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import harness
from harness import (
    DIST_DIR,
    GRADER_EXTENSIONS,
    HarnessError,
    Meta,
    TESTCASE_COUNT,
    assemble_statement_markdown,
    assert_statement_survived,
    case_input_name,
    case_output_name,
    compile_header_program,
    human_bytes,
    load_meta,
    outputs_match,
    require_container,
    reset_dir,
    resolve_problem_dirs,
    run_program,
    write_text,
)
from mdrender import extract_fenced

# How long the "is it really slow?" measurement is allowed to run when
# --measure is given (multiple of the problem's time limit).
MEASURE_TIMEOUT_FACTOR = 15


@dataclass
class Report:
    problem_id: str
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    def record(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append((name, ok, detail))
        return ok

    @property
    def failed(self) -> list[tuple[str, bool, str]]:
        return [check for check in self.checks if not check[1]]

    def render(self) -> str:
        lines = [f"==> {self.problem_id}: {'PASS' if not self.failed else 'FAIL'}"]
        for name, ok, detail in self.checks:
            mark = "ok  " if ok else "FAIL"
            lines.append(f"    [{mark}] {name}" + (f" — {detail}" if detail else ""))
        return "\n".join(lines)


def prepare_workspace(meta: Meta, name: str, submission: Path, main_cpp: Path, header: Path) -> Path:
    """One translation unit laid out exactly as the judge lays it out: the
    grader (or starter) sources plus the submitted file, in one flat dir."""
    workspace = meta.work_dir / name
    reset_dir(workspace)
    write_text(workspace / "main.cpp", main_cpp.read_text(encoding="utf-8"))
    write_text(workspace / meta.ds_filename, header.read_text(encoding="utf-8"))
    write_text(workspace / meta.submission_filename, submission.read_text(encoding="utf-8"))
    return workspace


def check_layout(meta: Meta, report: Report) -> bool:
    dist = meta.dist_dir
    if not dist.is_dir():
        return report.record("dist layout", False, f"{dist} does not exist — run build first")

    required = [
        dist / "config.json",
        dist / f"{meta.id}.pdf",
        dist / "grader" / "main.cpp",
        dist / "grader" / meta.ds_filename,
        dist / "starter" / "main.cpp",
        dist / "starter" / meta.ds_filename,
        dist / "starter" / meta.submission_filename,
    ]
    missing = [path.relative_to(DIST_DIR).as_posix() for path in required if not path.is_file()]
    if missing:
        return report.record("dist layout", False, f"missing: {', '.join(missing)}")

    inputs = sorted((dist / "testcases" / "input").glob("*.txt"))
    outputs = sorted((dist / "testcases" / "output").glob("*.txt"))
    if len(inputs) != TESTCASE_COUNT or len(outputs) != TESTCASE_COUNT:
        return report.record("dist layout", False,
                             f"expected {TESTCASE_COUNT} inputs and outputs, found "
                             f"{len(inputs)} and {len(outputs)}")
    for index in range(1, TESTCASE_COUNT + 1):
        for folder, namer in (("input", case_input_name), ("output", case_output_name)):
            path = dist / "testcases" / folder / namer(index)
            if not path.is_file():
                return report.record("dist layout", False, f"missing testcases/{folder}/{namer(index)}")
    return report.record("dist layout", True, f"{TESTCASE_COUNT} cases, "
                                              f"{human_bytes(sum(p.stat().st_size for p in inputs + outputs))}")


def check_config(meta: Meta, report: Report) -> bool:
    path = meta.dist_dir / "config.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return report.record("config.json", False, str(error))

    expected = {
        "id": meta.id,
        "title": meta.title,
        "author": meta.author,
        "time_limit_ms": meta.time_limit_ms,
        "memory_limit_mb": meta.memory_limit_mb,
        "categories": meta.categories,
        "difficulty": meta.difficulty,
        "collection": meta.collection,
        "problem_type": "header",
        "submission_filename": meta.submission_filename,
    }
    differences = [f"{key}={config.get(key)!r} (expected {value!r})"
                   for key, value in expected.items() if config.get(key) != value]
    if differences or set(config) != set(expected):
        unexpected = sorted(set(config) - set(expected))
        detail = "; ".join(differences + ([f"unexpected keys: {', '.join(unexpected)}"] if unexpected else []))
        return report.record("config.json", False, detail)
    return report.record("config.json", True, f"problem_type=header, submission_filename={meta.submission_filename}")


def check_grader_file_set(meta: Meta, report: Report) -> bool:
    grader = meta.dist_dir / "grader"
    files = sorted(path.name for path in grader.iterdir() if path.is_file())
    problems = []
    if not any(name.lower().endswith(".cpp") for name in files):
        problems.append("no .cpp file")
    if meta.submission_filename in files:
        problems.append(f"contains {meta.submission_filename}")
    for name in files:
        if Path(name).suffix.lower() not in GRADER_EXTENSIONS:
            problems.append(f"{name} has a disallowed extension")
        if not harness.FILENAME_PATTERN.match(name):
            problems.append(f"{name} is not a valid flat filename")
    if len(files) > 20:
        problems.append(f"{len(files)} files (max 20)")
    if problems:
        return report.record("grader file set", False, "; ".join(problems))
    return report.record("grader file set", True, ", ".join(files))


def check_pdf(meta: Meta, report: Report) -> bool:
    """The rendered statement, checked through its own text layer.

    Two probes, both read back out of the finished PDF with pdftotext: the
    Thai (a missing Thai font would otherwise draw silent boxes) and the math
    (wkhtmltopdf's WebKit cannot run KaTeX, so mdrender renders the LaTeX
    server-side — this is the evidence that it survived).
    """
    pdf = meta.dist_dir / f"{meta.id}.pdf"
    if pdf.read_bytes()[:4] != b"%PDF":
        return report.record("statement PDF", False, "missing the %PDF magic bytes")
    try:
        markdown = assemble_statement_markdown(meta)
        thai_probe, math_probe = assert_statement_survived(meta, pdf, meta.work_dir, markdown)
    except HarnessError as error:
        return report.record("statement PDF Thai and math text", False, str(error))
    return report.record(
        "statement PDF Thai and math text", True,
        f"\"{thai_probe}\" and the rendered math \"{math_probe}\" found in the text "
        f"extracted from {human_bytes(pdf.stat().st_size)} of PDF")


def check_starter(meta: Meta, report: Report) -> bool:
    markdown = assemble_statement_markdown(meta)
    samples_in = extract_fenced(markdown, "sample-input")
    samples_out = extract_fenced(markdown, "sample-output")
    if len(samples_in) != 1 or len(samples_out) != 1:
        return report.record("starter runs the statement's sample", False,
                             f"statement.md has {len(samples_in)} sample-input and "
                             f"{len(samples_out)} sample-output blocks (want 1 each)")

    sample_in = meta.work_dir / "verify-sample.in"
    write_text(sample_in, samples_in[0].rstrip("\n") + "\n")
    expected = samples_out[0].rstrip("\n") + "\n"

    starter = meta.dist_dir / "starter"

    # The bundle students download must at least compile as shipped, or they
    # cannot even start.
    template_workspace = prepare_workspace(
        meta, "starter-template", starter / meta.submission_filename,
        starter / "main.cpp", starter / meta.ds_filename,
    )
    ok, diagnostics = compile_header_program(template_workspace, ["main.cpp"])
    report.record("starter compiles as shipped (empty template)", ok, "" if ok else diagnostics[:400])

    workspace = prepare_workspace(
        meta, "starter-solution", meta.source_dir / "solution.h",
        starter / "main.cpp", starter / meta.ds_filename,
    )
    ok, diagnostics = compile_header_program(workspace, ["main.cpp"])
    if not ok:
        return report.record("starter runs the statement's sample", False,
                             f"starter + solution.h does not compile: {diagnostics[:600]}")

    result = run_program(workspace, harness.BINARY_NAME, sample_in,
                         max(meta.time_limit_ms, 5_000),
                         workspace / "sample.out", workspace / "sample.err")
    if result.exit_code != 0:
        return report.record("starter runs the statement's sample", False,
                             f"exit {result.exit_code}: "
                             f"{result.stderr_path.read_text(errors='replace').strip()[:300]}")
    actual = result.stdout_path.read_text(encoding="utf-8", errors="replace")
    if not outputs_match(actual, expected):
        return report.record("starter runs the statement's sample", False,
                             f"output differs from the statement's sample\n"
                             f"        expected: {expected.strip()!r}\n"
                             f"        actual:   {actual.strip()!r}")
    return report.record("starter runs the statement's sample", True,
                         f"{result.wall_ms:.0f} ms, output matches the \"Examples :\" section")


def check_reference(meta: Meta, report: Report) -> bool:
    """Contract 2 and 5: Accepted on all 10 cases, and the stored outputs are
    exactly what the reference produces right now."""
    workspace = prepare_workspace(
        meta, "verify-reference", meta.source_dir / "solution.h",
        meta.dist_dir / "grader" / "main.cpp", meta.dist_dir / "grader" / meta.ds_filename,
    )
    ok, diagnostics = compile_header_program(workspace, ["main.cpp"])
    if not ok:
        report.record("grader + solution.h compiles", False, diagnostics[:600])
        return False
    report.record("grader + solution.h compiles", True, "judge flags, -fno-diagnostics-show-caret")

    slowest_ms = 0.0
    peak_mb = 0.0
    stale: list[str] = []
    verdicts: list[str] = []
    for index in range(1, TESTCASE_COUNT + 1):
        input_path = meta.dist_dir / "testcases" / "input" / case_input_name(index)
        stored_path = meta.dist_dir / "testcases" / "output" / case_output_name(index)
        result = run_program(workspace, harness.BINARY_NAME, input_path, meta.time_limit_ms,
                             workspace / f"actual{index:02d}.txt", workspace / f"stderr{index:02d}.txt")
        slowest_ms = max(slowest_ms, result.wall_ms)
        peak_mb = max(peak_mb, result.max_rss_mb)

        if result.timed_out:
            verdicts.append(f"case {index}: Time Limit Exceeded ({meta.time_limit_ms} ms)")
            continue
        if result.exit_code != 0:
            stderr = result.stderr_path.read_text(encoding="utf-8", errors="replace").strip()
            verdicts.append(f"case {index}: Runtime Error (exit {result.exit_code}) {stderr[:200]}")
            continue
        if result.max_rss_mb > meta.memory_limit_mb:
            verdicts.append(f"case {index}: Memory Limit Exceeded "
                            f"({result.max_rss_mb:.0f} MB > {meta.memory_limit_mb} MB)")
            continue
        actual_bytes = result.stdout_path.read_bytes()
        stored_bytes = stored_path.read_bytes()
        if actual_bytes != stored_bytes:
            stale.append(str(index))
            if not outputs_match(actual_bytes.decode("utf-8", "replace"),
                                 stored_bytes.decode("utf-8", "replace")):
                verdicts.append(f"case {index}: Wrong Answer against the stored output")

    accepted = report.record(
        "grader + solution.h is Accepted on all 10 cases",
        not verdicts,
        "; ".join(verdicts[:4]) if verdicts
        else f"slowest {slowest_ms:.0f} ms of {meta.time_limit_ms} ms, "
             f"peak {peak_mb:.0f} MB of {meta.memory_limit_mb} MB",
    )
    fresh = report.record(
        "stored outputs are byte-identical to the reference's",
        not stale,
        "" if not stale else f"stale case(s) {', '.join(stale)} — re-run build",
    )
    return accepted and fresh


def check_slow(meta: Meta, report: Report, measure: bool) -> bool:
    """Contract 3, judged the way the judge judges it.

    "slow.h times out on the last subtask" is only true if it times out on
    that subtask's FIRST case: the judge stops at the first failure, so a
    naive solution that survived case 6 of 10 would score 60%, not the 50%
    the statement promises. This check therefore replays the whole judge —
    cases in order, stop at the first failure — and requires the resulting
    score to be exactly the cumulative percentage of the subtasks before the
    last one, with Time Limit Exceeded as the reason it stopped.
    """
    label = "grader + slow.h scores exactly the pre-TLE subtasks"
    if not meta.has_tle_subtask:
        return report.record(label, True, "skipped: meta.json has_tle_subtask is false")

    workspace = prepare_workspace(
        meta, "verify-slow", meta.source_dir / "slow.h",
        meta.dist_dir / "grader" / "main.cpp", meta.dist_dir / "grader" / meta.ds_filename,
    )
    ok, diagnostics = compile_header_program(workspace, ["main.cpp"])
    if not ok:
        return report.record(label, False, f"slow.h does not compile: {diagnostics[:600]}")

    boundary = sum(subtask.cases for subtask in meta.subtasks[:-1])
    expected_score = round(boundary / TESTCASE_COUNT * 100)

    failure_case = None
    failure_reason = ""
    for index in range(1, TESTCASE_COUNT + 1):
        result = run_program(workspace, harness.BINARY_NAME,
                             meta.dist_dir / "testcases" / "input" / case_input_name(index),
                             meta.time_limit_ms,
                             workspace / f"slow{index:02d}.txt", workspace / f"slow{index:02d}.err")
        if result.timed_out:
            failure_case, failure_reason = index, f"Time Limit Exceeded after {result.wall_ms:.0f} ms"
            break
        if result.exit_code != 0:
            failure_case, failure_reason = index, f"Runtime Error (exit {result.exit_code})"
            break
        stored = (meta.dist_dir / "testcases" / "output" / case_output_name(index)).read_text(
            encoding="utf-8", errors="replace")
        if not outputs_match(result.stdout_path.read_text(encoding="utf-8", errors="replace"), stored):
            failure_case, failure_reason = index, "Wrong Answer"
            break
        if measure and index == boundary:
            report.record("slow.h still has headroom on the last easy case", True,
                          f"case {index}: {result.wall_ms:.0f} ms of {meta.time_limit_ms} ms")

    score = 100 if failure_case is None else round((failure_case - 1) / TESTCASE_COUNT * 100)
    detail = (f"scored {score}% (want {expected_score}%): "
              + ("Accepted on every case" if failure_case is None
                 else f"Accepted on cases 1–{failure_case - 1}, then case {failure_case}: {failure_reason}"))

    passed = (failure_case == boundary + 1
              and failure_reason.startswith("Time Limit Exceeded")
              and score == expected_score)

    if passed and measure:
        hardest = meta.dist_dir / "testcases" / "input" / case_input_name(TESTCASE_COUNT)
        measured = run_program(workspace, harness.BINARY_NAME, hardest,
                               meta.time_limit_ms * MEASURE_TIMEOUT_FACTOR,
                               workspace / "slow-measure.txt", workspace / "slow-measure.err")
        if measured.timed_out:
            detail += (f"; on case {TESTCASE_COUNT} it needs more than "
                       f"{MEASURE_TIMEOUT_FACTOR}x the limit")
        else:
            detail += (f"; on case {TESTCASE_COUNT} it needs {measured.wall_ms:.0f} ms, "
                       f"{measured.wall_ms / meta.time_limit_ms:.1f}x the limit")

    return report.record(label, passed, detail)


def verify_problem(problem_dir: Path, measure: bool) -> Report:
    meta = load_meta(problem_dir)
    report = Report(meta.id)
    meta.work_dir.mkdir(parents=True, exist_ok=True)

    if not check_layout(meta, report):
        return report
    check_config(meta, report)
    check_grader_file_set(meta, report)
    check_pdf(meta, report)
    check_starter(meta, report)
    check_reference(meta, report)
    check_slow(meta, report, measure)
    return report


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Verify built header problems against the contract.")
    parser.add_argument("problems", nargs="*", help="problem ids, or --all / nothing for every problem")
    parser.add_argument("--all", action="store_true", help="verify every problem under problems/")
    parser.add_argument("--measure", action="store_true",
                        help="also measure how far over the limit slow.h really is (slower)")
    args = parser.parse_args(argv)

    try:
        require_container()
        problem_dirs = resolve_problem_dirs([] if args.all else args.problems)
    except HarnessError as error:
        print(f"VERIFY FAILED: {error}", file=sys.stderr)
        return 1

    started = time.monotonic()
    reports: list[Report] = []
    for problem_dir in problem_dirs:
        try:
            report = verify_problem(problem_dir, args.measure)
        except HarnessError as error:
            report = Report(problem_dir.name)
            report.record("problem is well-formed", False, str(error))
        reports.append(report)
        print(report.render(), flush=True)

    failed = [report for report in reports if report.failed]
    print(f"\n{len(reports) - len(failed)}/{len(reports)} problem(s) passed "
          f"in {time.monotonic() - started:.0f}s")
    if failed:
        print("\nFAILURES", file=sys.stderr)
        for report in failed:
            for name, _, detail in report.failed:
                print(f"  {report.problem_id}: {name}" + (f" — {detail}" if detail else ""), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
