# Admin Bulk Visibility, Stable Search, and Portable Problem Export

## Goal

Make Problem Management bulk visibility server-scoped across pagination, keep search controls mounted while asynchronous result states change, and export all portable problem metadata in the same format accepted by ZIP import.

## Scope and constraints

- Problem Management bulk visibility applies to every problem matching its current server-side filters, including current visibility, except contest-attached problems, which remain ineligible as today.
- Both the eligible count shown for confirmation and the bulk update use the same filters and the same `contest_id IS NULL` eligibility predicate.
- The table header checkbox continues to select only currently displayed/loaded rows.
- Search inputs keep their actual DOM node mounted through loading, empty, and error result states. Only inputs with server-side live search use debounce; local filters stay immediate.
- Request ordering/cancellation prevents stale searches from replacing newer results.
- ZIP export includes only the documented portable fields: `id`, `title`, `author`, `time_limit_ms`, `memory_limit_mb`, `categories`, `difficulty`, and `collection`.
- Preserve judge, submission, score, category vocabulary, difficulty validation, collection import semantics, contest behavior, and unrelated UI.
- Preserve the existing untracked `.codegraph/` directory in the original checkout. All implementation work stays in the approved isolated worktree.

## Current findings

`getAdminProblemsPage` constructs Search, Collection, Visibility, and Author predicates inline, applies them before keyset pagination, and returns rows, cursor, `hasMore`, and author options. `useProblemCrud.executeBulkVisibility` instead filters only loaded rows and issues one PUT per row. `ProblemManagement` replaces its entire page with `LoadingPage` whenever the query changes, which unmounts its search toolbar. The public Problems page already keeps its toolbar mounted on refresh and uses stale-request protection. The main Submissions page and Analysis Submissions tab have Problem ID and Username autocomplete inputs backed by `useAutocomplete`; the hook currently fetches each changed value without debounce or protection from out-of-order responses. Other search controls appear in admin contest/user management, authoring, two panels in the problem migration modal, and Analysis Problems/Users/Contests tabs. Their loading/error branches will be adjusted only where they can unmount a mounted control during a relevant fetch.

The ZIP importer schema already accepts category names, nullable difficulty, and collection names. The problem export route handles both one and multiple selected problems, but constructs config JSON from only the five base fields. Export data is retrieved through `getProblemExportBundle`.

## Design

### Approach choice

The selected approach is one shared server-side filter builder, a single bulk endpoint, and a canonical config serializer. It keeps pagination and bulk scope aligned, gives the UI an exact eligible count without loading records, and shares export formatting across every selected problem. Updating only loaded IDs would retain the bug; duplicating list and update predicates would allow scope drift; a generalized search-control framework would exceed this audit's needs.

### Server-side visibility scope

Extract the admin problem predicates into a shared, parameterized filter builder used by the paged query, eligible matching count, and bulk update. It accepts the existing server-supported filters and deliberately excludes cursor and limit from the bulk scope. Any future filter added to the admin query must flow through this shared builder so list, count, and update semantics cannot diverge.

Add a staff/admin-only `PATCH /admin/problems/visibility` endpoint following existing API naming conventions. Its request contains the target visibility plus the current filters. The service performs one parameterized `UPDATE` over all matches, including the active Visibility predicate as it existed when the update executes, and adds `p.contest_id IS NULL` to preserve existing eligibility. The paged list response also provides the count of matching eligible problems using the same builder and eligibility predicate. This count drives confirmation copy; no full-record fetch is used.

After a successful bulk update, the client clears selection and refetches the first page for the current filters. This recomputes rows, cursor, eligible count, and `hasMore`. On failure it keeps existing row data and shows the existing Admin error feedback. Header selection remains wired to displayed problem IDs and is not changed.

### Search control lifecycle

Keep each audited toolbar and modal search field mounted while results refresh, return no matches, or fail. Render loading/error/empty feedback in the result area. Preserve the current debounce interval for server-side searches and the current immediate behavior for local filters. Use each page's existing request-id, cancellation, or query-key behavior; add or correct stale-response protection only where the audit finds it missing. Do not add focus calls, query-derived React keys, or a new generalized design-system abstraction.

Audit targets are public Problems; the main Submissions page's Problem ID and Username autocomplete filters; admin Users, Problems, Contests, and Authoring; both searchable panels in the problem migration modal; and Analysis Problems, Users, Contests, and Submissions autocomplete filters. The source inventory found no search inputs on Scoreboard or Author Profiles. Also inspect any additional text-filter input discovered during implementation. Preserve URL parameters, selection semantics, Enter behavior, and accessibility labels.

### Portable export config

Create one canonical `serializeProblemConfig(problem)` serializer and use it for every problem folder added to the ZIP export. Export categories as canonical category-name arrays (empty when absent), difficulty as a number or `null`, and collection as the name or `null`. Extend the export bundle query to supply the collection name and portable metadata. Single and selected exports continue through the same ZIP route and serializer. Keep the importer schema and collection creation behavior unchanged; keep README's config schema aligned with serialized output.

## Failure behavior

- A failed bulk request does not optimistically alter row badges; loaded data stays available for retry and the normal Admin error message is shown.
- A failed search request leaves its input mounted and focused while displaying the error in the results area.
- A stale search response cannot overwrite results for a newer query.
- Export serializer values are derived from stored canonical problem metadata; no DB IDs, visibility, timestamps, or unrelated data are added.

## Verification

Backend tests cover filter construction and all-filter bulk scope, including zero filters, search, collection, author, visibility edge cases, combined filters, and contest exclusion. Integration coverage verifies one server-side update spans all matching rows regardless of loaded pages and leaves non-matches unchanged. Frontend tests distinguish displayed-row header selection from filter-wide bulk operations, verify confirmation count/scope, loading/error persistence of inputs, focus/caret continuity, pagination reset, modal search selection continuity, and autocomplete debounce/stale-response ordering. Export tests verify field types and values for categories (including empty), difficulty (rated and null), collection (name and null), multiple exports, and an export-to-import round trip.

Relevant backend and frontend test suites, type checks, and the isolated round-trip integration test will be run after implementation.
