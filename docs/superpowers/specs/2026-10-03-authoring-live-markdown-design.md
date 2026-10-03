# Authoring Markdown Editor: Continuous Editing and Live Preview

## Goal

Keep the authoring statement editor writable while autosaves are in flight, and update its Live HTML preview from the current Markdown without waiting for a save or a per-edit server render.

## Current behavior

- `useAuthoringDraft.save()` marks the whole authoring model busy while PATCH is pending. `edit()` rejects changes while busy, and `StatementEditor` makes the textarea read-only. Autosave begins 1.2 seconds after an edit.
- `StatementEditor` waits 400 ms after a source or revision change, then POSTs the full source to `/preview`. The backend reads draft and asset metadata, compiles and sanitizes Markdown, renders math, embeds assets and template resources, and returns the complete HTML document. The response sequence guard discards stale responses but does not cancel the backend work.
- Actual PDF is a separate runner job and remains the authoritative paginated artifact.

## Design

### Continuous editing and safe autosave

Autosave must never make the source textarea read-only or cause `edit()` to discard keystrokes. Keep save status visible, snapshot the values and expected revision for each PATCH, and serialize/coalesce saves so that edits made during a request are sent after its response using the newly returned revision. A save response may advance the server draft/revision, but must not replace a newer local form value. Preserve recovery snapshots and existing revision-conflict handling. An active authoring job may still lock source edits because it consumes a fixed draft revision; a network save alone may not.

### Local Live HTML rendering

Render the current source in the browser as it changes, independent of autosave. Reuse the existing Markdown, math, asset, and template behavior: GFM Markdown/raw HTML, current math delimiters and KaTeX safety limits, `{{ASSET_BASE}}` image references, supported tags/attributes/styles, and the existing template typography. Factor the canonical source-to-safe-fragment rules so browser preview and backend validation share the same implementation and pinned renderer versions. Keep the renderer work off the typing-critical path (a Web Worker or equivalent isolated async renderer); ignore out-of-order results by source generation.

The browser preview must remain in a sandboxed iframe with scripts disabled and a restrictive CSP. Resolve images only through the existing authenticated asset endpoint after matching their declared filenames to the draft's asset metadata. Do not execute author-provided HTML or scripts. Any syntax, math, safety, or asset error should be shown in preview status while retaining the user's source and allowing continued editing.

The preview's trusted template shell and static resources are loaded once per draft/template context, not rebuilt for each source change. If that requires a context endpoint, it must use the existing staff/admin authentication and private no-store response policy. Source changes must not issue a preview POST; save, verification, and PDF generation continue to use server-side canonical validation. Actual PDF behavior is unchanged.

## Security and compatibility constraints

- The backend remains authoritative for save-time and job-time validation; browser rendering does not authorize publishing.
- Match the pinned template renderer currently recorded in `backend/authoring/templates/red-gate-v1/PROVENANCE.md` (Marked 4.0.8 and KaTeX 0.15.1), or explicitly prove any version change preserves output and limits.
- Preserve the existing 2 MiB source limit, 1,000 math expression/expansion limits, safe-link policy, HTML allowlist, style allowlist, and asset allowlist.
- Keep the runner-built PDF and its pagination as the final output; Live HTML remains continuous-flow preview.

## Acceptance criteria

1. Typing remains uninterrupted while one or more autosave requests are pending.
2. If source changes during a save, the newer source is eventually saved at the next revision and is never overwritten by the earlier response.
3. Live HTML reflects unsaved Markdown edits without waiting for autosave or a server preview request; stale render results never replace newer content.
4. Markdown, supported raw HTML, math, and declared images preview correctly with the current template styling.
5. Unsafe HTML, external image URLs, undeclared assets, invalid math, and oversized inputs remain non-executable and are rejected/reported consistently with backend rules.
6. Preview errors do not block source editing or erase the source. Actual PDF still uses the existing build job and server-side compiler.

## Scope

Modify the authoring draft save coordination, full-screen statement editor, and statement rendering boundary shared by frontend preview and backend validation. Do not change PDF job execution, database draft revision semantics, publication behavior, or other authoring pages.
