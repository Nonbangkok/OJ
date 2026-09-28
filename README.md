# Grader System

<p align="center">
  <img src="assets/logo.png" alt="Grader Logo" />
</p>

The Grader System is a comprehensive online judge platform designed to facilitate competitive programming and programming education. It features a modern, responsive React frontend, a robust Node.js (Express) backend, and a PostgreSQL database, all orchestrated with Docker for seamless setup, deployment, and scalability. This system allows users to register, solve programming problems by submitting C++ code, and receive real-time feedback on their submissions. Administrators have powerful tools to manage users, problems, contests, and the database, making it a versatile platform for various programming challenges.

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
    *   **Problem Statements (PDF):** Upload and display problem descriptions in PDF format (up to 2GB).
    *   **Test Case Management:** Store and manage test cases (input/output) for each problem in the database, with a per-problem testcase viewer in the admin panel.
    *   **Single Problem Upload (Admin):** Administrators can add new problems or update existing ones individually, including their metadata, PDF, and test cases (via ZIP upload).
    *   **Batch Problem Upload (Admin):** Efficiently upload multiple problems at once using structured ZIP files (up to 2GB).
    *   **Problem Visibility Control (Admin):** Administrators can toggle the visibility of problems to users, individually or across a whole collection at once.
    *   **Categories and Difficulty:** Problems carry multiple algorithm categories (from a fixed list) and a Codeforces-like numeric difficulty (800–3500), filterable on the problem list.
    *   **Collections:** Organizational groups (e.g. teaching chapters) that problems can belong to.
    *   **Author Filter (Admin):** Problem Management can be filtered by author.
*   **Code Submission & Judging:**
    *   **C++ and Python Submission:** Users can submit C++ or Python (standard library only) solutions; Python gets time ×4 / memory ×2 limits to compensate for interpreter overhead.
    *   **Isolated Judging Environment:** Code is compiled and executed as an unprivileged per-submission sandbox identity (separate uid/gid, resource limits, seccomp network denial) — see [SANDBOX.md](SANDBOX.md).
    *   **Real-time Judging:** Submissions are judged promptly, with live status updates delivered over Server-Sent Events (polling fallback).
    *   **Detailed Results:** For each submission, users receive detailed results per test case, including status (Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit Exceeded, Runtime Error, Compilation Error).
    *   **Time and Memory Limits:** Configurable time and memory limits for each problem to control resource usage during judging.
*   **Contest Management:**
    *   **Contest Creation and Configuration (Admin):** Administrators can create and configure new programming contests with specific problems, start/end times, and a visibility (hide/show) setting independent of the schedule.
    *   **Contest Visibility (Admin):** Contests can be hidden from end users without touching their schedule or status — a reversible publishing gate.
    *   **Contest Participation:** Users can view available contests and join those that are currently active or scheduled.
    *   **Contest-Specific Submissions:** Submissions made within a contest are tracked separately from general problem submissions, ensuring contest integrity.
    *   **Contest Scoreboard:** Live scoreboard displaying participants' scores and rankings within a contest (updates pushed over SSE), frozen at contest end.
    *   **Cheat Detection (Admin):** Similarity detection flags pairs of contestants whose submissions for the same problem are near-identical after normalization.
*   **Scoreboard:**
    *   **Global Scoreboard:** A public scoreboard displaying user rankings based on their performance across all general problems, with tie-aware ranking.
*   **Authoring Workspace (Admin/Staff):** A full problem-authoring pipeline — drafts with author profiles, a Markdown/LaTeX statement editor with live preview, private reference solutions and generators, sandboxed testcase generation, PDF builds, mechanical verification, and transactional publication into the problem pool. Includes an in-app AI Docs API reference with a copy-for-AI-agent button.
*   **Site Access Modes (Admin):** PUBLIC mode allows guests to browse problems, submissions, and scoreboards read-only; PRIVATE mode requires login for all content.
*   **Analytics (Admin/Staff):** Submission analytics with overview KPIs, daily/hourly activity (site timezone), user/problem drill-downs, retention, and CSV export.
*   **Database Management (Admin Only):**
    *   **Export Database:** Administrators can export the database to a `.sql` dump file for backup purposes (session data is excluded).
    *   **Import Database:** Administrators can restore the database from a `.sql`, `.dump`, or `.tar` file. The site enters maintenance mode (other requests answer 503) while the import runs. **WARNING: Importing a database will PERMANENTLY DELETE ALL EXISTING DATA in the database and replace it with the contents of the uploaded file. Proceed with extreme caution and ensure you have a backup of your current database if needed.**
