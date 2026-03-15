# Coding Standards — OJ Grader System

> The rulebook. Ensures AI-generated code looks native to this project.

## Architecture Patterns

### Backend: Controller → Service → DB

```
Controller (Express Router)    Handles HTTP, validation, response formatting
      ↓
Service                        Business logic, orchestration, external processes
      ↓
db.query()                     Direct SQL via pg Pool (no ORM)
```

- **Controllers** define routes using `express.Router()`, validate input with `express-validator`, and return JSON responses.
- **Services** contain pure business logic. They receive data, interact with the database, and return results.
- **No ORM** — all database access uses raw parameterized SQL via `db.query(text, params)`.

### Frontend: Page → Hook → Service

```
Page Component (UI)            Renders JSX, handles user interaction
      ↓
Custom Hook (useXxx)           State management, side effects, derived logic
      ↓
Service (xxxService)           Axios API calls, request/response mapping
```

- **Pages** are thin — they delegate all logic to hooks and render based on the returned state.
- **Hooks** encapsulate `useState`, `useEffect`, `useCallback`, error handling, and loading states.
- **Services** are plain objects with async methods wrapping Axios calls. One service per domain.

---

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| React Components | PascalCase | `ContestDetail`, `UserManagement` |
| React Context Providers | PascalCase + `Provider` suffix | `AuthProvider`, `ThemeProvider` |
| Context Hooks | `use` + context name | `useAuth()`, `useTheme()` |
| Custom Hooks | `use` + PascalCase noun | `useContests()`, `useProblemDetail()` |
| Service files | camelCase + `Service` suffix | `contestService.js`, `authService.js` |
| Service objects | camelCase | `contestService.getAll()` |
| Controller files | camelCase + `Controller` suffix | `authController.js` |
| Backend services | camelCase | `judgeService.js`, `contestScheduler.js` |
| Utility functions | camelCase | `formatTimeAgo()`, `getStatusClass()` |
| Constants | UPPER_SNAKE_CASE | `CONTEST_STATUS.RUNNING`, `JUDGE_CONFIG.TLE_EXIT_CODE` |
| Constant groups | UPPER_SNAKE_CASE objects | `USER_VALIDATION`, `POLLING_INTERVALS` |
| CSS classes | kebab-case | `status-accepted`, `contest-card` |
| Database columns | snake_case | `user_id`, `time_limit_ms`, `overall_status` |
| Database tables | snake_case (plural) | `users`, `contest_submissions` |
| Environment variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `REACT_APP_API_URL` |
| Directories | kebab-case or camelCase | `admin/`, `contest/`, `navbar/` |

---

## Frontend Patterns

### Context API

Three global contexts wrap the entire app in this order:

1. **`ThemeProvider`** — manages `theme` state (`'light'` / `'dark'`), persists to `localStorage`, sets `data-theme` attribute on `<html>`.
2. **`AuthProvider`** — manages `user` state, checks `/me` on mount, exposes `login()` / `logout()`. Blocks rendering until auth check completes (`!isLoading && children`).
3. **`SettingsProvider`** — manages system settings like `registrationEnabled`.

**Rule:** Always access context via the exported `useXxx()` hook, never via `useContext(XxxContext)` directly.

### Custom Hooks

- **One hook per file**, named `useXxxYyy.js`.
- Always return an object (not an array) with named properties: `{ data, loading, error, actions... }`.
- Use `useCallback` for functions passed as dependencies or to child components.
- Hooks own the loading/error state — pages just destructure and render.

### Service Layer

- Each service is a **plain object** with methods (not a class).
- All services import the shared `api` Axios instance from `services/api.js`.
- The Axios instance has `withCredentials: true` (session cookies) and `baseURL` from `REACT_APP_API_URL`.
- **Pattern:**
  ```javascript
  const xxxService = {
    getAll: async (params) => {
      const response = await api.get('/endpoint', { params });
      return response.data;
    },
  };
  export default xxxService;
  ```

