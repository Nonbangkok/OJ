# Header problems — authoring harness

Source for the 50 "header problems" of [CATALOGUE.md](CATALOGUE.md) and the
machinery that turns each one into a batch-upload bundle. Everything runs
inside a throwaway Docker image (`oj-content-build`) that carries the judge's
compiler plus a Thai-capable PDF renderer, so a statement renders and a time
limit is measured with the same toolchain the OJ uses.

## Build, verify, import

```bash
cd content/header-problems

./run.sh build  --all                 # or: ./run.sh build hp_que09_reverse
./run.sh verify --all                 # the contract from CATALOGUE.md; exit 0 = all good
./run.sh verify hp_que09_reverse --measure   # also says how far over the limit slow.h is
```

The first `run.sh` builds the image (a few minutes); later runs reuse it —
`OJ_CONTENT_REBUILD=1` forces a rebuild. Nothing here touches the running
`oj` compose project.

`build.py` writes `dist/<id>/` in the import layout and
`dist/header-problems.zip` containing every problem currently in `dist/`.
Import it in the OJ as **Admin → Problems → Batch upload**; each problem
arrives hidden (`is_visible = false`), so publish it after a look.

Re-importing an id that already exists only updates categories, difficulty
and collection — grader files, starter files, testcases and the PDF are left
alone. To correct a published problem, replace its files from the problem's
admin page, or delete it and import again.

## Adding one of the remaining 49

Create `problems/<id>/` with these eight files and nothing else, then run
build + verify. No harness change should be needed.

| file | what it is |
|---|---|
| `meta.json` | id, title, author, topic, limits, `declarations`, `pdf_probe`, `has_tle_subtask`, subtasks |
| `statement.md` | Thai statement; pulls in the shared rules with `{{> rules}}` and the subtask table with `{{subtasks}}` |
| `starter_main.cpp` | the simple `main.cpp` students download |
| `grader_main.cpp` | the SECRET command-stream `main.cpp` the judge compiles |
| `student_template.h` | the submission file with the target left empty |
| `solution.h` | reference; must be Accepted on all 10 cases |
| `slow.h` | correct but naive; must time out on the last case |
| `gen.py` | `python3 gen.py <dir>` writes `input01.txt` … `input10.txt`, deterministically |

The class body itself is not per-problem: `meta.json`'s `declarations` are
injected into `lib/<topic>.h` at the `// @@DECLARATIONS@@` marker, and the
resulting `<ds>.h` is shipped to both `grader/` and `starter/`. An entry may
be a bare prototype (the member moves into `student.h`) or a complete inline
definition (the member stays pre-implemented in the header).

Two rules the harness enforces rather than trusts:

- **Subtasks must match the judge.** Scoring is stop-on-first-failure with
  prefix score, so a subtask's cumulative percentage has to equal
  `round(cases_so_far / 10 × 100)`. Order cases smallest-first.
- **The statement's sample is the fixture.** The `sample-input` /
  `sample-output` fenced blocks in `## ตัวอย่าง` are what `verify.py` runs the
  starter against, so a wrong sample fails the build.

Keep testcase data under ~6 MB per problem: 50 problems share the importer's
500 MB uncompressed-archive cap.

## Layout

```
Dockerfile          build image: ubuntu 24.04 + g++ 14 + wkhtmltopdf + Thai fonts
run.sh              the only entry point; runs build.py / verify.py in the image
build.py            compose <ds>.h, render the PDF, generate inputs, run the
                    reference for the outputs, assemble dist/ and the ZIP
verify.py           the CATALOGUE.md verification contract, checked on dist/
harness.py          shared rules: meta.json validation, compile flags, TLE rule,
                    output comparison — all mirrors of the backend's own
mdrender.py         the small Markdown -> HTML subset used for statements
lib/*.h             the five CP:: class templates
statement/rules.md  the shared ข้อบังคับ partial (one copy, not 50)
statement/style.css print stylesheet, Thai font stack
problems/<id>/      one directory per problem (see the table above)
dist/               build output, git-ignored
```
