# Authoring Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep authoring Markdown continuously editable during autosaves and render Live HTML from unsaved Markdown in the browser.

**Architecture:** Serialize and coalesce autosaves while preserving newer local form state. Extract the pinned Markdown, math, and sanitization behavior into a shared renderer package used by backend validation and a browser worker. Load a safe template context once per draft; each source update is rendered locally into the existing sandboxed preview frame.

**Tech Stack:** TypeScript, React 19, CRA 5/Webpack 5, Node 20, Marked 4.0.8, KaTeX 0.15.1, htmlparser2 10.0.0, Jest, Express.

**Spec:** `docs/superpowers/specs/2026-10-03-authoring-live-markdown-design.md`

## Global Constraints

- The server remains authoritative for save-time and job-time validation; browser rendering does not authorize publishing.
- Match the pinned template renderer currently recorded in `backend/authoring/templates/red-gate-v1/PROVENANCE.md` (Marked 4.0.8 and KaTeX 0.15.1), or explicitly prove any version change preserves output and limits.
- Preserve the existing 2 MiB source limit, 1,000 math expression/expansion limits, safe-link policy, HTML allowlist, style allowlist, and asset allowlist.
- Keep the runner-built PDF and its pagination as the final output; Live HTML remains continuous-flow preview.

## Review Focus

- Typing during a delayed save — the response must not replace newer text, and the next save must use the returned revision.
- Repeated edits while one save is pending — requests must serialize and converge on the latest text without skipped autosave.
- Renderer worker responses arriving out of order — only the newest source generation may replace the preview.
- Missing/deleted asset metadata and malformed asset URLs — preview must report the error and must not load arbitrary resources.
- Invalid, oversized, deeply nested, or hostile HTML/TeX — source remains editable and inert while the preview reports the failure.

---

### Task 1: Keep editing during autosave

**Files:**
- Modify: `frontend/src/features/admin/authoring/useAuthoringDraft.ts`
- Modify: `frontend/src/features/admin/authoring/StatementEditor.tsx`
- Test: `frontend/src/tests/hooks/admin/useAuthoringDraft.test.tsx`
- Test: `frontend/src/features/admin/authoring/StatementEditor.test.tsx`

**Interfaces:**
- Consumes: `authoringService.saveDraft(id, { expectedRevision, ...changes }): Promise<Draft>`.
- Produces: the existing hook API with serialized saves; editor changes remain accepted while `saveState === 'saving'`; active jobs still lock edits.

- [ ] **Step 1: Add regression tests** for (a) typing accepted while the first save promise is pending, (b) newer text preserved after that response, and (c) a follow-up save uses the returned revision and persists the newest text.
- [ ] **Step 2: Run the focused tests** and confirm they fail because the current busy guard blocks edits and save responses replace `form`.
- [ ] **Step 3: Implement a coalescing save queue** that snapshots submitted values, serializes PATCH requests, advances the expected revision from each response, preserves edits made after the snapshot, and schedules another save when newer changes remain. Remove save-busy from the source edit/read-only guards; keep active-job and published-draft rules.
- [ ] **Step 4: Run the focused tests** and confirm all three behaviors pass; run the frontend hook and editor test files together.
- [ ] **Step 5: Commit** as `fix: keep authoring source editable during autosave`.

### Task 2: Extract a shared canonical statement renderer

**Files:**
- Create: `shared/statement-renderer/package.json`
- Create: `shared/statement-renderer/index.js`
- Create: `shared/statement-renderer/index.d.ts`
- Create: `shared/statement-renderer/statementSanitizer.js`
- Create: `shared/statement-renderer/statementCompiler.js`
- Modify: `backend/package.json` and `backend/package-lock.json`
- Modify: `frontend/package.json` and `frontend/package-lock.json`
- Modify: `backend/Dockerfile`, `frontend/Dockerfile`, and `docker-compose.yml`
- Create: `.dockerignore`, `backend/.npmrc`, and `frontend/.npmrc`
- Modify: `backend/authoring/statementCompiler.ts`
- Modify: `backend/authoring/statementSanitizer.ts`
- Modify: `backend/services/authoringWorkspaceService.ts`
- Test: `backend/tests/services/statementCompiler.test.ts`
- Test: `frontend/src/features/admin/authoring/statementRenderer.test.ts`

**Interfaces:**
- Consumes: existing compiler semantics in `backend/authoring/statementCompiler.ts` and sanitizer semantics in `backend/authoring/statementSanitizer.ts`.
- Produces: CommonJS package `@oj/statement-renderer` with `compileStatementSource(source: string, assetNames: readonly string[]): string` and `renderStatementMath(html: string, renderMath?: (tex: string, display: boolean, timeoutMs: number) => string): string`; backend modules preserve their existing import paths by re-exporting compiler/sanitizer functions and the workspace service imports the shared math renderer while injecting its VM-bounded KaTeX callback.