### Routing

- Uses `react-router-dom` v7 with `<BrowserRouter>`.
- Three layout zones: **MainLayout** (standard pages with Navbar), **AdminLayout** (sidebar navigation), **ContestLayout** (contest-specific navigation).
- The `Layout` component conditionally renders the Navbar based on the current path (hidden for `/admin/*` and `/contests/:id/*`).

### Components

- **Shared components** live in `src/components/shared/` (e.g., `LoadingPage`, `ErrorBanner`).
- **Feature components** live in `src/features/<domain>/` (e.g., `features/admin/users/UserManagement`).
- **Page components** live in `src/pages/<domain>/` and are thin wrappers around hooks.

---

## Backend Patterns

### Controllers

- Each controller creates an `express.Router()` and exports it.
- All routes are mounted at the root path (`app.use('/', xxxRoutes)`) — the URL prefix is within the route definition.
- Input validation uses `express-validator` middleware inline with route definitions.
- **Error pattern:** `try/catch` with `console.error` + generic 500 response (never leak stack traces).

### Middleware

- **`requireAuth`** — checks `req.session.userId` exists.
- **`requireStaffOrAdmin`** — checks `req.session.role` is `'admin'` or `'staff'`.
- **`requireAdmin`** — checks `req.session.role` is `'admin'`.
- **`upload`** — Multer configuration for file uploads.

### Authentication

- **Session-based** using `express-session` + `connect-pg-simple` (stored in `user_sessions` table).
- Passwords hashed with `bcrypt` (10 salt rounds).
- **No JWT.** Sessions are HTTP-only cookies with `sameSite: 'lax'`, 24-hour expiry.

### Constants

- All magic numbers and string literals are centralized in `backend/constants/index.js`.
- Groups: `USER_ROLES`, `CONTEST_STATUS`, `SUBMISSION_STATUS`, `UPLOAD_STATUS`, `USER_VALIDATION`, `PROBLEM_VALIDATION`, `SECURITY_CONFIG`, `JUDGE_CONFIG`, `FILE_CONFIG`.
- Frontend constants split across `src/utils/constants.js` (app-wide) and `src/config/constants.js` (polling/UI timeouts).

---

## Constraints & Rules

1. **No hardcoded values** — use constants files (`backend/constants/index.js`, `frontend/src/config/constants.js`) or environment variables.
2. **No ORM** — raw SQL with parameterized queries only. Always use `$1, $2, ...` placeholders.
3. **JSDoc on all public utility functions** — see `formatters.js` for the standard format.
4. **Error handling in every async function** — `try/catch` with meaningful error messages.
5. **Module systems**: Backend uses **CommonJS** (`require` / `module.exports`), Frontend uses **ES Modules** (`import` / `export`).
6. **Environment variables** — never commit `.env`, use `.env.example` as template. All secrets via env vars.
7. **File upload limits** — configured via Multer, up to 1GB for problem PDFs and test case ZIPs.
8. **Session security** — `httpOnly: true`, `sameSite: 'lax'`, `secure: false` (set to `true` in production).

---

## Testing Standards

### Backend (Jest + Supertest)

- Tests live in `backend/tests/`.
- Use `supertest` to make HTTP requests against the Express app.
- Test files named by domain: e.g., `auth.test.js`, `submissions.test.js`.
- Run with `npm test` (uses `cross-env NODE_ENV=test`).

### Frontend (Jest + React Testing Library)

- Tests live in `frontend/src/tests/` with subdirectories mirroring `hooks/`, `services/`, `components/`, `pages/`.
- Use `@testing-library/react` for rendering and assertions.
- Use `@testing-library/user-event` for user interaction simulation.
- Mock services and context providers in tests.
- Run with `npm test` (watch mode) or `CI=true npm test` (single run).
- Jest config includes custom `moduleNameMapper` for `react-router-dom` v7 compatibility.