*   **System Settings (Admin Only):**
    *   **Registration Toggle:** Administrators can enable or disable new user registrations.
    *   **Site Access Mode:** PUBLIC (default, guests can browse read-only) or PRIVATE (login required for content).
    *   **Password Change Toggle:** Enable or disable self-service password changes for users/staff (admins are exempt).

## Technology

The Grader System is built with a modern, type-safe tech stack (TypeScript-first), ensuring a robust, scalable, and responsive application.

*   **Frontend:**
    *   **React 19 & TypeScript:** Modern UI development with strong typing.
    *   **React Router 7:** For declarative routing and data loading.
    *   **Axios:** Promise-based HTTP client with typed API contracts.
    *   **Vanilla CSS & HTML5:** Clean, performant styling without heavy utility frameworks.
*   **Backend:**
    *   **Node.js & Express 5 (TypeScript):** High-performance RESTful API framework.
    *   **PostgreSQL:** Robust relational database accessed via raw parameterized SQL.
    *   **Zod:** Centralized runtime validation for request schemas.
    *   **`bcrypt`:** Secure password hashing.
    *   **`multer` & `unzipper` & `archiver`:** File upload, extraction, and asset management.
    *   **`node-cron`:** For automated contest scheduling and lifecycle management.
    *   **`express-rate-limit`:** API, auth, and submission rate limiting.
    *   **Session-based Auth:** Secure authentication using `express-session` and `connect-pg-simple`, revalidated against the database on every request.
*   **Judging System:**
    *   **C++:** Compiled with GCC and executed in a per-submission sandbox identity.
    *   **Python:** Standard-library-only interpreter execution with adjusted time/memory limits.
*   **Containerization & Deployment:**
    *   **Docker & Docker Compose:** Containerized microservices for consistent environments.
    *   **Nginx:** Reverse proxy handling `/api` routing and frontend serving.
*   **Tools & Testing:**
    *   **Jest & Supertest:** Comprehensive backend integration and unit testing.
    *   **React Testing Library:** Component-level testing for the frontend.
    *   **Git:** Version control and collaboration.

## Prerequisites

To get the Grader System up and running, you only need to install a few essential tools on your host machine. The rest of the application's dependencies (Node.js, npm, PostgreSQL) are managed within Docker containers.

