#!/usr/bin/env python3
"""The statement Markdown -> HTML path for the house template.

Deliberately a small, closed subset rather than a Markdown library: the
statements are authored by us, 50 of them, with two shared partials, and the
output has to be stable bytes that wkhtmltopdf lays out predictably. A
dependency would also mean pip inside the build image, which the judge image
does not have either.

Supported, and nothing else:

    # ## ### ####      headings ("## Input :" and friends)
    paragraphs         (blank-line separated)
    - item / * item    unordered lists
    1. item            ordered lists
    | a | b |          pipe tables with a |---|---| separator row
    ```info            fenced code; the info string becomes a class, and
                       `sample-input` / `sample-output` are also machine-read
                       by build.py so the statement IS the sample fixture.
                       A sample-input block followed by a sample-output block
                       is rendered as the template's two-column example table
                       (ข้อมูลนำเข้า / ข้อมูลส่งออก) — the fixture is the only
                       copy of the sample, so the table can never drift from it
    ---                horizontal rule
    `code`             inline code
    **bold**           inline strong
    $math$ / $$math$$  inline and display LaTeX, a closed subset (see below)
    <b> <i> <br> ...   a whitelist of attribute-free inline tags
    <div style="page-break-after: always;"></div>
                       an explicit page break (the template's own spelling)
    <!-- comment -->   dropped

Everything else is escaped and emitted as text, so a stray `<script>` in a
statement can never reach the PDF. That is also why raw block HTML is NOT
passed through even though the reference statement uses it for its example
tables: the one construct it was needed for (the example table) is generated
from the sample fixture instead, which removes both the escaping hole and a
second copy of the sample.

## Math

wkhtmltopdf 0.12.6 is an old QtWebKit; KaTeX/MathJax do not run in it (no
usable JS timing, no MathML) and the image is offline anyway, so math is
rendered SERVER-SIDE here into plain HTML + CSS: Unicode symbols for the
relations, <sub>/<sup> for scripts, and a two-line inline-block for fractions
and radicals. The payoff is that the math lands in the PDF's own text layer,
so `harness.assert_math_survived` can extract it back out with pdftotext and
prove it rendered — the same evidence the Thai probe gives.

An unknown macro is an ERROR, not passthrough: a typo like \\leqq must fail the
build rather than print itself into 50 statements.
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
MATH_SPAN_RE = re.compile(r"\$\$(.+?)\$\$|\$([^$]+)\$", re.DOTALL)
DISPLAY_OPEN_RE = re.compile(r"^\s*\$\$")
PAGE_BREAK_RE = re.compile(
    r"^\s*<div\s+style=\"page-break-after:\s*always;?\"\s*>\s*</div>\s*$")

# Attribute-free inline tags an author may write directly. Anything else that
# looks like a tag stays escaped text.
INLINE_TAGS = ("b", "i", "u", "em", "strong", "code", "sub", "sup", "small", "br")
INLINE_TAG_RE = re.compile(
    r"&lt;(/?)(" + "|".join(INLINE_TAGS) + r")\s*/?&gt;", re.IGNORECASE)

SAMPLE_INPUT_INFO = "sample-input"
SAMPLE_OUTPUT_INFO = "sample-output"
SAMPLE_INPUT_LABEL = "ข้อมูลนำเข้า"
SAMPLE_OUTPUT_LABEL = "ข้อมูลส่งออก"

_CODE_PLACEHOLDER = "\x00CODE%d\x00"
_MATH_PLACEHOLDER = "\x00MATH%d\x00"


class MathError(ValueError):
    """A statement used a LaTeX construct this renderer does not implement."""


# --- math ------------------------------------------------------------------

# Only symbols the build image's fonts actually carry. A symbol the fonts lack
# renders as a box, which no reader wants and no probe can see. Every entry
# here was round-tripped through wkhtmltopdf + pdftotext in the image; ⟨ ⟩ and
# μ were dropped because they did NOT come back, so adding a symbol means
# re-running that probe (the recipe is in .report-template.md). An unknown
# macro is a build error, so a missing symbol surfaces as a failed build
# rather than as a box in a PDF.
MATH_SYMBOLS = {
    "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠",
    "ll": "≪", "gg": "≫", "approx": "≈", "equiv": "≡", "sim": "∼",
    "times": "×", "cdot": "·", "div": "÷", "pm": "±", "mp": "∓",
    "ldots": "...", "dots": "...", "cdots": "...",
    "infty": "∞", "in": "∈", "notin": "∉",
    "subset": "⊂", "subseteq": "⊆", "cup": "∪", "cap": "∩", "emptyset": "∅",
    "rightarrow": "→", "to": "→", "leftarrow": "←", "Rightarrow": "⇒",
    "leftrightarrow": "↔", "mapsto": "→",
    "lfloor": "⌊", "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉",
    "sum": "∑", "prod": "∏", "forall": "∀", "exists": "∃", "neg": "¬",
    "land": "∧", "lor": "∨", "oplus": "⊕", "degree": "°",
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "theta": "θ", "lambda": "λ", "pi": "π", "rho": "ρ",
    "sigma": "σ", "tau": "τ", "phi": "φ", "omega": "ω",
    "Delta": "Δ", "Sigma": "Σ", "Omega": "Ω", "Theta": "Θ",
    # escaped literals
    "%": "%", "$": "$", "{": "{", "}": "}", "&": "&", "#": "#", "_": "_",
}

# Rendered upright, the way LaTeX sets \log and friends.
MATH_OPERATORS = {
    "log", "ln", "lg", "exp", "max", "min", "gcd", "lcm", "sin", "cos", "tan",
    "bmod", "mod", "deg", "det", "dim",
}

# Relations get a little air on both sides, like LaTeX's medium space.
MATH_RELATIONS = set("=<>") | {
    "≤", "≥", "≠", "≈", "≡", "∼", "≪", "≫", "∈", "∉", "⊂", "⊆", "→", "←", "⇒", "↔",
}

MATH_SPACING = {",": "\u2009", ";": "\u2002", ":": "\u2005", "!": "", " ": " ",
                "quad": "\u2003", "qquad": "\u2003\u2003"}

# Scripts are rendered with the Unicode superscript/subscript CHARACTERS, not
# with <sup>/<sub>, whenever every character of the script maps. The reason is
# the PDF's text layer: a CSS-raised <sup> sits on its own baseline, and
# pdftotext then reports it as a separate line ABOVE the expression ("10" and
# "9" on different lines), which no ordered check can assert on. A Unicode
# superscript is ordinary text on the same baseline and comes back in order \u2014
# measured in the build image, see .report-template.md.
#
# Anything that does not map (a script holding a fraction, a Greek letter, a
# nested expression) falls back to <sup>/<sub>: it still renders correctly, it
# is just not used as a PDF probe (math_probe_text returns None for it).
SUPERSCRIPTS = {
    "0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3", "4": "\u2074",
    "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079",
    "+": "\u207a", "-": "\u207b", "=": "\u207c", "(": "\u207d", ")": "\u207e",
    "n": "\u207f", "i": "\u2071",
}
SUBSCRIPTS = {
    "0": "\u2080", "1": "\u2081", "2": "\u2082", "3": "\u2083", "4": "\u2084",
    "5": "\u2085", "6": "\u2086", "7": "\u2087", "8": "\u2088", "9": "\u2089",
    "+": "\u208a", "-": "\u208b", "=": "\u208c", "(": "\u208d", ")": "\u208e",
    "a": "\u2090", "e": "\u2091", "h": "\u2095", "i": "\u1d62", "j": "\u2c7c", "k": "\u2096", "l": "\u2097",
    "m": "\u2098", "n": "\u2099", "o": "\u2092", "p": "\u209a", "r": "\u1d63", "s": "\u209b", "t": "\u209c",
    "u": "\u1d64", "v": "\u1d65", "x": "\u2093",
}

# Constructs whose glyphs do not sit on the expression's own baseline, so the
# order pdftotext reports them in is a property of the extractor rather than
# of the rendering. They render; they are not asserted on.
_UNPROBEABLE = ("<sub", "<sup", 'class="frac"', 'class="sqrt"')

_TEX_TOKEN_RE = re.compile(r"\\([A-Za-z]+|.)|([{}^_])|(\s+)|(.)", re.DOTALL)


def _tokenize_tex(tex: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    for match in _TEX_TOKEN_RE.finditer(tex):
        command, structure, space, character = match.groups()
        if command is not None:
            tokens.append(("cmd", command))
        elif structure is not None:
            tokens.append((structure, structure))
        elif space is not None:
            tokens.append(("sp", " "))
        else:
            tokens.append(("chr", character))
    return tokens


def _render_char(character: str) -> str:
    escaped = html.escape(character, quote=False)
    if character.isalpha() and character.isascii():
        return f"<i>{escaped}</i>"
    if character in MATH_RELATIONS:
        return f'<span class="mrel">{escaped}</span>'
    return escaped


def _skip_spaces(tokens: list[tuple[str, str]], index: int) -> int:
    while index < len(tokens) and tokens[index][0] == "sp":
        index += 1
    return index


def _take_group(tokens: list[tuple[str, str]], index: int) -> tuple[list[tuple[str, str]], int]:
    """The token list of the brace group (or single token) starting at index."""
    index = _skip_spaces(tokens, index)
    if index >= len(tokens):
        raise MathError("math expression ends where an argument was expected")
    kind, _ = tokens[index]
    if kind != "{":
        return [tokens[index]], index + 1
    depth = 0
    inner: list[tuple[str, str]] = []
    position = index
    while position < len(tokens):
        kind, value = tokens[position]
        if kind == "{":
            depth += 1
            if depth == 1:
                position += 1
                continue
        elif kind == "}":
            depth -= 1
            if depth == 0:
                return inner, position + 1
        inner.append(tokens[position])
        position += 1
    raise MathError("unbalanced { in math expression")


def _render_argument(tokens: list[tuple[str, str]], index: int) -> tuple[str, int]:
    group, index = _take_group(tokens, index)
    return _render_tokens(group), index


def _render_upright(tokens: list[tuple[str, str]]) -> str:
    """\\text{...}: everything inside is ordinary upright prose."""
    text = "".join(value for _, value in tokens)
    return html.escape(text, quote=False)


def _render_command(tokens: list[tuple[str, str]], index: int) -> tuple[str, int]:
    name = tokens[index][1]
    index += 1

    if name in ("frac", "dfrac", "tfrac"):
        numerator, index = _render_argument(tokens, index)
        denominator, index = _render_argument(tokens, index)
        return (f'<span class="frac"><span class="num">{numerator}</span>'
                f'<span class="den">{denominator}</span></span>'), index

    if name == "sqrt":
        group, index = _take_group(tokens, index)
        radicand = _render_tokens(group)
        return f'<span class="sqrt">&#8730;<span class="rad">{radicand}</span></span>', index

    if name in ("text", "mathrm", "mathit", "mbox", "operatorname", "textit"):
        group, index = _take_group(tokens, index)
        return _render_upright(group), index

    if name in ("left", "right"):
        index = _skip_spaces(tokens, index)
        if index >= len(tokens):
            raise MathError(f"\\{name} with no delimiter")
        delimiter = tokens[index][1]
        index += 1
        if delimiter == ".":
            return "", index
        if tokens[index - 1][0] == "cmd":
            if delimiter not in MATH_SYMBOLS:
                raise MathError(f"\\{name}\\{delimiter}: unknown delimiter")
            return f'<span class="mopen">{MATH_SYMBOLS[delimiter]}</span>', index
        return f'<span class="mopen">{html.escape(delimiter, quote=False)}</span>', index

    if name in MATH_SPACING:
        return MATH_SPACING[name], index

    if name in MATH_OPERATORS:
        return f'<span class="mop">{name}</span>', index

    if name in MATH_SYMBOLS:
        symbol = MATH_SYMBOLS[name]
        if symbol in MATH_RELATIONS:
            return f'<span class="mrel">{symbol}</span>', index
        return html.escape(symbol, quote=False), index

    raise MathError(
        f"unknown LaTeX macro \\{name} — add it to MATH_SYMBOLS / MATH_OPERATORS "
        "in mdrender.py if the statements really need it"
    )


def _render_tokens(tokens: list[tuple[str, str]]) -> str:
    out: list[str] = []
    index = 0
    while index < len(tokens):
        kind, value = tokens[index]
        if kind in ("^", "_"):
            group, index = _take_group(tokens, index + 1)
            table = SUPERSCRIPTS if kind == "^" else SUBSCRIPTS
            raw = "".join(value for _, value in group)
            if group and all(k == "chr" for k, _ in group) and all(c in table for c in raw):
                out.append("".join(table[c] for c in raw))
            else:
                tag = "sup" if kind == "^" else "sub"
                out.append(f"<{tag}>{_render_tokens(group)}</{tag}>")
            continue
        if kind == "sp":
            out.append(" ")
            index += 1
            continue
        if kind == "}":
            raise MathError("unbalanced } in math expression")
        if kind == "{":
            inner, index = _render_argument(tokens, index)
            out.append(inner)
            continue
        if kind == "cmd":
            piece, index = _render_command(tokens, index)
            out.append(piece)
            continue
        out.append(_render_char(value))
        index += 1
    return "".join(out)


def render_math(tex: str, *, display: bool = False) -> str:
    """One LaTeX expression -> HTML that wkhtmltopdf can lay out."""
    body = _render_tokens(_tokenize_tex(tex.strip()))
    css_class = "math math-display" if display else "math"
    return f'<span class="{css_class}">{body}</span>'


TAG_RE = re.compile(r"<[^>]+>")


def math_plain_text(tex: str) -> str:
    """What `render_math(tex)` is expected to put in the PDF's text layer.

    Tags stripped, entities resolved, whitespace squashed — exactly the
    projection `harness.assert_math_survived` compares against pdftotext's
    output, so the expectation is derived from the renderer rather than
    written down twice.
    """
    return _plain_text(render_math(tex))


def _plain_text(rendered: str) -> str:
    return "".join(html.unescape(TAG_RE.sub("", rendered)).split())


def math_probe_text(tex: str) -> str | None:
    """The text this expression must put in the PDF, or None if it uses a
    construct whose reading order pdftotext does not preserve (see
    `_UNPROBEABLE`)."""
    rendered = render_math(tex)
    if any(marker in rendered for marker in _UNPROBEABLE):
        return None
    return _plain_text(rendered)


def math_spans(text: str) -> list[str]:
    """Every `$...$` / `$$...$$` expression in a statement, in order."""
    found: list[str] = []
    for line in _strip_code_fences(text):
        for match in MATH_SPAN_RE.finditer(line):
            found.append((match.group(1) or match.group(2)).strip())
    return found


def _strip_code_fences(text: str) -> list[str]:
    """The statement's lines with fenced blocks removed (a `$` in a code block
    is a shell prompt, not math)."""
    lines = text.replace("\r\n", "\n").split("\n")
    kept: list[str] = []
    inside = False
    for line in lines:
        if FENCE_RE.match(line):
            inside = not inside
            continue
        if not inside:
            kept.append(line)
    return kept


# --- inline ----------------------------------------------------------------


def render_inline(text: str) -> str:
    """Inline formatting.

    Code spans are lifted out first so that a `*`, a `$` or an `&` inside one
    is never treated as markup; math spans are lifted next, because LaTeX is
    full of backslashes and `<`/`>` that must not be escaped twice.
    """
    code_spans: list[str] = []
    math_pieces: list[str] = []

    def take_code(match: re.Match[str]) -> str:
        code_spans.append(match.group(1))
        return _CODE_PLACEHOLDER % (len(code_spans) - 1)

    def take_math(match: re.Match[str]) -> str:
        display = match.group(1) is not None
        tex = (match.group(1) or match.group(2)).strip()
        math_pieces.append(render_math(tex, display=display))
        return _MATH_PLACEHOLDER % (len(math_pieces) - 1)

    lifted = MATH_SPAN_RE.sub(take_math, CODE_SPAN_RE.sub(take_code, text))
    escaped = html.escape(lifted, quote=False)
    formatted = BOLD_RE.sub(lambda m: f"<strong>{m.group(1)}</strong>", escaped)
    formatted = INLINE_TAG_RE.sub(
        lambda m: f"<{m.group(1)}{m.group(2).lower()}>", formatted)

    for index, piece in enumerate(math_pieces):
        formatted = formatted.replace(_MATH_PLACEHOLDER % index, piece)
    for index, span in enumerate(code_spans):
        formatted = formatted.replace(
            _CODE_PLACEHOLDER % index, f"<code>{html.escape(span, quote=False)}</code>")
    return formatted


# --- blocks ----------------------------------------------------------------


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


def _trim_block(block: list[str]) -> str:
    while block and not block[0].strip():
        block.pop(0)
    while block and not block[-1].strip():
        block.pop()
    return "\n".join(block)


def _render_sample_table(sample_input: list[str], sample_output: list[str]) -> str:
    """The template's example table, built from the sample FIXTURE.

    The two fenced blocks stay the single source of truth (build.py writes
    them out as sample.in / sample.out and verify.py runs the starter against
    them); this only lays them out the way the house template does, so there
    is never a second, hand-written copy of the sample to drift.
    """
    left = html.escape(_trim_block(sample_input), quote=False)
    right = html.escape(_trim_block(sample_output), quote=False)
    return (
        '<table class="samples">'
        f"<thead><tr><th>{SAMPLE_INPUT_LABEL}</th><th>{SAMPLE_OUTPUT_LABEL}</th></tr></thead>"
        f"<tbody><tr><td><pre>{left}</pre></td><td><pre>{right}</pre></td></tr></tbody>"
        "</table>"
    )


def _take_fence(lines: list[str], index: int) -> tuple[str, list[str], int]:
    fence = FENCE_RE.match(lines[index])
    assert fence is not None
    info = fence.group(1)
    index += 1
    block: list[str] = []
    while index < len(lines) and not FENCE_RE.match(lines[index]):
        block.append(lines[index])
        index += 1
    return info, block, index + 1


def _next_fence_info(lines: list[str], index: int) -> str | None:
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index >= len(lines):
        return None
    fence = FENCE_RE.match(lines[index])
    return fence.group(1) if fence else None


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

        if PAGE_BREAK_RE.match(line):
            out.append('<div class="page-break"></div>')
            index += 1
            continue

        if FENCE_RE.match(line):
            info, block, index = _take_fence(lines, index)
            if info == SAMPLE_INPUT_INFO and _next_fence_info(lines, index) == SAMPLE_OUTPUT_INFO:
                while index < total and not lines[index].strip():
                    index += 1
                _, output_block, index = _take_fence(lines, index)
                out.append(_render_sample_table(block, output_block))
                continue
            attribute = f' class="code-{html.escape(info, quote=True)}"' if info else ""
            body = html.escape(_trim_block(block), quote=False)
            out.append(f"<pre{attribute}><code>{body}</code></pre>")
            continue

        if DISPLAY_OPEN_RE.match(line):
            stripped = line.strip()
            if stripped.endswith("$$") and len(stripped) > 4:
                out.append(f'<p class="math-block">{render_math(stripped[2:-2], display=True)}</p>')
                index += 1
                continue
            block = [stripped[2:]]
            index += 1
            while index < total and "$$" not in lines[index]:
                block.append(lines[index])
                index += 1
            if index >= total:
                raise MathError("unterminated $$ display math block")
            block.append(lines[index].split("$$", 1)[0])
            index += 1
            out.append(f'<p class="math-block">{render_math(" ".join(block), display=True)}</p>')
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
                    or UL_RE.match(candidate) or OL_RE.match(candidate)
                    or PAGE_BREAK_RE.match(candidate) or DISPLAY_OPEN_RE.match(candidate)):
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
    the sample: build.py writes these blocks out as the sample fixture,
    verify.py runs the starter against them, and render_markdown lays the same
    two blocks out as the template's example table — so a wrong sample in the
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
