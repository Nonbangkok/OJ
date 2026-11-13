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

## Converting one of the remaining 48

The 50 statements are being moved to the house template (the "Red Gate"
format). Two are converted — `hp_pair01_equal` and `hp_que09_reverse` — and
they are the examples to copy from; the other 48 still carry the old sections
and **fail the build** until converted, with a message naming what is wrong.
That is deliberate: the harness enforces the template rather than trusting it.
Until the last one is converted, build and verify by id, not `--all`.

Converting one problem means editing `statement.md` only (`meta.json` titles
are already English-only, and nothing else in the directory is affected):

1. First line is `# <the exact title from meta.json>` — the harness compares
   them and fails on a mismatch. The H1 in the PDF is rendered from
   meta.json, so the two can never disagree.
2. Then one or two narrative paragraphs introducing the class and how it
   stores its data, the way the template opens under its title.
3. Then these `##` sections, in this order and spelling (the space before the
   colon is the template's, not a typo):

   | section | content |
   |---|---|
   | `## คำอธิบาย :` | the target function: its signature in a ```cpp block, what it must do, the complexity it must meet, the hints |
   | `{{> rules}}` | expands to the shared `## ข้อบังคับ :` — never copy it |
   | `## คำอธิบายฟังก์ชัน main :` | what the downloadable `main.cpp` does, then what the secret grader does differently |
   | `## Input :` | the input format **of the downloadable main.cpp**, `$math$` for the variables, `<br>` between the "บรรทัดแรก :" lines |
   | `## Output :` | the same for its output |
   | `## Examples :` | `### ตัวอย่างที่ 1` then the ```sample-input / ```sample-output pair — the renderer turns those two fenced blocks into the template's two-column table, so never hand-write the table |
   | `## คำอธิบายตัวอย่างที่ 1` | why that output follows from that input |
   | `## การทดสอบใน grader :` | the command stream, as a pipe table |
   | `## Constraints :` | the bounds, one `*` bullet each, as math |
   | `{{subtasks}}` | expands to the generated `## Subtasks :` numbered list |
   | `{{limits}}` | expands to the generated `## Limits :` bullets |
   | `{{> author}}` | expands to the shared `## Author :` and `## Contacts :` — always last |

4. Write bounds and complexities as LaTeX (`$n \leq 10^5$`, `$O(1)$`,
   `$4 \times 10^9$`), not as bare `≤` or `10^9` text. Every statement must
   carry at least one checkable expression: the build extracts the rendered
   math back out of the finished PDF, exactly like the Thai probe.
5. `<b>…</b>` for emphasis (the template's own markup), `<br>` for a line
   break, `` `code` `` for identifiers. `<div style="page-break-after:
   always;"></div>` forces a page break — use it only where it actually
   improves the split (`hp_que09_reverse` puts one before `## Constraints :`).
   Any other raw HTML is escaped into visible text on purpose.
6. Keep the problem's meaning. This is a reformat, not a rewrite: the sample,
   the bounds and the grader description must still say what they said.

Creating a problem from scratch still means `problems/<id>/` with these eight
files and nothing else, then build + verify:

| file | what it is |
|---|---|
| `meta.json` | id, title (English only), author, topic, limits, `declarations`, `pdf_probe`, `has_tle_subtask`, subtasks |
| `statement.md` | Thai statement in the template above; pulls in the shared partials with `{{> rules}}` / `{{> author}}` and the generated sections with `{{subtasks}}` / `{{limits}}` |
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

Three rules the harness enforces rather than trusts:

- **Subtasks must match the judge.** Scoring is stop-on-first-failure with
  prefix score, so a subtask's cumulative percentage has to equal
  `round(cases_so_far / 10 × 100)`. Order cases smallest-first.
- **The statement's sample is the fixture.** The `sample-input` /
  `sample-output` fenced blocks under `## Examples :` are what `verify.py`
  runs the starter against, and the same two blocks are what the renderer
  lays out as the example table — one copy of the sample, so a wrong one
  fails the build instead of misleading students.
- **The PDF is checked through its own text layer.** `pdftotext` reads the
  finished file back and the build requires the Thai probe from `meta.json`,
  every section heading, and every `$…$` expression the statement carries to
  be in it. A missing Thai font, a missing symbol glyph or math that did not
  render fails the build instead of reaching a student as a box.

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
mdrender.py         the small Markdown -> HTML subset used for statements,
                    including the server-side LaTeX renderer (wkhtmltopdf's
                    WebKit cannot run KaTeX) and the example-table generator
lib/*.h             the five CP:: class templates
statement/rules.md  the shared ข้อบังคับ partial (one copy, not 50)
statement/author.md the shared ## Author : / ## Contacts : partial (likewise)
statement/style.css print stylesheet, Thai font stack, math layout
problems/<id>/      one directory per problem (see the table above)
dist/               build output, git-ignored
```
