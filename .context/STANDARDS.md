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

- **Controllers** define routes using `express.Router()`, validate input with shared `zod` schemas via `validateRequest`, and return JSON responses.
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
| Service files | camelCase + `Service` suffix | `contestService.ts`, `authService.ts` |
| Service objects | camelCase | `contestService.getAll()` |
| Controller files | camelCase + `Controller` suffix | `authController.ts` |
| Backend services | camelCase | `judgeService.ts`, `contestScheduler.ts` |
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

- **One hook per file**, named `useXxxYyy.ts`/`useXxxYyy.tsx`.
- Always return an object (not an array) with named properties: `{ data, loading, error, actions... }`.
- Use `useCallback` for functions passed as dependencies or to child components.
- Hooks own the loading/error state — pages just destructure and render.

### Service Layer

- Each service is a **plain object** with methods (not a class).
- All services import the shared `api` Axios instance from `services/api.ts`.
- The Axios instance has `withCredentials: true` (session cookies) and `baseURL` from `REACT_APP_API_URL`.
- **Pattern:**
  ```typescript
  const xxxService = {
    getAll: async (params: SomeQuery): Promise<SomeResponse> => {
      const response = await api.get<SomeResponse>('/endpoint', { params });
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
- Input validation uses:
  - `zod` (`validateRequest`) for runtime schema validation aligned with TypeScript DTOs.
  - Shared schemas from `backend/schemas/requestSchemas.ts` (avoid inline schema duplication inside controllers).
- Prefer DTO types from `backend/types/api.ts` for `req.body`, `req.query`, and response contracts.
- Prefer `Response<T>` generics for route response contracts.
- SQL-heavy read/write orchestration must live in services (`*QueryService.ts`), not controllers.
- Normalize route params to primitives early (example: `const id = String(req.params.id)`).
- **Error pattern:** async routes should use `asyncHandler`; throw `AppError` for expected business errors and let `errorHandler` format responses.
- Exception: streaming/callback-heavy endpoints (SSE, file download callbacks, multer cleanup) may keep local `try/catch` for deterministic cleanup and response-finalization.

### Middleware

- **`attachRequestUser`** — maps session fields to typed `req.user`.
- **`requireAuth`** — checks authenticated context (`req.user` with session fallback).
- **`requireStaffOrAdmin`** — checks role is `'admin'` or `'staff'`.
- **`requireAdmin`** — checks role is `'admin'`.
- **`validateRequest`** — zod-powered runtime validation middleware.
- **`errorHandler` / `notFoundHandler`** — centralized API error formatting.
- **`upload`** — Multer configuration for file uploads.

### Authentication

- **Session-based** using `express-session` + `connect-pg-simple` (stored in `user_sessions` table).
- Passwords hashed with `bcrypt` (10 salt rounds).
- **No JWT.** Sessions are HTTP-only cookies with `sameSite: 'lax'`, 24-hour expiry.

### Constants

- All magic numbers and string literals are centralized in `backend/constants/index.js`.
- Groups: `USER_ROLES`, `CONTEST_STATUS`, `SUBMISSION_STATUS`, `UPLOAD_STATUS`, `USER_VALIDATION`, `PROBLEM_VALIDATION`, `SECURITY_CONFIG`, `JUDGE_CONFIG`, `FILE_CONFIG`.
- Frontend constants split across `src/utils/constants.ts` (app-wide) and `src/config/constants.ts` (polling/UI timeouts).
- Type aliases should be derived from constants when possible:
  - `type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES]`
  - `type ContestStatus = 'scheduled' | typeof CONTEST_STATUS[keyof typeof CONTEST_STATUS]`
- Service-local `interface`/`type` declarations should be centralized in `backend/types/service.ts` and imported back into service files.

---

## Constraints & Rules

1. **No hardcoded values** — use constants files (`backend/constants/index.ts`, `frontend/src/config/constants.ts`) or environment variables.
2. **No ORM** — raw SQL with parameterized queries only. Always use `$1, $2, ...` placeholders.
3. **JSDoc on all public utility functions** — see `formatters.js` for the standard format.
4. **Error handling in every async function** — `try/catch` with meaningful error messages.
5. **Module systems**: Backend uses **TypeScript (ESM via tsx/ts-node)**, Frontend uses **ES Modules** (`import` / `export`).
6. **Environment variables** — never commit `.env`, use `.env.example` as template. All secrets via env vars.
   - Runtime env access must go through `backend/config/env.ts` (validated once with zod).
   - `backend/types/env.d.ts` defines required env variable types for compile-time safety.
7. **File upload limits** — configured via Multer, up to 1GB for problem PDFs and test case ZIPs.
8. **Session security** — `httpOnly: true`, `sameSite: 'lax'`, `secure: false` (set to `true` in production).

---

## Testing Standards

### Backend (Jest + Supertest + ts-jest)

- Tests live in `backend/tests/` and are written in **TypeScript**.
- Use `ts-jest` for running TypeScript tests.
- Use `supertest` to make HTTP requests against the Express app.
- Test files named by domain: e.g., `auth.test.ts`, `submissions.test.ts`.
- Run with `npm test` (uses `cross-env NODE_ENV=test`).

### Frontend (Jest + React Testing Library)

- Tests live in `frontend/src/tests/` with subdirectories mirroring `hooks/`, `services/`, `components/`, `pages/`.
- Use `@testing-library/react` for rendering and assertions.
- Use `@testing-library/user-event` for user interaction simulation.
- Mock services and context providers in tests.
- Run with `npm test` (watch mode) or `CI=true npm test` (single run).
- Jest config includes custom `moduleNameMapper` for `react-router-dom` v7 compatibility.
- Frontend CI validation gates:
  - `npm run type-check`
  - `npm run lint:check`
  - `npm run test:ci`
- Progressive frontend test typing gates:
  - `npm run type-check:tests:services`
  - `npm run type-check:tests:hooks`
  - `npm run type-check:tests:all`
