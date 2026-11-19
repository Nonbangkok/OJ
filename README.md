# Grader System

<p align="center">
  <img src="assets/logo.png" alt="Grader Logo" />
</p>

The Grader System is a comprehensive online judge platform designed to facilitate competitive programming and programming education. It features a modern, responsive React frontend, a robust Node.js (Express) backend, and a PostgreSQL database, all orchestrated with Docker for seamless setup, deployment, and scalability. This system allows users to register, solve programming problems by submitting C++ or Python code, and receive real-time feedback on their submissions. Administrators have powerful tools to manage users, problems, contests, and the database, making it a versatile platform for various programming challenges.

**Target Audience:** This system is ideal for students, educators, and anyone interested in developing their programming skills through competitive programming or structured practice.

## Features

The Grader System offers a rich set of features for both users and administrators:

*   **User Management:**
    *   **User Registration and Login:** Secure user authentication with encrypted passwords and session management (case-insensitive unique usernames, per-account login lockout against brute force).
    *   **User Roles:** Differentiated access for regular users, staffs and administrators.
    *   **Password Management:** Self-service password change from the navbar user menu (keeps you signed in on this device, signs out all others), plus admin-initiated resets in User Management (signs the target out everywhere). Self-service changes can be disabled per-site by admins.
    *   **Batch User Creation (Admin):** Administrators can generate multiple user accounts with a defined prefix and random passwords.
    *   **User Profiles:** Public profile pages with submission statistics, verdict breakdowns, daily-activity heatmaps, streaks, achievements, a per-category radar chart, and XP progression.
    *   **XP / Level / Tier / Global Rank:** Solving problems awards XP based on difficulty; levels and tiers (Novice up to Grandmaster) are derived from the XP history, with a first-solve toast and rank on the global scoreboard.
