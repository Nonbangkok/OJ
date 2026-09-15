# Approved Red Gate baseline

`red-gate-demo.pdf` is an unmodified copy of the approved source checkout's
`output/pdf/red-gate-demo.pdf`; it is a comparison fixture, not a newly rendered
result. The source is documented in the template's `PROVENANCE.md`.

`red-gate-statement.html` preserves `RED_GATE_STATEMENT` from the demo's
`content.mjs`. The only transformation is the packet asset convention:
`{{ASSET_BASE}}/assets/` becomes `{{ASSET_BASE}}/`. Load the accompanying metadata
JSON, supply the statement HTML, use `red-gate-logo-alpha.png` as the avatar, and
place `red-gate-diagram.jpg` in the packet assets directory to reproduce the
baseline with the generic template.

Original binary SHA-256 values:

- PDF: `cb94d5a9b79ef1fa8e250a2288e6819beb724ca331897a053f8f81544891dca1`
- Avatar PNG: `6a33b55a3330505303aa6a09bd4fa20fa333cbe7de8ed27e68c3384eff04c83d`
- Diagram JPEG: `eb86c0ddebddcd4ffa59294aebefbbb23f95bd95bb6aea04360d832636fe842f`

The statement's original educational-use notice is retained. Template and
third-party licenses are included under `authoring/templates/red-gate-v1/licenses/`.
