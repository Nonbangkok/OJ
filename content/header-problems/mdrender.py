#!/usr/bin/env python3
"""The statement Markdown -> HTML path.

Deliberately a small, closed subset rather than a Markdown library: the
statements are authored by us, 50 of them, with one shared partial, and the
output has to be stable bytes that wkhtmltopdf lays out predictably. A
dependency would also mean pip inside the build image, which the judge image
does not have either.

Supported, and nothing else:

    # ## ###           headings
    paragraphs         (blank-line separated)
    - item / * item    unordered lists
    1. item            ordered lists
    | a | b |          pipe tables with a |---|---| separator row
    ```info            fenced code; the info string becomes a class, and
                       `sample-input` / `sample-output` are also machine-read
                       by build.py so the statement IS the sample fixture
    ---                horizontal rule
    `code`             inline code
    **bold**           inline strong
    <!-- comment -->   dropped

Everything else is escaped and emitted as text, so a stray `<script>` in a
statement can never reach the PDF.
"""

from __future__ import annotations

import html
import re

HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
UL_RE = re.compile(r"^[-*]\s+(.*)$")
OL_RE = re.compile(r"^(\d+)\.\s+(.*)$")
FENCE_RE = re.compile(r"^```\s*([A-Za-z0-9_+-]*)\s*$")
HR_RE = re.compile(r"^-{3,}\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$")
CODE_SPAN_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")

_CODE_PLACEHOLDER = "\x00CODE%d\x00"


def render_inline(text: str) -> str:
    """Inline formatting. Code spans are lifted out first so that a `*` or an
    `&` inside one is never treated as markup."""
    spans: list[str] = []

    def take(match: re.Match[str]) -> str:
        spans.append(match.group(1))
        return _CODE_PLACEHOLDER % (len(spans) - 1)

    lifted = CODE_SPAN_RE.sub(take, text)
    escaped = html.escape(lifted, quote=False)
    bolded = BOLD_RE.sub(lambda m: f"<strong>{m.group(1)}</strong>", escaped)
    for index, span in enumerate(spans):
        bolded = bolded.replace(_CODE_PLACEHOLDER % index, f"<code>{html.escape(span, quote=False)}</code>")
    return bolded


def _render_table(rows: list[str]) -> str:
    def cells(row: str) -> list[str]:
        stripped = row.strip()
        if stripped.startswith("|"):
            stripped = stripped[1:]
        if stripped.endswith("|"):
            stripped = stripped[:-1]
        return [cell.strip() for cell in stripped.split("|")]

    head = cells(rows[0])
    body = [cells(row) for row in rows[2:]]
    out = ["<table>", "<thead><tr>"]
    out += [f"<th>{render_inline(cell)}</th>" for cell in head]
    out.append("</tr></thead>")
    if body:
        out.append("<tbody>")
        for row in body:
            out.append("<tr>" + "".join(f"<td>{render_inline(cell)}</td>" for cell in row) + "</tr>")
        out.append("</tbody>")
    out.append("</table>")
    return "".join(out)


def render_markdown(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    index = 0
    total = len(lines)

    while index < total:
        line = lines[index]

        if line.lstrip().startswith("<!--"):
            while index < total and "-->" not in lines[index]:
                index += 1
            index += 1
            continue

        if not line.strip():
            index += 1
            continue

        fence = FENCE_RE.match(line)
        if fence:
            info = fence.group(1)
            index += 1
            block: list[str] = []
            while index < total and not FENCE_RE.match(lines[index]):
                block.append(lines[index])
                index += 1
            index += 1  # closing fence
            attribute = f' class="code-{html.escape(info, quote=True)}"' if info else ""
            body = html.escape("\n".join(block), quote=False)
            out.append(f"<pre{attribute}><code>{body}</code></pre>")
            continue

        if HR_RE.match(line):
            out.append("<hr>")
            index += 1
            continue

        heading = HEADING_RE.match(line)
        if heading:
            level = len(heading.group(1))
            out.append(f"<h{level}>{render_inline(heading.group(2).strip())}</h{level}>")
            index += 1
            continue

        if "|" in line and index + 1 < total and TABLE_SEP_RE.match(lines[index + 1]):
            rows = [line, lines[index + 1]]
            index += 2
            while index < total and "|" in lines[index] and lines[index].strip():
                rows.append(lines[index])
                index += 1
            out.append(_render_table(rows))
            continue

        if UL_RE.match(line):
            items: list[str] = []
            while index < total and UL_RE.match(lines[index]):
                item = [UL_RE.match(lines[index]).group(1)]
                index += 1
                while index < total and lines[index].startswith("  ") and lines[index].strip() \
                        and not UL_RE.match(lines[index]) and not OL_RE.match(lines[index]):
                    item.append(lines[index].strip())
                    index += 1
                items.append(" ".join(item))
            out.append("<ul>" + "".join(f"<li>{render_inline(item)}</li>" for item in items) + "</ul>")
            continue

        if OL_RE.match(line):
            items = []
            while index < total and OL_RE.match(lines[index]):
                item = [OL_RE.match(lines[index]).group(2)]
                index += 1
                while index < total and lines[index].startswith("  ") and lines[index].strip() \
                        and not UL_RE.match(lines[index]) and not OL_RE.match(lines[index]):
                    item.append(lines[index].strip())
                    index += 1
                items.append(" ".join(item))
            out.append("<ol>" + "".join(f"<li>{render_inline(item)}</li>" for item in items) + "</ol>")
            continue

        paragraph: list[str] = []
        while index < total and lines[index].strip():
            candidate = lines[index]
            if (HEADING_RE.match(candidate) or FENCE_RE.match(candidate) or HR_RE.match(candidate)
                    or UL_RE.match(candidate) or OL_RE.match(candidate)):
                break
            if "|" in candidate and index + 1 < total and TABLE_SEP_RE.match(lines[index + 1]):
                break
            paragraph.append(candidate.strip())
            index += 1
        if paragraph:
            out.append(f"<p>{render_inline(' '.join(paragraph))}</p>")

    return "\n".join(out)


def extract_fenced(text: str, info: str) -> list[str]:
    """Every fenced block whose info string is exactly `info`, verbatim.

    This is what makes the statement's ตัวอย่าง the single source of truth for
    the sample: build.py writes these blocks out as the sample fixture and
    verify.py runs the starter against them, so a wrong sample in the
    statement fails the build instead of misleading students.
    """
    found: list[str] = []
    lines = text.replace("\r\n", "\n").split("\n")
    index = 0
    while index < len(lines):
        fence = FENCE_RE.match(lines[index])
        if not fence:
            index += 1
            continue
        matching = fence.group(1) == info
        index += 1
        block: list[str] = []
        while index < len(lines) and not FENCE_RE.match(lines[index]):
            block.append(lines[index])
            index += 1
        index += 1
        if matching:
            found.append("\n".join(block))
    return found
