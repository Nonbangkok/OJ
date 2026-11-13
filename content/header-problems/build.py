#!/usr/bin/env python3
"""Build header problems into the OJ batch-upload layout.

    ./run.sh build --all
    ./run.sh build hp_que09_reverse [hp_que10_merge ...]

For each problem this

  1. injects meta.json's `declarations` into lib/<topic>.h to produce the
     shipped `<ds>.h` (one header, used by BOTH the grader and the starter);
  2. renders statement.md (plus the shared ข้อบังคับ partial and the generated
     subtask table) to statement HTML, then to `<id>.pdf` with wkhtmltopdf,
     and extracts the text back out with pdftotext to prove the Thai survived;
  3. runs gen.py to write the 10 inputs;
  4. compiles grader_main.cpp + `<ds>.h` + solution.h (as the submission file)
     with the judge's flags and RUNS it on every input to produce the expected
     outputs — outputs are never written by hand;
  5. assembles dist/<id>/ in the import layout and rewrites
     dist/header-problems.zip from everything currently in dist/.

The import layout, confirmed against backend/services/batchUploadService.ts
and backend/schemas/problemZipConfig.ts:

    <id>/config.json
    <id>/<id>.pdf
    <id>/grader/main.cpp, <id>/grader/<ds>.h        (secret)
    <id>/starter/main.cpp, <ds>.h, student.h        (public)
    <id>/testcases/input/inputNN.txt
    <id>/testcases/output/outputNN.txt
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import harness
from harness import (
    DIST_DIR,
    GRADER_EXTENSIONS,
    HarnessError,
    Meta,
    STATEMENT_DIR,
    TESTCASE_BYTES_BUDGET,
    TESTCASE_COUNT,
    WORK_DIR,
    assemble_statement_markdown,
    assert_thai_survived,
    case_input_name,
    case_output_name,
    compile_header_program,
    compose_header,
    human_bytes,
    load_meta,
    require_container,
    reset_dir,
    resolve_problem_dirs,
    run_program,
    write_text,
)
from mdrender import extract_fenced, render_markdown

ZIP_NAME = "header-problems.zip"

# Headroom for the REFERENCE run while building outputs: it must finish well
# inside the problem's limit, but a build must never truncate an output
# because of a borderline machine, so it gets 10x (and at least 20 s).
REFERENCE_TIMEOUT_MS_MIN = 20_000

# Flag the author if the reference is already close to the limit on this
# machine: the production judge is a different box and has no headroom to
# spare (fraction of the problem's time limit).
REFERENCE_TIME_WARN_FRACTION = 0.5


# --- statement -------------------------------------------------------------


def statement_html(meta: Meta, markdown: str) -> str:
    style = (STATEMENT_DIR / "style.css").read_text(encoding="utf-8")
    difficulty = "ไม่จัดระดับ" if meta.difficulty is None else str(meta.difficulty)
    meta_line = (
        f"<span>รหัสข้อ: <code>{meta.id}</code></span>"
        f"<span>เวลา: {meta.time_limit_ms / 1000:.3f} วินาที</span>"
        f"<span>หน่วยความจำ: {meta.memory_limit_mb} MB</span>"
        f"<span>ส่งไฟล์: <code>{meta.submission_filename}</code></span>"
        f"<span>ระดับความยาก: {difficulty}</span>"
    )
    return (
        "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        f"<title>{meta.id}</title>\n"
        f"<style>\n{style}\n</style>\n"
        "</head>\n<body>\n"
        f"<h1>{meta.title}</h1>\n"
        f"<p class=\"meta\">{meta_line}</p>\n"
        f"{render_markdown(markdown)}\n"
        "</body>\n</html>\n"
    )


def render_pdf(meta: Meta, html_path: Path, pdf_path: Path) -> None:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "wkhtmltopdf",
        "--encoding", "UTF-8",
        "--page-size", "A4",
        "--print-media-type",
        "--margin-top", "18mm",
        "--margin-bottom", "18mm",
        "--margin-left", "16mm",
        "--margin-right", "16mm",
        "--footer-right", "[page]/[topage]",
        "--footer-font-size", "8",
        "--disable-local-file-access",
        "--load-error-handling", "abort",
        "--quiet",
        str(html_path), str(pdf_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not pdf_path.is_file():
        raise HarnessError(
            f"{meta.id}: wkhtmltopdf failed (exit {completed.returncode}): "
            f"{(completed.stderr or completed.stdout).strip()[:800]}"
        )
    if pdf_path.read_bytes()[:4] != b"%PDF":
        raise HarnessError(f"{meta.id}: rendered file is not a PDF (the importer checks the %PDF magic bytes)")


# --- testcases -------------------------------------------------------------


def generate_inputs(meta: Meta, input_dir: Path) -> None:
    reset_dir(input_dir)
    completed = subprocess.run(
        [sys.executable, "gen.py", str(input_dir.resolve())],
        cwd=meta.source_dir, capture_output=True, text=True, check=False,
    )
    if completed.returncode != 0:
        raise HarnessError(f"{meta.id}: gen.py failed (exit {completed.returncode}): "
                           f"{(completed.stderr or completed.stdout).strip()[:800]}")
    for index in range(1, TESTCASE_COUNT + 1):
        path = input_dir / case_input_name(index)
        if not path.is_file():
            raise HarnessError(f"{meta.id}: gen.py did not write {path.name}")
    extra = sorted(p.name for p in input_dir.iterdir()
                   if p.name not in {case_input_name(i) for i in range(1, TESTCASE_COUNT + 1)})
    if extra:
        raise HarnessError(f"{meta.id}: gen.py wrote unexpected files: {', '.join(extra)}")


def build_reference_outputs(meta: Meta, header_text: str, input_dir: Path, output_dir: Path) -> list[dict]:
    """Compile the grader with solution.h and run it on every input."""
    workspace = meta.work_dir / "reference"
    reset_dir(workspace)
    write_text(workspace / "main.cpp", (meta.source_dir / "grader_main.cpp").read_text(encoding="utf-8"))
    write_text(workspace / meta.ds_filename, header_text)
    write_text(workspace / meta.submission_filename, (meta.source_dir / "solution.h").read_text(encoding="utf-8"))

    ok, diagnostics = compile_header_program(workspace, ["main.cpp"])
    if not ok:
        raise HarnessError(f"{meta.id}: grader + solution.h does not compile:\n{diagnostics[:2000]}")

    reset_dir(output_dir)
    timeout_ms = max(meta.time_limit_ms * 10, REFERENCE_TIMEOUT_MS_MIN)
    measurements: list[dict] = []
    for index in range(1, TESTCASE_COUNT + 1):
        input_path = input_dir / case_input_name(index)
        output_path = output_dir / case_output_name(index)
        result = run_program(
            workspace, harness.BINARY_NAME, input_path, timeout_ms,
            output_path, workspace / f"stderr{index:02d}.txt",
        )
        if result.timed_out:
            raise HarnessError(f"{meta.id}: the REFERENCE timed out on case {index} "
                               f"after {timeout_ms} ms — the case is too large or solution.h is wrong")
        if result.exit_code != 0:
            stderr = result.stderr_path.read_text(encoding="utf-8", errors="replace").strip()
            raise HarnessError(f"{meta.id}: the reference exited {result.exit_code} on case {index}: {stderr[:600]}")
        if output_path.stat().st_size == 0:
            raise HarnessError(f"{meta.id}: the reference produced no output on case {index}")
        measurements.append({
            "case": index,
            "wall_ms": round(result.wall_ms, 1),
            "max_rss_mb": round(result.max_rss_mb, 1),
            "input_bytes": input_path.stat().st_size,
            "output_bytes": output_path.stat().st_size,
        })
    return measurements


# --- assembly --------------------------------------------------------------


def validate_grader_set(meta: Meta, grader_dir: Path) -> None:
    """The file-set rules from the header-problem design, checked at build
    time so a bad bundle is never uploaded (the importer would reject the
    whole problem)."""
    files = sorted(path for path in grader_dir.iterdir() if path.is_file())
    if not files:
        raise HarnessError(f"{meta.id}: grader/ is empty")
    if len(files) > 20:
        raise HarnessError(f"{meta.id}: grader/ has {len(files)} files (max 20)")
    if not any(path.suffix.lower() == ".cpp" for path in files):
        raise HarnessError(f"{meta.id}: grader/ must contain at least one .cpp file")
    for path in files:
        if path.suffix.lower() not in GRADER_EXTENSIONS:
            raise HarnessError(f"{meta.id}: grader file {path.name} must end in .cpp, .h or .hpp")
        if path.name == meta.submission_filename:
            raise HarnessError(f"{meta.id}: grader/ must not contain {meta.submission_filename}")
        if not harness.FILENAME_PATTERN.match(path.name):
            raise HarnessError(f"{meta.id}: grader file name {path.name} is not a valid flat filename")
        if path.stat().st_size > 1024 * 1024:
            raise HarnessError(f"{meta.id}: grader file {path.name} exceeds 1 MiB")


def write_config(meta: Meta, dist_dir: Path) -> None:
    config = {
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
    write_text(dist_dir / "config.json", json.dumps(config, ensure_ascii=False, indent=2) + "\n")


def build_problem(problem_dir: Path) -> dict:
    meta = load_meta(problem_dir)
    print(f"==> {meta.id}")
    started = time.monotonic()

    reset_dir(meta.work_dir)
    reset_dir(meta.dist_dir)

    header_text = compose_header(meta)
    write_text(meta.work_dir / meta.ds_filename, header_text)

    markdown = assemble_statement_markdown(meta)
    samples_in = extract_fenced(markdown, "sample-input")
    samples_out = extract_fenced(markdown, "sample-output")
    if len(samples_in) != 1 or len(samples_out) != 1:
        raise HarnessError(
            f"{meta.id}: statement.md must contain exactly one ```sample-input and one "
            f"```sample-output block (found {len(samples_in)} and {len(samples_out)})"
        )
    write_text(meta.work_dir / "sample.in", samples_in[0].rstrip("\n") + "\n")
    write_text(meta.work_dir / "sample.out", samples_out[0].rstrip("\n") + "\n")

    html_path = meta.work_dir / "statement.html"
    write_text(html_path, statement_html(meta, markdown))
    pdf_path = meta.dist_dir / f"{meta.id}.pdf"
    render_pdf(meta, html_path, pdf_path)
    probe = assert_thai_survived(meta, pdf_path, meta.work_dir)
    print(f"    statement.pdf  {human_bytes(pdf_path.stat().st_size)}  "
          f"(Thai check ok: \"{probe}\" found in the extracted text)")

    input_dir = meta.dist_dir / "testcases" / "input"
    output_dir = meta.dist_dir / "testcases" / "output"
    generate_inputs(meta, input_dir)
    measurements = build_reference_outputs(meta, header_text, input_dir, output_dir)

    grader_dir = meta.dist_dir / "grader"
    grader_dir.mkdir(parents=True, exist_ok=True)
    write_text(grader_dir / "main.cpp", (meta.source_dir / "grader_main.cpp").read_text(encoding="utf-8"))
    write_text(grader_dir / meta.ds_filename, header_text)
    validate_grader_set(meta, grader_dir)

    starter_dir = meta.dist_dir / "starter"
    starter_dir.mkdir(parents=True, exist_ok=True)
    write_text(starter_dir / "main.cpp", (meta.source_dir / "starter_main.cpp").read_text(encoding="utf-8"))
    write_text(starter_dir / meta.ds_filename, header_text)
    write_text(starter_dir / meta.submission_filename,
               (meta.source_dir / "student_template.h").read_text(encoding="utf-8"))

    write_config(meta, meta.dist_dir)

    slowest = max(measurements, key=lambda entry: entry["wall_ms"])
    testcase_bytes = sum(entry["input_bytes"] + entry["output_bytes"] for entry in measurements)
    summary = {
        "id": meta.id,
        "built_in_s": round(time.monotonic() - started, 1),
        "reference_slowest_case": slowest["case"],
        "reference_slowest_wall_ms": slowest["wall_ms"],
        "reference_peak_rss_mb": max(entry["max_rss_mb"] for entry in measurements),
        "time_limit_ms": meta.time_limit_ms,
        "memory_limit_mb": meta.memory_limit_mb,
        "testcase_bytes": testcase_bytes,
        "cases": measurements,
    }
    write_text(meta.work_dir / "build.json", json.dumps(summary, ensure_ascii=False, indent=2) + "\n")

    print(f"    testcases      {TESTCASE_COUNT} cases, {human_bytes(testcase_bytes)}")
    print(f"    reference      slowest case {slowest['case']}: {slowest['wall_ms']:.0f} ms "
          f"of {meta.time_limit_ms} ms, peak {summary['reference_peak_rss_mb']:.0f} MB "
          f"of {meta.memory_limit_mb} MB")

    if slowest["wall_ms"] > meta.time_limit_ms * REFERENCE_TIME_WARN_FRACTION:
        print(f"    WARNING: the reference uses more than "
              f"{int(REFERENCE_TIME_WARN_FRACTION * 100)}% of the time limit on this machine; "
              "the production judge is a different box — raise the limit or shrink the case")
    if testcase_bytes > TESTCASE_BYTES_BUDGET:
        print(f"    WARNING: {human_bytes(testcase_bytes)} of testcase data exceeds the "
              f"{human_bytes(TESTCASE_BYTES_BUDGET)} per-problem budget; 50 problems must fit the "
              "importer's 500 MB uncompressed archive cap")
    return summary


def write_zip() -> Path:
    """Rewrite dist/header-problems.zip from every built problem in dist/."""
    archive = DIST_DIR / ZIP_NAME
    built = sorted(path for path in DIST_DIR.iterdir()
                   if path.is_dir() and not path.name.startswith(".") and (path / "config.json").is_file())
    if not built:
        raise HarnessError("nothing to zip: dist/ has no built problem")
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for problem in built:
            for path in sorted(problem.rglob("*")):
                if path.is_file():
                    zip_file.write(path, path.relative_to(DIST_DIR).as_posix())
    print(f"==> {archive.relative_to(harness.ROOT)}  {human_bytes(archive.stat().st_size)}  "
          f"({len(built)} problem(s): {', '.join(path.name for path in built)})")
    return archive


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build header problems into the batch-upload layout.")
    parser.add_argument("problems", nargs="*", help="problem ids, or --all / nothing for every problem")
    parser.add_argument("--all", action="store_true", help="build every problem under problems/")
    args = parser.parse_args(argv)

    try:
        require_container()
        selectors = [] if args.all else args.problems
        problem_dirs = resolve_problem_dirs(selectors)
        DIST_DIR.mkdir(parents=True, exist_ok=True)
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        for problem_dir in problem_dirs:
            build_problem(problem_dir)
        write_zip()
    except HarnessError as error:
        print(f"\nBUILD FAILED: {error}", file=sys.stderr)
        return 1
    print("\nbuild ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
