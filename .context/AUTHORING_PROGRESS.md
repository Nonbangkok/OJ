# Problem Authoring Progress

Updated: 2026-09-13. Branch: `authoring`.

Scope authority: `docs/superpowers/specs/2026-09-12-problem-authoring-workspace-design.md`, section 17.

## Slice 3 — Complete

Author profiles, image normalization, draft author snapshots, and statement asset
persistence/API are implemented and verified. There is no remaining work within
the backend scope of Slice 3.

| Requirement | Implementation and verification |
| --- | --- |
| Reusable author profiles with optional account link | Admin create/list/update APIs; unique account-link conflict tested against PostgreSQL |
| JPEG/PNG/WebP author images | Real decoding, canonical 512×512 PNG, MIME matching, EXIF orientation, metadata removal, animation/pixel-limit rejection |
| Fallback avatar | Deterministic initial-based PNG within the same renderer/font environment; Docker includes Latin/Thai fonts; Thai rendering visually verified |
| Immutable draft author snapshot | Profile-backed and manual creation; profile changes preserve draft bytes; explicit refresh advances revision; stale refresh and published drafts rejected |
| Statement assets | Safe filenames, normalized images, SHA-256, metadata-only list, admin multipart upload/delete |
| Transaction integrity | Concurrent uploads allow one winner; duplicate filename, cross-draft deletion, and 100 MiB aggregate cap preserve revision/readiness on failure |
| Image limits | Raw upload and normalized file caps of 10 MiB; 25 million input pixels; 100 MiB total per draft |

### Final verification

- Backend image built with `backend/Dockerfile`: Node 20, native sharp, PostgreSQL 16 client tools, Fontconfig, DejaVu, and Garuda.
- `npm test -- --runInBand --verbose=false` inside that image with a disposable PostgreSQL 16 database: **41 suites / 299 tests passed, zero skipped, zero failures**.
- TypeScript `npm run build`: passed as part of the image build.
- `git diff --check`: passed.
- Visual inspection reproduced the old Thai missing-glyph box and verified the corrected `ก` avatar after installing Garuda.
- Tests used a separate disposable container, not the local stack database.

The completion checkpoint adds:

- `backend/tests/integration/authoringProfilesAndAssets.test.ts`: eight HTTP → image decoder → service → PostgreSQL scenarios; only DB transport is redirected.
- `backend/tests/services/authoringImageSafety.test.ts`: seven real-decoder cases for animated WebP, excessive pixels, EXIF/ICC removal, and orientation.
- `backend/tests/integration/authorAvatarFonts.test.ts`: Linux font coverage regression; skipped on macOS because its font registry differs.

Reproduction commands are in `README.md`, under Authoring integration tests. The
new profile/asset suite owns a unique schema and removes it afterward. Older
integration suites reset `public`, so the full suite requires a disposable database.

## Next slices

Slice 4 is the runner job protocol with minimal C++ fixtures. PDF template
extraction, statement sanitization, and asset-reference resolution belong to
Slice 7. Admin UI, square-crop controls, and the complete browser workflow belong
to Slice 10. Completing Slice 3 does not imply those later slices are implemented.
