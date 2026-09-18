# red-gate-v1

Extracted from the user-approved `pdf-writer/task-pdf-writer/demo/red-gate`
reference on 2026-09-14. The source checkout was
`/Users/nonbangkok/Documents/Workspace/Clone_Project/pdf-writer/task-pdf-writer`.

`layout.css` retains the complete CSS from `redGateDocument.mjs` beginning at
`@page`, including its geometry-data/input-spec tuning, sample-table spacing,
forced page break, and screen/print rules. The font-face declarations and HTML
header structure remain in `pdfTemplate.ts`. Metadata, title, and avatar are
provided by the job packet. The production template contains no Red Gate
statement or built-in author image.

`fonts/` contains the four font files referenced by the original template.
`vendor/` contains the original Browserify bundle with KaTeX 0.15.1 and Marked 4.0.8, its CSS,
and all fonts referenced by that CSS. The source's duplicate
`vendor/fonts/fonts/` subtree was intentionally not copied. None of the vendor
files were modified. Licenses are preserved in `licenses/`: the source's MIT
license, KaTeX's and Marked's MIT licenses, and the Sarabun and Inconsolata OFL notices from
the source's `sam-task-pdf-writer/aws-python-api/static/fonts/` directories.

The wrapper disables trusted math commands, bounds macro expansion and size,
and reports parse failures through `pdf-render-error` and `PDF_RENDER_ERROR`.
The caller must validate the packet and sanitize its statement before building
HTML; renderer URLs come only from the trusted worker.

SHA-256 of unmodified vendor assets:

- `vendor/bundle.js`: `7230786176b856dd30bd023ea8a26b9805b84991150c56fe8f77867d43bf79eb`
- `vendor/katex.css`: `1bfaf2a056308884c73071dc8f20b8efbd6b54949f14576efcf2ad705401ccc8`

The runtime image must copy this directory to `dist/authoring/templates/red-gate-v1`
alongside the compiled module; TypeScript compilation alone does not copy assets.