*   **[Docker](https://www.docker.com/):** Essential for containerizing, building, running, and managing the application's services.
*   **[Git](https://git-scm.com/downloads):** Required to clone the project repository for local development and version control.
*   **Node.js 20 (optional):** Required only for running npm and root-level smoke
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
    Notable variables:
    - `HTTP_PORT` — host port for the app (default `80`).
    - `COOKIE_SECURE` — must be `true` in any production deployment over HTTPS;
      the backend refuses to start in production without it.
    - `REACT_APP_LARGE_UPLOAD_API_URL` — optional DNS-only origin endpoint for
      large admin uploads (batch ZIPs, database imports) to bypass proxied
      upload size limits.

## Running the Project

Once the installation and setup are complete, you can start the application:

1.  **Build and Run Docker Containers:**
    Navigate to the root directory of the project (where `docker-compose.yml` is located) and execute the following command:
    ```bash
    docker compose up --build -d
    ```
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
docker build -t oj-authoring-test-backend backend
docker run --rm -d --name oj-authoring-test-db \
  -e POSTGRES_USER=oj_test -e POSTGRES_PASSWORD=oj_test -e POSTGRES_DB=oj_test \
  postgres:16-alpine
docker exec oj-authoring-test-db pg_isready -U oj_test -d oj_test
```

Once `pg_isready` reports accepting connections, run the suite in Node 20 with the
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

### Local Compose and Session Smoke Tests

With the stack running on the default port:

```bash
node --test tests/composeConfig.test.mjs
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

### Run Frontend Tests Only

From the project root:

```bash
cd frontend
npm test
```

*   Frontend tests use **Jest** and **React Testing Library** (`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) to test pages, hooks, services, and components.
*   By default, `npm test` runs in **watch mode** (re-runs on file changes). To run once and exit (e.g., in CI), use:
    ```bash
    CI=true npm test
    ```
*   Frontend tests are located in `frontend/src/tests/`.

## Database Management (Admin Only)

The system provides administration tools for exporting and importing the entire database, useful for backups or emergency recovery. These features are accessible via the Admin Panel under "Settings".

### Export Database

Administrators can export the current state of the database to a `.sql` dump file.

1.  Navigate to the Admin Panel.
2.  Go to the "Settings" section.
3.  Click the "Export Database" button.
4.  The browser will download an `oj_backup_*.sql` file containing your entire database.

### Import Database

Administrators can import a database dump file (`.sql`, `.dump`, or `.tar`) to restore the database to a previous state.

**WARNING:** Importing a database will **PERMANENTLY DELETE ALL EXISTING DATA** in the database and replace it with the contents of the uploaded file. Proceed with extreme caution and ensure you have a backup of your current database if needed.

1.  Navigate to the Admin Panel.
2.  Go to the "Settings" section.
3.  In the "Import Database" section, click "Choose File" and select your database dump file.
4.  Click the "Upload & Import" button.
5.  Confirm the action when prompted. The import process will begin.
6.  After a successful import, you may need to refresh your browser or re-login.

## Problems Management

The system provides robust tools for administrators to manage programming problems, accessible via the Admin Panel under the "Problem Management" section.

*   **Single Problem Upload:**
    Administrators can add new problems or update existing ones individually. This includes:
    1.  **Problem Metadata:** Define problem ID, title, author, time limit (in milliseconds), and memory limit (in megabytes).
    2.  **Problem Statement (PDF):** Upload a single PDF file (up to 2GB) containing the problem description.
    3.  **Test Cases:** Upload a `.zip` archive (up to 2GB) containing the input and output test cases for the problem. The system will automatically parse and store these test cases.
    *   **Note:** Uploading new test cases for an existing problem will **clear all previously associated test cases** before inserting the new ones.
*   **Batch Problem Upload:**
    For efficiency, administrators can upload multiple problems simultaneously using a single structured `.zip` file (up to 2GB). This feature is available via the "Batch Upload" button on the Problem Management page.
    *   **Zip File Structure:** The uploaded `.zip` file can follow two main structures:
        *   **Single Problem ZIP:** The root of the ZIP contains all files for one problem (`config.json`, PDF, and test cases).
        *   **Multiple Problems ZIP:** The root of the ZIP contains multiple directories, where each directory represents a distinct problem.

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

    **Updating an existing problem** (a ZIP whose `config.json` `id` matches an existing problem — the problem is reported as *skipped*, not re-created, but its metadata fields below are applied). For the three optional fields, omitted vs. explicit matters:
    *   **Field omitted** → the stored value is **preserved**.
    *   **Field set to `null`** (or `[]` for categories, or `""` for collection) → the stored value is **cleared**.
    *   **Field set to a value** → the stored value is **replaced**.

    Example: importing an existing problem with `{"id": "plus", "title": "Plus", "author": "Nonbangkok", "time_limit_ms": 1000, "memory_limit_mb": 32, "difficulty": null}` keeps its current categories and collection but clears its rating. (PDF and test cases for existing problems are managed from the individual problem's upload form, not the ZIP import.)

    A problem that fails validation is reported per-problem with a specific message (e.g., `Problem "tree-dp": config.json "categories.0" is invalid: Unknown category "Graphs". Allowed: ...`); the rest of the batch continues, and any collection the failed problem would have created is rolled back.

2.  **Problem Statement PDF:**
    A single `.pdf` file (up to 2GB) containing the problem description. The system will automatically detect and use the first PDF file found within the problem's directory.

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

**Note**: The script will clear any existing test cases for a problem before inserting the new ones.

## Contests Management

The Grader System includes a dedicated module for managing programming contests, providing a structured environment for competitive events. This functionality is primarily accessible and configurable by administrators.

*   **Contest Creation and Configuration:**
    Administrators can create new contests, defining:
    *   **Basic Information:** Contest title and description.
    *   **Schedule:** Start and end times for the contest.
    *   **Associated Problems:** Select existing problems to be part of the contest. **Important: Problems assigned to an active contest become inaccessible as standalone problems for general submission during the contest period.** Their pre-contest visibility is restored automatically on every exit path.
    *   **Status Management:** Contests progress through various statuses: `scheduled` (waiting to start), `running` (currently active), `finishing` (end time reached, final migration running), and `finished` (concluded). These statuses are managed automatically by the system's scheduler.
*   **Contest Visibility:**
    Independent from scheduling, administrators can hide or show a contest. Hidden contests are invisible to regular users and guests on every public surface (list, detail, join, scoreboard) while remaining fully manageable by staff and admins.
*   **Contest Participation:**
    Users can view available contests and join those that are currently active or scheduled. Submission eligibility is checked against the contest's actual start/end times, not just its scheduler status.
*   **Contest-Specific Submissions:**
    During a contest, participants submit solutions to problems specifically within the contest environment. These submissions are tracked separately from general problem submissions, ensuring contest integrity.
*   **Contest Scoreboard:**
    A real-time scoreboard is available for each contest, displaying the scores and rankings of participants. This scoreboard is dynamically updated as participants submit and their solutions are judged, and freezes (with all participants listed) once the contest finishes.
*   **Contest Scheduler:**
    The backend includes a dedicated service (`contestScheduler.ts`) that automatically manages the status of contests based on their defined start and end times.