*   **Problem Management:**
    *   **Problem Statements (PDF):** Upload and display problem descriptions in PDF format (up to 64 MiB per PDF).
    *   **Test Case Management:** Store and manage test cases (input/output) for each problem in the database, with a per-problem testcase viewer in the admin panel.
    *   **Header Problems:** A second problem type where the student implements one function instead of a whole program. The problem ships a data-structure header and a `student.h` template; the student submits only `student.h` and the judge compiles it against the problem's own secret `main.cpp`, which differs from the downloadable one so it can catch edits that break pre-existing functions. C++ only. Header problems can be created in the problem editor or imported with Batch Upload, but not yet from the Authoring Workspace ([#55](https://github.com/Nonbangkok/OJ/issues/55)). See [Header problems](#header-problems).
    *   **Single Problem Editor (Staff/Admin):** Create a problem from **New problem**, then edit its metadata, statement PDF, testcases (ZIP upload) and, for header problems, its grader and starter files on separate tabs.
    *   **Batch Problem Upload (Staff/Admin):** Import many problems at once, standard and header problems alike, from one structured ZIP (up to 2 GiB; larger than 50 MiB uploads go in chunks). See [Batch Problem Upload](#batch-problem-upload).
    *   **Problem Export (Staff/Admin):** Select problems in the list and choose **Export Selected** to download a ZIP in the batch-upload layout. Exported problems can be imported again with Batch Upload.
    *   **Bulk Actions (Staff/Admin):** On the selected problems you can add a category, set the difficulty, move them to a collection, change their visibility or delete them.
    *   **Rejudge (Admin):** Rejudge every submission of a problem against its current testcases and limits. This is also offered right after the testcases or grader files are replaced. You can rejudge a whole contest only until it finishes; after that its scoreboard is frozen, so rejudge its problems one by one instead.
    *   **Problem Visibility Control (Staff/Admin):** Toggle the visibility of problems to users, individually or across a whole collection at once. While a problem is attached to a contest, its visibility cannot change: the single toggle is refused (409) and the collection and bulk toggles skip it. It gets its pre-contest visibility back when it leaves the contest.
    *   **Categories and Difficulty:** Problems carry multiple algorithm categories (from a fixed list) and a Codeforces-like numeric difficulty (800–3500), filterable on the problem list.
    *   **Collections:** Organizational groups (e.g. teaching chapters) that problems can belong to.
    *   **Author Filter (Staff/Admin):** Problem Management can be filtered by author.
*   **Code Submission & Judging:**
    *   **C++ and Python Submission:** Users can submit C++ or Python (standard library only) solutions of up to 65,536 characters; Python gets time ×4 / memory ×2 limits to compensate for interpreter overhead. See [Judging](#judging) for the exact compiler flags.
    *   **Isolated Judging Environment:** Code is compiled and executed as an unprivileged per-submission sandbox identity, with a separate uid/gid and resource limits. While a program runs, a seccomp filter also denies networking, process creation (threads only) and SysV IPC. See [SANDBOX.md](SANDBOX.md).
    *   **Real-time Judging:** Submissions are judged promptly, with live status updates delivered over Server-Sent Events (polling fallback).
    *   **Detailed Results:** For each submission, users receive detailed results per test case, including status (Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit Exceeded, Runtime Error, Compilation Error, System Error).
    *   **Time and Memory Limits:** Configurable time and memory limits for each problem to control resource usage during judging.
*   **Contest Management:**
    *   **Contest Creation and Configuration (Admin):** Administrators can create and configure new programming contests with specific problems, start/end times, and a visibility (hide/show) setting independent of the schedule.
    *   **Contest Visibility (Admin):** Contests can be hidden from end users without touching their schedule or status — a reversible publishing gate.
    *   **Contest Participation:** Users can view available contests and join those that are currently active or scheduled.
    *   **Contest-Specific Submissions:** Submissions made within a contest are tracked separately from general problem submissions, ensuring contest integrity. When the contest ends they move into the practice pool and earn XP.
    *   **Contest Scoreboard:** Live scoreboard displaying participants' scores and rankings within a contest (updates pushed over SSE), frozen at contest end.
    *   **Cheat Detection (Staff/Admin):** Similarity detection flags pairs of contestants whose submissions for the same problem are at least 60% similar after normalization. For header problems the starter code is left out of the comparison.
*   **Scoreboard:**
    *   **Global Scoreboard:** A public scoreboard displaying user rankings based on their performance across all general problems, with tie-aware ranking.
*   **Authoring Workspace (Admin/Staff):** A full problem-authoring pipeline with these parts:
    *   drafts with author profiles;
    *   a Markdown/LaTeX statement editor with live preview;
    *   private reference solutions and generators;
    *   sandboxed testcase generation;
    *   PDF builds and mechanical verification;
    *   transactional publication into the problem pool.

    It also includes an in-app AI Docs API reference with a copy-for-AI-agent button. Authoring publishes **standard problems only**; header-problem support is tracked in [#55](https://github.com/Nonbangkok/OJ/issues/55).
*   **Site Access Modes (Admin):** PUBLIC mode allows guests to browse problems, submissions, and scoreboards read-only; PRIVATE mode requires login for all content.
*   **Analytics (Admin/Staff):** Submission analytics with overview KPIs, daily/hourly activity (site timezone), user/problem drill-downs, retention, and CSV export.
*   **Database Management (Admin Only):**
    *   **Export Database:** Administrators can export the database to a `.sql` dump file for backup purposes (session data is excluded).
    *   **Replace Database:** Administrators can restore the database from a `.sql`, `.dump`, or `.tar` file. The site enters maintenance mode (other requests answer 503) while the import runs, and the previous database is put back automatically if the import fails. **WARNING: a successful import PERMANENTLY REPLACES ALL EXISTING DATA with the contents of the uploaded file.** See [Database Management](#database-management-admin-only).
*   **Security & Limits:**
    *   **Rate Limiting:**
        *   1000 API requests per 15 minutes in general, counted per signed-in user (per client IP for guests);
        *   10 login or registration requests per 15 minutes per client IP;
        *   30 submissions per minute per user.

        Students on one school network therefore do not share a budget. Staff and admin sessions are exempt from the general and submission limits, but not from the login limit. After 10 failed logins in 15 minutes, the account is locked for 15 minutes.
    *   **Upload Caps:** Every upload route has a size cap, and ZIP archives are checked against their real inflated size. The caps are listed in [Upload limits](#upload-limits).
*   **Appearance:** Light and dark themes, a command palette, and a mobile tab bar for the main navigation.
*   **System Settings (Admin Only):**
    *   **Registration Toggle:** Administrators can enable or disable new user registrations.
    *   **Site Access Mode:** PUBLIC (default, guests can browse read-only) or PRIVATE (login required for content).
    *   **Password Change Toggle:** Enable or disable self-service password changes for users/staff (admins are exempt).

## Technology

The Grader System is built with a modern, type-safe tech stack (TypeScript-first), ensuring a robust, scalable, and responsive application.

*   **Frontend:**
    *   **React 19 & TypeScript:** Modern UI development with strong typing; ESLint enforces the React Compiler rules.
    *   **Vite:** Dev server and production build.
    *   **React Router 7:** For declarative routing and data loading.
    *   **Axios:** Promise-based HTTP client with typed API contracts.
    *   **CSS Modules:** Plain CSS per component, with no utility framework.
*   **Backend:**
    *   **Node.js 26 & Express 5 (TypeScript):** High-performance RESTful API framework.
    *   **PostgreSQL 18:** Robust relational database accessed via raw parameterized SQL, with versioned migrations.
    *   **Zod:** Centralized runtime validation for request schemas.
    *   **`bcrypt`:** Secure password hashing.
    *   **`multer` & `unzipper` & `archiver`:** File upload, extraction, and asset management.
    *   **`node-cron`:** For automated contest scheduling and lifecycle management.
    *   **`express-rate-limit`:** API, auth, and submission rate limiting.
    *   **Session-based Auth:** Secure authentication using `express-session` and `connect-pg-simple`, revalidated against the database on every request.
*   **Judging System:**
    *   **C++:** Compiled with GCC (C++20) and executed in a per-submission sandbox identity.
    *   **Python:** Standard-library-only interpreter execution with adjusted time/memory limits.
    *   **`time_wrapper`:** A small C helper. It applies the resource limits, drops to the sandbox uid, installs the seccomp filter and reports the CPU time and peak memory it measured.
*   **Containerization & Deployment:**
    *   **Docker & Docker Compose:** Containerized microservices for consistent environments.
    *   **Nginx:** Reverse proxy handling `/api` routing and frontend serving.
*   **Tools & Testing:**
    *   **Jest & Supertest:** Comprehensive backend integration and unit testing.
    *   **React Testing Library:** Component-level testing for the frontend.
    *   **Playwright:** Visual regression baselines for the frontend.
    *   **GitHub Actions:** CI on pull requests and pushes to `main`, and a deploy workflow that waits for a human approval.
    *   **Git:** Version control and collaboration.

## Prerequisites

To get the Grader System up and running, you only need to install a few essential tools on your host machine. The rest of the application's dependencies (Node.js, npm, PostgreSQL) are managed within Docker containers.

*   **[Docker](https://www.docker.com/):** Essential for containerizing, building, running, and managing the application's services.
*   **[Git](https://git-scm.com/downloads):** Required to clone the project repository for local development and version control.
*   **Node.js 26 (optional):** Required only for running npm and root-level smoke
    tests directly on the host. Docker remains the primary runtime.

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Nonbangkok/OJ.git
    cd OJ
    ```

2.  **Create the local environment file:**
    ```bash
    cp .env.example .env
    ```
    Change `POSTGRES_PASSWORD` and `SECRET_KEY` before sharing the environment
    with anyone. The remaining defaults are suitable for plain HTTP on localhost.

    | Variable | Purpose |
    |---|---|
    | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database name and credentials. Compose derives the backend's `DATABASE_URL` and `PG*` variables from them. |
    | `SECRET_KEY` | Signs the session cookie. Use a long random value. |
    | `NODE_ENV` | `development` locally, `production` on a server. |
    | `COOKIE_SECURE` | Must be `true` in any production deployment over HTTPS; the backend refuses to start in production without it. |
    | `COOKIE_DOMAIN` | Optional cookie domain, e.g. to share the session with the upload hostname. |
    | `CORS_ORIGINS` | Comma-separated extra origins allowed to call the API with cookies; each one must be a full URL. |
    | `TRUST_PROXY` | Number of proxy hops in front of the backend (default `1`, the bundled Nginx). Rate limits use the client IP that Nginx passes on. |
    | `HTTP_PORT` | Host port for the app (default `80`). |
    | `OJ_DISABLE_LOGIN_LIMIT` | Not in `.env.example`; Compose passes it through with a default of `false`. `true` turns off login throttling. Use it only on a deliberately trusted deployment. |
    | `REACT_APP_API_URL` | API base path baked into the frontend build (default `/api`). |
    | `REACT_APP_LARGE_UPLOAD_API_URL` | Optional DNS-only origin endpoint for large admin uploads (batch ZIPs, database imports) to bypass proxied upload size limits. |

    `docker-compose.yml` also sets `AUTHORING_JOBS_DIR=/jobs`, the job volume
    shared with the authoring runner. Optionally, you can add `OJ_WORK_DIR` to
    the backend's `environment` to choose where the backend keeps its private
    temporary files. It defaults to the OS temp directory. The directory must
    be owned by the backend user and must not be a shared directory such as
    `/tmp`; otherwise the backend refuses to start.

## Running the Project

Once the installation and setup are complete, you can start the application:

1.  **Build and Run Docker Containers:**
    Navigate to the root directory of the project (where `docker-compose.yml` is located) and execute the following command:
    ```bash
    docker compose up --build -d
    ```
    *   Already have a local stack with data from before Postgres 18? Run
        `scripts/pg18-migrate.sh --env-file .env -f docker-compose.yml` first (see
        [the runbook](docs/runbooks/postgres-18-upgrade.md)); otherwise compose
        creates an empty Postgres 18 database and the old data stays in
        `<project>_db-data`.
    *   The first time you run this command, it might take several minutes as Docker downloads the PostgreSQL image and builds the frontend and backend images. The stack runs six services: `database`, a one-shot `migrate` job, `backend`, an isolated `authoring-runner` (no network), `frontend`, and `nginx-proxy`.
2.  **Access the Application:**
    After the containers have successfully started, open your web browser and navigate to:
    [http://localhost](http://localhost)
    The Nginx proxy, running in its own Docker container, handles routing. Requests to `/` are forwarded to the `frontend` service, while requests to `/api/` are rewritten and forwarded to the `backend` service.

## Database Initialization

The `migrate` service applies versioned, non-destructive migrations before the
backend starts. A fresh database therefore needs no manual schema command, and
restarting the stack does not erase existing data.

To create the first administrator account, run the interactive script after the
stack is healthy:

```bash
docker compose exec backend node dist/scripts/create_admin.js
```

Other maintenance scripts live in `backend/scripts/`:

- `backfill_xp.ts` awards XP for solves made before XP existed.
- `seed_xp_tiers.ts` is a demo seeder that refuses to run with `NODE_ENV=production`. It prints a random password once per run, or uses `XP_DEMO_PASSWORD` if set.

Runtime checks are available at `/api/health/live` (process) and
`/api/health/ready` (database and schema readiness).

### Database migrations

Apply pending non-destructive schema migrations from the host:

```bash
cd backend
npm run db:migrate
```

Production `npm start` applies the same migrations after compilation and before
the API starts. Applied versions are recorded in `schema_migrations`; rerunning
the command is safe.

`backend/scripts/init_db.ts` is a destructive development reset that drops
existing tables. Do not use it to upgrade an existing database.

## Production Configuration

Production uses the same base Compose file plus a production-only overlay. This
keeps local HTTP, cookies, and ports separate from the public domain, secure
cookies, allowed origins, certificates, and Cloudflare tunnel.

```bash
cp .env.production.example .env
# Replace every placeholder in .env before continuing.
docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
./deploy.sh
```

### Continuous deployment

Pushes to `main` that pass CI can be deployed by approving the **Deploy**
workflow run in GitHub (it waits on the `production` environment's required
reviewers). The server runs `scripts/cd-deploy.sh`, which checks that no contest
is running, backs up the database, calls `./deploy.sh`, verifies the result and
rolls back automatically if it fails. `deploy.sh` remains the way to deploy by
hand. How to approve, read a failed deploy and restore a backup:
[docs/runbooks/continuous-deployment.md](docs/runbooks/continuous-deployment.md).

Upgrading an existing Postgres 16 deployment to Postgres 18 is a one-time manual
migration: `deploy.sh` refuses to start until it is done. Follow
[docs/runbooks/postgres-18-upgrade.md](docs/runbooks/postgres-18-upgrade.md).

The production overlay sets `NODE_ENV=production`, enables secure cookies, mounts
the production Nginx configuration and certificate directories, publishes HTTPS
for the DNS-only large-upload hostname, and starts the Cloudflare tunnel. The
certificate at `/etc/letsencrypt/live/nonbangkokgrader.com/` must cover the main, `www`,
and `upload` hostnames. Do not use this overlay as the localhost configuration.

## Testing

The project includes automated tests for both the backend and frontend. You can run the full test suite or run tests for each part separately.

### Run All Tests

From the project root, execute the unified test script to run both backend and frontend tests:

```bash
./tests/run_tests.sh
```

*   This script runs backend tests first, then frontend tests. It exits with status code 0 if all tests pass, or 1 if any test fails.
*   Most backend tests mock PostgreSQL. The migration integration test requires a
    PostgreSQL test URL and is skipped unless `INTEGRATION_DATABASE_URL` is provided.

### Authoring integration tests

To run the complete backend suite including Slices 4–10 HTTP → PostgreSQL → isolated
C++/PDF runner and end-to-end authoring checks, use the dedicated disposable stack
from the repository root:

```bash
docker compose -p oj-authoring-tests -f tests/authoring/compose.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -p oj-authoring-tests -f tests/authoring/compose.yml down -v
```

The same file has an opt-in `judge-tests` service. It runs the judge runtime suites
under the backend's production capability set: no `CAP_KILL`, no
`CAP_DAC_OVERRIDE`, no `CAP_FOWNER`, and an init that reaps orphans. The sandbox
sweep and the uid-dropped cleanup are only exercised for real under those caps.
CI runs it on every pull request and push to `main`:

```bash
docker compose -p oj-authoring-tests -f tests/authoring/compose.yml --profile judge run --rm judge-tests
```

Clean up afterwards with the same `down -v` command as above.

This stack publishes no ports, uses a temporary database, and shares only its own
job volume with the network-disabled runner. The cleanup command deletes only this
test project's containers/network/job volume. Do not reuse its project name for
a stack containing real data. Protocol, limits, recovery, and configuration are
documented in [`.context/AUTHORING_RUNNER.md`](.context/AUTHORING_RUNNER.md).
Slice 5 generator/seed and manual testcase API conventions are documented in
[`.context/AUTHORING_TESTCASES.md`](.context/AUTHORING_TESTCASES.md).
Slice 6 output generation and Slice 7 statement/PDF contracts are documented in
[`.context/AUTHORING_OUTPUTS.md`](.context/AUTHORING_OUTPUTS.md) and
[`.context/AUTHORING_PDF.md`](.context/AUTHORING_PDF.md).

After building the runner image above, verify the actual PDF runtime and approved
three-page Red Gate layout (Poppler `pdftoppm` must be on PATH for the last command):

```bash
mkdir -p output/pdf
docker run --rm --network none --read-only --init \
  --label com.docker.compose.project=oj-pdf-runtime-tests \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --cap-add SETUID --cap-add SETGID --cap-add KILL --cap-add SYS_CHROOT --cap-add DAC_OVERRIDE \
  --pids-limit 256 --memory 1g --cpus 1 \
  --tmpfs /work:rw,exec,nosuid,nodev,size=768m,mode=0755 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
  -v "$PWD/tests/authoring/pdf-runtime.mjs:/tests/pdf-runtime.mjs:ro" \
  -v "$PWD/backend/tests/fixtures/pdf:/fixtures:ro" \
  -v "$PWD/output/pdf:/qa" -e PDF_QA_OUTPUT=/qa \
  --entrypoint node oj-authoring-tests-authoring-runner --test /tests/pdf-runtime.mjs
node tests/authoring/pdf-visual.mjs
```

The visual check ignores PDF timestamps by comparing rasterized pages. A difference
fails explicitly; inspect the pages instead of automatically replacing the baseline.

Slice8 Verify All is documented in [`.context/AUTHORING_VERIFY.md`](.context/AUTHORING_VERIFY.md).
Slice9 Publish, hidden legacy-record mapping, privacy and transactional conflicts
are documented in [`.context/AUTHORING_PUBLISH.md`](.context/AUTHORING_PUBLISH.md).
Slice10 Admin UI, fast preview, history polling and browser workflow are documented
in [`.context/AUTHORING_UI.md`](.context/AUTHORING_UI.md).
The full Compose suite includes real Verify→Publish and rollback/concurrency tests.
The standalone runtime matrix checks exact output matching, compile-only generators,
runtime failures, resource bounds and expected-output isolation with the same worker image:

```bash
docker run --rm --network none --read-only --init \
  --label com.docker.compose.project=oj-verify-runtime-tests \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --cap-add SETUID --cap-add SETGID --cap-add KILL --cap-add SYS_CHROOT --cap-add DAC_OVERRIDE \
  --pids-limit 256 --memory 1g --cpus 1 \
  --tmpfs /work:rw,exec,nosuid,nodev,size=768m,mode=0755 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
  -v "$PWD/tests/authoring/verify-runtime.mjs:/tests/verify-runtime.mjs:ro" \
  -v "$PWD/backend/tests/fixtures/pdf:/fixtures:ro" \
  --entrypoint node oj-authoring-tests-authoring-runner --test /tests/verify-runtime.mjs
```

The commands below run integration tests without the separate runner; the
HTTP-to-runner cases are skipped when `INTEGRATION_RUNNER_SPOOL` is unset.

The Slice 3 integration suite sends HTTP requests through real image processing and
PostgreSQL transactions. It creates a randomly named schema and removes only that
schema when finished. The older migration/restore tests reset the `public` schema,
so run the complete integration suite only on a disposable database.

From the repository root, build the backend and start a dedicated test database:

```bash
docker build -f backend/Dockerfile -t oj-authoring-test-backend .
docker run --rm -d --name oj-authoring-test-db \
  -e POSTGRES_USER=oj_test -e POSTGRES_PASSWORD=oj_test -e POSTGRES_DB=oj_test \
  postgres:18-alpine
docker exec oj-authoring-test-db pg_isready -U oj_test -d oj_test
```

Once `pg_isready` reports accepting connections, run the suite in Node 26 with the
same native dependencies and fonts as the deployed backend:

```bash
docker run --rm --network container:oj-authoring-test-db \
  -e INTEGRATION_DATABASE_URL=postgres://oj_test:oj_test@127.0.0.1:5432/oj_test \
  oj-authoring-test-backend npm test -- --runInBand --verbose=false
docker stop oj-authoring-test-db
```

No production/local-stack database or persistent volume is used by these commands.
For host-only tests, provide a disposable `INTEGRATION_DATABASE_URL`. On Linux,
install `fontconfig`, `fonts-dejavu-core`, and `fonts-tlwg-garuda` for fallback-avatar
Thai/Latin coverage. The font-registry check runs on Linux and is skipped on macOS.

### Header-problem content tests

Two backend suites use the bundled header problems from the public
[CP-Author](https://github.com/Nonbangkok/CP-Author) repository. By default both
read a sibling checkout at `../CP-Author/header-problems`, and both are skipped
when it is absent.

- **`tests/integration/headerProblemsImport.test.ts`** imports the built ZIP, so
  it needs `./run.sh build` first, and it also needs `INTEGRATION_DATABASE_URL`.
- **The bundled-problem case of `tests/services/headerSourceGuard.test.ts`**
  reads the problem sources directly, so a plain clone is enough.

To run them, clone CP-Author next to this repository and build it:

```bash
git clone https://github.com/Nonbangkok/CP-Author.git ../CP-Author
```

```bash
(cd ../CP-Author/header-problems && ./run.sh build --all)
```

To point the suites somewhere else, set `HEADER_PROBLEMS_DIST`,
`HEADER_PROBLEMS_SRC` or `HEADER_PROBLEMS_CONTENT`.

### Repository and Session Smoke Tests

The repository-level tests check the Compose files, the deploy scripts and the
workflows without a running stack. CI runs the same list:

```bash
node --test tests/composeConfig.test.mjs tests/nodeVersion.test.mjs tests/nginxVersion.test.mjs tests/pg18Guard.test.mjs tests/frontendCaching.test.mjs tests/proxyHealthcheck.test.mjs tests/refreshProxy.test.mjs tests/deployWorkflow.test.mjs tests/cdDeployStructure.test.mjs tests/cdDeployGuards.test.mjs tests/cdDeployRollback.test.mjs tests/dbRestoreRunbook.test.mjs tests/frontendPublicAssets.test.mjs
```

The session smoke test needs the stack running on the default port:

```bash
BASE_URL=http://127.0.0.1 node --test tests/localSessionSmoke.test.mjs
```

The session smoke test creates a uniquely named local test user, verifies the cookie,
reads the authenticated session, logs out, and confirms that the session is gone.

### Run Backend Tests Only

From the project root:

```bash
cd backend
npm test
```

*   Backend tests use **Jest** and **Supertest** to test API endpoints, controllers, and middleware (e.g., authentication, submissions, problems, contests, admin).
*   Backend tests are located in `backend/tests/`.
*   Always go through `npm test` rather than bare `npx jest`. The script sets `NODE_ENV=test` and `--experimental-vm-modules`, which an ESM-only dependency needs.
*   To run one file, use `npm test -- path/to/file.test.ts`. To run tests by name, use `npm test -- -t "name"`.

### Run Frontend Tests Only

From the project root:

```bash
cd frontend
npm test
```

*   Frontend tests use **Jest** and **React Testing Library** (`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) to test pages, hooks, services, and components.
*   By default, `npm test` runs in **watch mode** (re-runs on file changes). To run once and exit (e.g., in CI), use:
    ```bash
    npm run test:ci
    ```
*   Frontend tests are located in `frontend/src/tests/`.
*   Before pushing, run `npm run validate` (type-check, lint and the tests once with coverage); CI runs the same command. The dev server (`npm start`) does not report lint or type errors.
*   Coverage is enforced on `src/services/*.ts`: 85% of branches and 90% of lines.
*   Playwright visual baselines cover the admin shell, Manage, Authoring, student and contest pages, at desktop and mobile widths, against a mocked API:
    ```bash
    npm run test:visual           # compare against the committed baselines
    npm run test:visual:update    # regenerate them after an intentional UI change
    ```

## Database Management (Admin Only)

The system provides administration tools for exporting and replacing the entire
database, useful for backups, moving to another server or emergency recovery.
Both live in **Manage → Settings**, which only admins see.

Everything the site stores is in the database, including problem PDFs,
testcases, grader and starter files, avatars, author images and statement
assets. An export therefore holds the whole site, and so does a restore.

### Export Database

1.  Open **Manage → Settings**.
2.  Under **Data**, click **Export** next to *Export database*.
3.  The browser downloads `oj_backup_<timestamp>.sql`, a plain `pg_dump` of the
    whole database.

The export leaves out `user_sessions`, so a dump never carries live login
cookies. Treat the file as a secret anyway: it holds every password hash,
grader file and hidden testcase.

### Replace Database

**WARNING:** a successful import **PERMANENTLY REPLACES ALL EXISTING DATA**
with the contents of the uploaded file.

1.  Open **Manage → Settings**.
2.  Under **Danger zone**, click **Replace database…**.
3.  Drop a `.sql`, `.dump` or `.tar` file (up to 2 GiB) into the dialog.
4.  Type `IMPORT` to confirm and click **Replace database**.

Accepted files:

- **`.sql`**: plain `pg_dump` output, such as an export from this page. A file
  with psql meta-commands (such as `\!` or `\connect`) at statement level is
  rejected before anything changes.
- **`.dump` / `.tar`**: `pg_dump` custom or tar archives. They must pass
  `pg_restore --list` and are restored with `--no-owner --no-privileges`, so an
  archive from an install with other role names still restores.

What the import does:

1.  It checks the file. A file that fails the check is refused with a 400, and
    nothing changes.
2.  It turns on maintenance mode: every other request gets a 503 until it ends.
3.  It waits for running judge tasks, the contest scheduler and the authoring
    coordinator to finish.
4.  It takes a safety copy of the current database.
5.  It empties the database in one statement, then restores the upload in a
    single transaction and applies any pending migrations.
6.  If any of this fails, it puts the safety copy back. If that also fails, the
    copy is kept on the backend server for manual recovery, and the error
    message says where.

The import is refused with a 409 while a batch problem upload or another import
is running.

What changes after a successful import:

- **Everyone is signed out**, including the admin who ran it, because an
  export from this page leaves the sessions out. A dump made some other way
  that includes `user_sessions` restores those sessions. The progress dialog keeps working, because it
  is authorized by its own token.
- **Submissions that were in progress when the dump was taken** are recovered
  the way a restart recovers them:
  - `Pending` rows are judged again.
  - `Compiling` and `Running` rows become a System Error asking the student to
    resubmit.
- **Anything written after the export is gone**, because the dump is a snapshot
  of that moment.

You do not need to empty or drop the database yourself before importing. The
import already does that, and it can only take a safety copy of data that is
still there.

## Problems Management

Staff and admins manage problems in **Manage → Problems**. Staff can do
everything there except rejudge, which is admin-only.

### Single Problem Editor

Click **New problem** to create one, then open it to edit it on these tabs:

| Tab | What it holds |
|---|---|
| **General** | Problem ID (renaming moves its submissions and contest links), title, author, collection, time limit (ms), memory limit (MB), difficulty, categories, problem type (`Standard` / `Header`), submission filename (header only) and visibility. |
| **Statement** | The statement PDF, up to 64 MiB. A new PDF replaces the old one for everyone at once. |
| **Testcases** | A viewer for every case, plus **Replace all testcases**: drop a flat ZIP of `N.in` / `N.out` pairs (`inputN.txt` / `outputN.txt` and `.sol` outputs work too). ZIPs over 50 MiB upload in chunks. |
| **Grader files** | Header problems only: the `grader` and `starter` file sets. See [Header problems](#header-problems). |
| **Danger zone** | Delete the problem. |

The testcase ZIP may hold at most 256 MiB of testcase files once inflated, and
at most 64 MiB per file. Replacing testcases **clears all existing testcases**
first. After testcases or grader files are replaced, admins are offered a
rejudge of the problem's submissions.

### Batch Problem Upload

Click **Import ZIP** on the problem list to upload many problems in one `.zip`,
standard and header problems alike. A ZIP of up to 50 MiB goes up in one
request; larger ones, up to 2 GiB, upload in chunks. Once extracted, an archive
may hold at most 500 MB and 5000 entries, counting folders.

*   **Zip File Structure:** The uploaded `.zip` file can follow two main structures:
    *   **Single Problem ZIP:** The root of the ZIP contains all files for one problem (`config.json`, PDF, and test cases).
    *   **Multiple Problems ZIP:** The root of the ZIP contains multiple directories, where each directory represents a distinct problem.

Each problem is imported in its own transaction. A problem that fails is rolled
back on its own and reported with its error, and the rest of the batch
continues. New problems are created **hidden**. Progress is shown live while the
batch runs.

The archive format is the same one **Export Selected** writes, so exported
problems can be imported into another site.

**A problem whose `id` already exists is not re-imported.** It is reported as
*skipped*, and only its `categories`, `difficulty` and `collection` are updated
from `config.json` (see below). Its title, author, limits, PDF, testcases,
problem type and grader/starter files stay as they are; change those in the
problem editor.

### ZIP File Structure Examples

#### Structure 1: Single Problem ZIP

The ZIP file contains all necessary files for a single problem at its root level.

```
Problem.zip
├── config.json
├── Problem.pdf
└── testcases/
    ├── input/
    │   ├── 1.in
    │   └── 2.in
    └── output/
        ├── 1.out
        └── 2.out
```

#### Structure 2: Multiple Problems ZIP

The ZIP file contains multiple problem directories. The system will iterate through each directory and process it as a separate problem, demonstrating the various ways test cases can be structured.

```
ProblemSet.zip
├── MyFirstProblem/
│   ├── config.json
│   ├── MyFirstProblem.pdf
│   └── testcases.zip  (Internal structure: Flat)
│       ├── 1.in
│       ├── 1.out
│       ├── input_02.txt
│       └── output_02.txt
│
├── MySecondProblem/
│   ├── config.json
│   ├── MySecondProblem.pdf
│   └── testcases/  (Internal structure: Directories)
│       ├── input/
│       │   ├── 01.in
│       │   └── 02.in
│       └── output/
│           ├── 01.out
│           └── 02.out
│
└── MyThirdProblem/
    ├── config.json
    ├── MyThirdProblem.pdf
    └── data/  (Internal structure: Flat directory)
        ├── case_01.txt
        ├── out_case_01.txt
        ├── case_02.txt
        └── out_case_02.txt
```

### Problem Directory Contents Structure

Each problem directory (either at the root of a multi-problem ZIP or the content of a single-problem ZIP) must contain:

1.  **`config.json`:** A JSON file detailing the problem's metadata.
    ```json
    {
      "id": "plus",
      "title": "Plus",
      "author": "Nonbangkok",
      "time_limit_ms": 1000,
      "memory_limit_mb": 32,
      "categories": ["Math", "Implementation"],
      "difficulty": 800,
      "collection": "Chapter 1"
    }
    ```
    *   `id`: A unique string identifier for the problem (e.g., "plus").
    *   `title`: The display name of the problem (e.g., "Plus").
    *   `author`: The author of the problem.
    *   `time_limit_ms`: The maximum allowed execution time for a solution, in milliseconds.
    *   `memory_limit_mb`: The maximum allowed memory usage for a solution, in megabytes.
    *   `categories` *(optional)*: An array of category names from the fixed list below. Whitespace is trimmed and duplicates are removed. An empty array (or `null`) means uncategorized. Unknown names are rejected with an error that names the offending value and the allowed list — the importer never creates arbitrary categories.
        *   Allowed: `Dynamic Programming`, `Greedy`, `Graph`, `Tree`, `Data Structures`, `String`, `Math`, `Geometry`, `Divide and Conquer`, `Binary Search`, `Constructive`, `Bitmasks`, `Sorting`, `2D-Grid`, `Implementation`, `Other`
    *   `difficulty` *(optional)*: A rating on the same 800–3500 scale (in steps of 100) used by normal problem editing. `null` (or omitting the field on a **new** problem) means Unrated. Values outside the scale, non-integers, or strings are rejected.
    *   `collection` *(optional)*: The **name** of a collection (e.g., `"Chapter 1"`) — a name, not a numeric id, so archives stay portable across databases. If a collection with that name exists it is reused; otherwise it is created once (multiple problems in one batch referencing the same new name all land in the same collection). An empty/whitespace-only string is treated the same as `null`: no collection.
    *   `problem_type` *(optional)*: `"standard"` (the default when omitted) or `"header"`. Only a header problem may have `grader/` and `starter/` folders. See [Header problems in a batch ZIP](#header-problems-in-a-batch-zip).
    *   `submission_filename` *(optional, header problems only)*: The file name students submit, ending in `.h` or `.hpp`; defaults to `student.h`. Setting it on a standard problem is an error.

    **Updating an existing problem** (a ZIP whose `config.json` `id` matches an existing problem — the problem is reported as *skipped*, not re-created, but its metadata fields below are applied). For the three optional fields, omitted vs. explicit matters:
    *   **Field omitted** → the stored value is **preserved**.
    *   **Field set to `null`** (or `[]` for categories, or `""` for collection) → the stored value is **cleared**.
    *   **Field set to a value** → the stored value is **replaced**.

    Example: importing an existing problem with `{"id": "plus", "title": "Plus", "author": "Nonbangkok", "time_limit_ms": 1000, "memory_limit_mb": 32, "difficulty": null}` keeps its current categories and collection but clears its rating. (PDF, test cases and grader/starter files of existing problems are managed in the problem editor, not the ZIP import.)

    A problem that fails validation is reported per-problem with a specific message (e.g., `Problem "tree-dp": config.json "categories.0" is invalid: Unknown category "Graphs". Allowed: ...`); the rest of the batch continues, and any collection the failed problem would have created is rolled back.

2.  **Problem Statement PDF:**
    A single `.pdf` file containing the problem description. The system will automatically detect and use the first PDF file found within the problem's directory. A file that does not start with `%PDF` is skipped and reported in the log.

3.  **Test Cases:**
    Test cases can be organized in one of several flexible formats:

    *   **Option A: Zip Archive (`testcases.zip`)**
        A single `.zip` file named `testcases.zip` placed within the problem directory. This inner ZIP file can itself have two internal structures:
        1.  **Flat Structure:** Input and output files are directly at the root of `testcases.zip`. Files must be numerically paired. Supported naming conventions include: `input1.in`/`output1.out`, `1.in`/`1.out`, `input1.txt`/`output1.txt`, `test_01.in`/`test_01.out`, `case_A.in`/`case_A.out`, etc.
            ```
            Internal structure of MyFirstProblem/testcases.zip
            ├── 1.in
            ├── 1.out
            ├── input_02.txt
            └── output_02.txt
            ```
        2.  **Directory Structure:** The `testcases.zip` contains `input/` and `output/` subdirectories. All input files go into `input/`, and all corresponding output files go into `output/`. Files are paired by sorting them alphabetically/numerically.
            ```
            Another example of a testcases.zip internal structure
            ├── input/
            │   ├── 01.in
            │   └── 02.in
            └── output/
                ├── 01.out
                └── 02.out
            ```

    *   **Option B: `input`/`output` Subdirectories**
        Instead of a `testcases.zip`, you can provide a subdirectory (e.g., `testcases/` or `data/`) that directly contains two subfolders: `input/` and `output/`.
        All input files are placed in `input/`, and their corresponding output files in `output/`. Files are paired by sorting them alphabetically/numerically (e.g., `01.in` in `input/` matches `01.out` in `output/`).

        ```
        Internal structure of problem testcases , Option B :
        └── testcases/
            ├── input/
            │   ├── 01.in
            │   └── 02.in
            └── output/
                ├── 01.out
                └── 02.out
        ```

    *   **Option C: Flat Directory Structure**
        As an alternative, you can place all test case files directly within a single subdirectory (e.g., `testcases/` or `data/`). The system will pair files based on the numbers in their filenames (e.g., `input1.txt` with `output1.txt`, `case_02.in` with `case_02.out`, `test_01.in` with `test_01.out`, `case_A.in` with `case_A.out`).

        ```
        Internal structure of problem testcases , Option C :
        └── data/
            ├── input1.txt
            ├── output1.txt
            ├── case_02.in
            └── case_02.out
        ```
        
    *   **Recommendation:** It is highly recommended to use numerically sequential and consistently named test case files (e.g., `01.in`, `02.in`, ..., `01.out`, `02.out`, ...) to ensure correct pairing and ordering during the judging process. This helps avoid unexpected behavior across different file systems and parsing logic.

    *   Folders named `grader` and `starter` are never read as testcases.

### Header problems in a batch ZIP

A header problem uses the same layout plus two flat folders and two
`config.json` keys:

```
queue_reverse/
├── config.json         # "problem_type": "header", optional "submission_filename"
├── queue_reverse.pdf
├── grader/             # secret: compiled with the submission, never served to students
│   ├── main.cpp
│   └── queue.h
├── starter/            # what students download as a ZIP
│   ├── main.cpp
│   ├── queue.h
│   └── student.h
└── testcases/
    ├── input/
    └── output/
```

```json
{
  "id": "queue_reverse",
  "title": "Queue Reverse",
  "author": "Nonbangkok",
  "time_limit_ms": 1000,
  "memory_limit_mb": 64,
  "problem_type": "header",
  "submission_filename": "student.h"
}
```

Rules the import enforces (a problem that breaks one is reported and rolled back):

*   `grader/` and `starter/` must be flat, with no sub-folders; `.DS_Store` is
    ignored. Each folder holds at most 20 files of up to 1 MiB each.
*   The `grader/` set follows the [grader file rules](#grader-and-starter-files).
    An empty or missing `grader/` is allowed, but the problem cannot take
    submissions until a grader is uploaded in the problem editor.
*   On a **new** problem, a `grader/` or `starter/` folder next to a
    `config.json` without `"problem_type": "header"`, for example with the key
    misspelled, is an error rather than being silently dropped.
*   An existing problem `id` is skipped as described above, so a batch never
    changes an existing problem's type or grader files.

The ZIP that CP-Author's `./run.sh build` writes (`dist/header-problems.zip`)
already has this layout. See [The bundled 50-problem set](#the-bundled-50-problem-set).

### Upload limits

| Upload | Limit |
|---|---|
| Batch problem ZIP | 2 GiB upload (chunked above 50 MiB); at most 500 MB and 5000 entries once extracted |
| Statement PDF (problem editor) | 64 MiB |
| Testcase ZIP (problem editor) | chunked above 50 MiB; at most 256 MiB of testcase files once inflated, 64 MiB per file |
| Grader / starter ZIP | 25 MiB; at most 20 files of 1 MiB each per role |
| Database import | 2 GiB |
| User avatars, author profile images, statement assets | 10 MiB |
| Submission source | 65,536 characters |

An upload over its limit is refused before anything is stored. The inflated
sizes of a ZIP are counted from the bytes actually read, not from the sizes the
archive declares.

## Judging

Submissions are judged one at a time, and the rest wait in a queue. Each
compile and each run happens as a dedicated, unprivileged sandbox user; [SANDBOX.md](SANDBOX.md) has
the full threat model.

*   **C++** is compiled with
    `g++ -std=c++20 -fsanitize=signed-integer-overflow -fno-sanitize-recover=signed-integer-overflow`.
    No optimisation flag is passed. Signed integer overflow is intentionally
    fatal: the program aborts and the case is a **Runtime Error**, even when its
    output would have been right.
*   **Python** runs on `python3` with the standard library only. A syntax error
    is a Compilation Error. Python runs get 4× the time limit and 2× the memory
    limit.
*   **Output comparison:**
    *   CRLF line endings count as LF, and the whole output is trimmed.
    *   Trailing spaces at the end of each line are ignored.
    *   Leading and internal whitespace still count.
*   **Verdicts** come from how the program ended, not from its output text:
    *   The time limit is reached: **Time Limit Exceeded**.
    *   The measured peak memory is over the limit, even on a clean exit, or
        the program is killed with SIGKILL: **Memory Limit Exceeded**.
    *   A crash or a non-zero exit: **Runtime Error**. The stderr shown with it
        is capped at 4 KiB, with server paths removed.
*   **Judged programs may use threads but cannot start processes**, open
    sockets or create SysV IPC objects.
*   **A problem with no testcases does not take submissions** (400).
*   **If the backend restarts**:
    *   `Pending` submissions are judged again.
    *   Submissions that were compiling or running become a **System Error**
        asking the student to resubmit.
*   **The first Accepted solve** of a problem awards XP, exactly once.

## Header problems

A header problem asks the student to implement one function rather than a whole
program, in the style of a data-structures course: the problem ships a class
header (`queue.h`, `vector.h`, …) and a `student.h` with the target function
left empty, the student submits **only `student.h`**, and the judge compiles it
against the problem's own `main.cpp`. That `main.cpp` is secret and deliberately
differs from the one the student downloads — it drives a command stream and
interleaves the new function with the pre-existing ones, so an edit that breaks
`push` or `pop` is caught.

Header problems are **C++ only**. Each one stores two file sets:

| role | who sees it | what it holds |
|---|---|---|
| `grader` | staff only | the secret `main.cpp` and any headers it needs |
| `starter` | anyone who can see the problem | the files students download as a ZIP, from the problem page or the contest problem page |

### Grader and starter files

*   **Names:** 1–100 characters of letters, digits, `_`, `-`, `+` or `.`, with no
    path and no leading `.` or `+`. Each set holds at most 20 files of up to
    1 MiB each.
*   **Grader set:**
    *   It needs at least one C++ source, using a suffix g++ compiles as C++:
        exactly `.cpp`, `.cc`, `.cxx`, `.cp`, `.c++`, `.C` or `.CPP`. The
        suffix is case-sensitive, so `main.Cpp` does not count.
    *   Headers use `.h` or `.hpp`.
    *   No two sources may share a name stem.
    *   No grader file may have the submission's file name.
*   **Starter set:** any header a student writes `#include "name"` for must be in
    the starter set, *including headers the grader also has*. The submission
    may include only standard headers (`<...>`) and starter headers by name, so
    a grader-only header cannot be included.
*   The compiled grader runs inside the student's process. A grader must not
    embed answers or other secrets; see [SANDBOX.md](SANDBOX.md) § Header problems.

### How a header submission is judged

1.  The submission must be C++ (other languages get a 400). The submitted code is
    stored under the problem's submission file name, so a student always submits
    one `.h` / `.hpp` file. A header problem with no grader source does not take
    submissions yet (400).
2.  The submitted header is checked by a lexer before it is compiled. It is
    rejected for any of the following:
    *   anything the lexer cannot read the way GCC would;
    *   includes other than standard headers or starter headers;
    *   `#define` or `#undef` of keywords or grader identifiers;
    *   `asm`, section attributes, `#ident`, `##` or `incbin`.
3.  The grader and the submission are compiled to assembly (`g++ -S`, with the
    normal C++ flags). Every grader file and the submission are then **deleted**
    from the sandbox. Only after that are the assembly files assembled and
    linked. The program therefore never runs next to a grader source.
4.  Compiler errors keep the real file names. An error located in a grader file
    may quote grader expressions, identifiers, types and line numbers, but never
    whole files.
5.  A Runtime Error shows a neutral crash description, never the program's
    stderr.

### Creating one

In **Manage → Problems**, click **New problem**. On the **General** tab, set
*Problem type* to `Header` and the submission filename (default `student.h`),
then save. On the **Grader files** tab, upload a flat ZIP for each role (up to
25 MiB). Uploading replaces that role's whole set. The problem type and
submission filename lock once any submission exists.

To import header problems in bulk, use Batch Upload. See
[Header problems in a batch ZIP](#header-problems-in-a-batch-zip). Export writes
the same layout back, so a header problem round-trips. The Authoring Workspace
cannot create header problems yet ([#55](https://github.com/Nonbangkok/OJ/issues/55)).

### The bundled 50-problem set

The source and the build harness for a starter set of 50 header problems (pair,
vector, stack, queue, priority_queue — ten each, easy to hard, statements in
Thai) live in the public [CP-Author](https://github.com/Nonbangkok/CP-Author)
repository under `header-problems/`. Problems are authored as plain files and
built into the import ZIP inside a throwaway Docker image that carries the
judge's compiler and a Thai-capable PDF renderer:

```bash
cd CP-Author/header-problems
./run.sh build  --all     # statements -> PDF, generators -> testcases, then dist/header-problems.zip
./run.sh verify --all     # reference solution must be Accepted; the naive one must time out
```

`verify` is the point of the harness: every problem ships a reference solution
that has to score 100 and, where the problem promises a complexity, a correct
but naive `slow.h` that has to exceed the time limit on the large subtask. Import
`dist/header-problems.zip` through **Manage → Problems → Import ZIP**. See that
folder's README for the per-problem file contract and how to add one.

## Contests Management

The Grader System includes a dedicated module for managing programming contests, providing a structured environment for competitive events. This functionality is primarily accessible and configurable by administrators.

*   **Contest Creation and Configuration:**
    Administrators can create new contests, defining:
    *   **Basic Information:** Contest title and description.
    *   **Schedule:** Start and end times for the contest.
    *   **Associated Problems:** Select existing problems to be part of the contest. **Important: Problems assigned to an active contest become inaccessible as standalone problems for general submission during the contest period.** Their pre-contest visibility is restored automatically on every exit path.
    *   **Status Management:** Contests progress through various statuses: `scheduled` (waiting to start), `running` (currently active), `finishing` (end time reached, final migration running), and `finished` (concluded). These statuses are managed automatically by the system's scheduler.
*   **Contest Visibility:**
    Independent from scheduling, administrators can hide or show a contest. Hidden contests are invisible to regular users and guests on every public surface: the list, detail page, join, problems, PDFs, scoreboard, submission feed, search, live updates and submit all answer 404. Staff and admins can still manage them fully, and the scheduler leaves them alone.
*   **Contest Participation:**
    Users can view available contests and join those that are currently active or scheduled. Submission eligibility is checked against the contest's actual start/end times, not just its scheduler status.
*   **Contest-Specific Submissions:**
    During a contest, participants submit solutions to problems specifically within the contest environment. These submissions are tracked separately from general problem submissions, ensuring contest integrity. Until the contest finishes, its submission feed shows non-staff the per-case results of their own submissions only.
*   **Header Problems in Contests:**
    Header problems work in contests as they do in practice. Contestants
    download the starter ZIP from the contest problem page.
*   **Contest Scoreboard:**
    A real-time scoreboard is available for each contest, displaying the scores and rankings of participants. This scoreboard is dynamically updated as participants submit and their solutions are judged, and freezes (with all participants listed) once the contest finishes. Standings count only the problems currently in the contest, so a problem withdrawn mid-contest stops counting.
*   **After the Contest:**
    *   Once its judges have drained, a finished contest's submissions move into
        the general pool in one transaction. They keep a link to their contest,
        so the contest's cheat detection and analytics still see them.
    *   Accepted solves among the moved submissions award XP.
    *   Each problem gets its pre-contest visibility back.
    *   Problems can no longer be moved back to the main pool through the contest
        (409).
    *   The whole contest can no longer be rejudged, because its scoreboard is
        frozen. Its problems can still be rejudged one by one.
*   **Contest Scheduler:**
    `contestScheduler.ts` checks every minute, in the `Asia/Bangkok` timezone. It moves
    contests from `scheduled` to `running`, `finishing` and `finished`, and runs
    the move into the general pool.
    *   A failed move is attempted at most 5 times in all, one per tick, while
        the contest stays `finishing`. After the fifth failure the contest stays
        `finishing` until someone fixes the cause; check the backend log.
    *   While judges are still busy, the move is deferred for up to 30 minutes.
        After that the contest finishes anyway and the unjudged copies are
        judged in the practice pool.
    *   The scheduler pauses while a database import runs.

## Further documentation

*   [SANDBOX.md](SANDBOX.md): the judge sandbox and its threat model, including header problems.
*   [CONTRIBUTING.md](CONTRIBUTING.md): workflow, conventions and the contribution license.
*   [`.context/`](.context/): architecture (`ARCHITECTURE.md`), the full data model (`DATA_MODEL.md`), the API (`API_SCHEMA.md`), coding standards (`STANDARDS.md`) and the authoring pipeline (`AUTHORING_*.md`).
*   [docs/runbooks/continuous-deployment.md](docs/runbooks/continuous-deployment.md): approving a deploy, reading a failed one and restoring a backup.
*   [docs/runbooks/postgres-18-upgrade.md](docs/runbooks/postgres-18-upgrade.md): the one-time Postgres 16 → 18 migration.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