- [ ] **Step 1: Add shared renderer tests** for current GFM/raw-HTML behavior, math delimiters and limits, the supported tag/attribute/style allowlists, safe links, image allowlisting, and rejection of scripts and malformed input.
- [ ] **Step 2: Run backend and shared renderer tests** and confirm new package imports fail before implementation.
- [ ] **Step 3: Implement the CommonJS package** with pinned Marked 4.0.8, KaTeX 0.15.1, and htmlparser2 10.0.0, using browser-safe APIs (no `node:vm`, `node:crypto`, or `Buffer`). Adapt backend compiler/sanitizer modules to re-export the shared canonical implementations without changing their callers; update `authoringWorkspaceService.ts` to use the shared math renderer.
- [ ] **Step 4: Update image build contexts** to the repository root, copy the shared package into each app build, enable npm `install-links` so local file dependencies are copied with their dependencies, and exclude secrets, generated output, and `node_modules` from the root Docker context.
- [ ] **Step 5: Run the backend compiler and sanitizer tests plus the frontend shared renderer tests** and confirm existing backend behavior and new shared tests pass.
- [ ] **Step 6: Commit** as `refactor: share canonical statement rendering rules`.

### Task 3: Provide a safe preview context without per-edit server rendering

**Files:**
- Modify: `backend/services/authoringWorkspaceService.ts`
- Modify: `backend/controllers/authoringWorkspaceController.ts`
- Modify: `frontend/src/services/admin/authoringService.ts`
- Test: `backend/tests/authoringWorkspaceController.test.ts`
- Test: `backend/tests/services/authoringWorkspaceService.test.ts`

**Interfaces:**
- Consumes: `buildPdfHtml`, `resources()`, the existing authenticated asset endpoint, and shared renderer from Task 2.
- Produces: `GET /admin/authoring/drafts/:id/preview-context` returning `{ html: string, assets: { id: string, filename: string }[] }`; `html` is the trusted, sanitized template shell with an empty statement element and CSP that permits only same-origin asset URLs and embedded template styles/fonts.

- [ ] **Step 1: Add controller/service tests** for staff authentication, private/no-store headers, template shell output, declared asset metadata, missing drafts, and restrictive CSP.
- [ ] **Step 2: Run the focused backend tests** and confirm the route is missing.
- [ ] **Step 3: Implement the context endpoint** to load draft/template/asset metadata once, reuse existing safe shell construction, and avoid compiling statement source or embedding all asset contents. Keep the existing `POST /preview` route for compatibility with other callers until Task 4 removes the editor dependency.
- [ ] **Step 4: Run the focused backend tests** and confirm the context response has no author script execution or per-source compilation.
- [ ] **Step 5: Commit** as `feat: expose safe authoring preview context`.

### Task 4: Render Live HTML locally in a worker

**Files:**
- Create: `frontend/src/features/admin/authoring/statementPreview.worker.ts`
- Create: `frontend/src/features/admin/authoring/useStatementPreview.ts`
- Modify: `frontend/src/features/admin/authoring/StatementEditor.tsx`
- Modify: `frontend/src/features/admin/authoring/Authoring.module.css`
- Modify: `frontend/src/services/admin/authoringService.ts`
- Test: `frontend/src/features/admin/authoring/StatementEditor.test.tsx`
- Test: `frontend/src/features/admin/authoring/useStatementPreview.test.ts`

**Interfaces:**
- Consumes: `@oj/statement-renderer.compileStatementSource`, `@oj/statement-renderer.renderStatementMath`, Task 3 `getPreviewContext(id)`, and existing `LivePreview` sandbox frame.
- Produces: `useStatementPreview(id, source)` returning `{ html, state, error }`; worker requests/responses carry a monotonically increasing generation. Image placeholders are replaced only when filename matches Task 3 metadata, using the authenticated asset URL for that draft.

- [ ] **Step 1: Add component/hook tests** proving unsaved source renders without `previewStatement` calls, stale generations are ignored, Markdown/math/assets are displayed, and unsafe/invalid source errors leave the editor writable.
- [ ] **Step 2: Run focused frontend tests** and confirm local preview integration is absent.
- [ ] **Step 3: Implement the worker and hook** using the shared canonical renderer, load the trusted preview context once per draft, resolve declared images to authenticated asset URLs, and preserve the sandboxed iframe and restrictive CSP. Keep errors in preview status without replacing source.
- [ ] **Step 4: Run focused frontend tests** and confirm no per-edit preview POST occurs and out-of-order results cannot replace current content.
- [ ] **Step 5: Commit** as `feat: render authoring markdown preview locally`.

### Task 5: Verify end-to-end parity and build compatibility

**Files:**
- Modify: relevant tests from Tasks 1–4 only if verification identifies a gap.

**Interfaces:**
- Consumes: completed save queue, shared renderer, context endpoint, and browser worker.
- Produces: validated frontend and backend builds with the existing PDF job path untouched.

- [ ] **Step 1: Run the complete focused test sets** for authoring draft hooks/editor, statement compiler/sanitizer, and preview context endpoint.
- [ ] **Step 2: Run frontend and backend type/build checks and build both images from the repository-root context**; confirm the shared package is included in both runtime bundles.
- [ ] **Step 3: Review security parity cases** from Review Focus and verify the worker/frame never execute source scripts or load undeclared assets.
- [ ] **Step 4: Commit any verification-only test corrections** as `test: cover live authoring preview boundaries`.
