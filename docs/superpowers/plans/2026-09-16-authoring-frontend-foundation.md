# Authoring Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the CSS leakage that currently breaks Problem Authoring, introduce the shared interaction primitives approved by the redesign, make the Admin shell usable at 390 px, and add deterministic visual regression coverage before the guided workspace migration begins.

**Architecture:** Keep this checkpoint intentionally below the future dashboard and workspace layers. Theme tokens and scoped CSS provide the visual foundation; small typed UI primitives own action, field, status, dialog, drawer, and overflow behavior; the existing Admin shell and current Authoring screens consume those primitives without changing authoring APIs or lifecycle behavior. Jest/Testing Library covers semantics and keyboard behavior, while Playwright runs the real CRA application with intercepted API responses and compares desktop/mobile screenshots.

**Tech Stack:** React 19, TypeScript 4.9, CSS Modules, React Router 7, Jest/Testing Library, Playwright Chromium, Create React App

**Spec:** `docs/superpowers/specs/2026-09-16-authoring-frontend-redesign-design.md` sections 8, 10, 12 checkpoint 1, and 13

## Global Constraints

- Keep all user-facing UI copy in English.
- Do not change authoring backend endpoints, draft revisions, job semantics, or publication behavior in this checkpoint.
- Preserve the dedicated full-screen statement editor route and its current layout exception.
- Do not introduce a general-purpose component framework. The primitives below are the only new shared abstraction layer.
- All CSS selectors in `.module.css` files must remain locally scoped. A bare HTML element may appear only below a local class selector such as `.root button`.
- At 390 × 844, the document must not scroll horizontally, Admin navigation must not overlap, and author identity text must retain usable width.
- Dialog and drawer focus must enter the surface, remain contained while open, close with Escape when allowed, and return to the triggering control.
- Use TDD for every behavior change. Run the stated failing test before implementation and the passing test afterward.
- Commit after each task so later implementation plans can depend on stable checkpoints.

---

## Task 1: Lock down CSS-module isolation and remove the global button leak

**Files:**

- Create: `frontend/src/tests/styles/cssModuleIsolation.test.ts`
- Modify: `frontend/src/components/styles/Form.module.css`
- Modify: `frontend/src/features/auth/LoginForm.tsx`
- Modify: `frontend/src/features/auth/RegisterForm.tsx`
- Modify: `frontend/src/features/admin/shared/ModalLayout.module.css`
- Modify: `frontend/src/features/admin/settings/Settings.module.css`

- [ ] **Step 1: Add the failing CSS isolation test**

Create a source-level regression test that reads every `*.module.css` file and reports selectors beginning with a bare element. Allow elements only when they are preceded by a local class in the same selector.

```ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '../..');

function cssModules(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? cssModules(path)
      : path.endsWith('.module.css')
        ? [path]
        : [];
  });
}

test('CSS modules do not publish bare element selectors globally', () => {
  const offenders = cssModules(sourceRoot).flatMap(path => {
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return Array.from(css.matchAll(/(?:^|})\s*([^@][^{]+)\{/g))
      .flatMap(match => match[1].split(','))
      .map(selector => selector.trim())
      .filter(selector => /^(?:button|input|select|textarea|fieldset|table|th|td|label|form)(?:\b|:)/.test(selector))
      .map(selector => `${path.replace(sourceRoot, 'src')}: ${selector}`);
  });

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run the test and confirm the existing leakage is detected**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/styles/cssModuleIsolation.test.ts
```

Expected: FAIL listing `Form.module.css: button`, `ModalLayout.module.css: fieldset`, and the bare checked/focus selectors in `Settings.module.css`.

- [ ] **Step 3: Scope every reported selector**

In `Form.module.css`, replace the global button selectors with form-local selectors and add an explicit reusable class:

```css
.form-container button,
.form-button,
.button {
  display: inline-block;
  box-sizing: border-box;
  width: 100%;
  padding: 0.85rem 1.5rem;
  border: none;
  border-radius: 6px;
  background-color: var(--accent-primary);
  color: #ffffff;
  font-family: var(--font-family-sans-serif);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  transition: background-color 0.2s ease;
}

.form-container button:hover,
.form-button:hover,
.button:hover {
  background-color: var(--accent-primary-hover);
}

.form-container button:disabled,
.form-button:disabled,
.button:disabled {
  background-color: var(--background-tertiary);
  color: var(--text-muted);
  cursor: not-allowed;
}
```

Add `className={styles['form-button']}` to the Login submit button as Register already does. In `ModalLayout.module.css`, scope `fieldset` as `.modal-overlay fieldset` so importing the module cannot change unrelated fieldsets. In `Settings.module.css`, prefix the three state selectors with `.toggle-switch`, for example `.toggle-switch input:checked + .slider`, so the switch remains local to the Settings component.

- [ ] **Step 4: Run the isolation and auth form tests**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/styles/cssModuleIsolation.test.ts src/tests/pages/Login.test.tsx src/tests/pages/Register.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the isolation fix**

```bash
git add frontend/src/tests/styles/cssModuleIsolation.test.ts frontend/src/components/styles/Form.module.css frontend/src/features/auth/LoginForm.tsx frontend/src/features/auth/RegisterForm.tsx frontend/src/features/admin/shared/ModalLayout.module.css frontend/src/features/admin/settings/Settings.module.css
git commit -m "fix: isolate shared form styles"
```

---

## Task 2: Add typed action and field primitives

**Files:**

- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Button.module.css`
- Create: `frontend/src/components/ui/Field.tsx`
- Create: `frontend/src/components/ui/Field.module.css`
- Create: `frontend/src/components/ui/FormControls.tsx`
- Create: `frontend/src/components/ui/index.ts`
- Create: `frontend/src/tests/components/ui/Button.test.tsx`
- Create: `frontend/src/tests/components/ui/Field.test.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Write failing Button behavior tests**

Cover native button props, the four visual variants, compact sizing, loading semantics, and focusable disabled-reason text.

```tsx
render(<Button variant="destructive" loading>Delete testcase</Button>);
const button = screen.getByRole('button', { name: 'Deleting…' });
expect(button).toBeDisabled();
expect(button).toHaveAttribute('aria-busy', 'true');

render(<Button disabled disabledReason="Build the PDF first">Publish</Button>);
expect(screen.getByText('Build the PDF first')).toHaveAttribute('id');
expect(screen.getByRole('button', { name: 'Publish' })).toHaveAttribute(
  'aria-describedby',
  screen.getByText('Build the PDF first').id,
);
```

The public interface must be:

```ts
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'neutral' | 'destructive';
  size?: 'compact' | 'default';
  loading?: boolean;
  loadingLabel?: string;
  disabledReason?: string;
}
```

- [ ] **Step 2: Run the Button test and confirm it fails because the primitive does not exist**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Button.test.tsx
```

Expected: FAIL with a missing-module error.

- [ ] **Step 3: Implement Button with scoped variants and no implicit full width**

Use a wrapping `<span>` only when `disabledReason` exists, generate the description id with `useId`, default `type="button"`, and set `disabled={disabled || loading}`. Use content-sized inline-flex layout; a consumer must opt into any full-width layout through its own container.

Add theme tokens in `index.css` for action foreground/background, focus ring, surface elevation, and danger hover states in both themes. Do not encode dark-theme exceptions inside the component.

- [ ] **Step 4: Write failing Field tests**

The primitive must render a label, optional hint, error text, required marker, and `aria-describedby`/`aria-invalid` wiring around native controls.

```tsx
render(
  <Field label="Problem ID" hint="Lowercase letters and dashes" error="Already used" required>
    {props => <Input {...props} />}
  </Field>,
);
const input = screen.getByLabelText('Problem ID');
expect(input).toHaveAttribute('aria-invalid', 'true');
expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
expect(screen.getByRole('alert')).toHaveTextContent('Already used');
```

Use this interface:

```ts
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: FieldControlProps) => React.ReactNode;
}
```

- [ ] **Step 5: Add failing native-control forwarding tests**

In the same test file, verify that Input, Select, and Textarea merge consumer classes, forward refs and native attributes, and preserve accessible names supplied by Field. Their interfaces must remain native-compatible:

```ts
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
```

Implement each with `forwardRef`, the shared `control` class, and the caller's optional `className`. Do not wrap native controls in extra elements.

- [ ] **Step 6: Implement Field and the scoped form controls**

`Field.module.css` must export `field`, `label`, `required`, `control`, `hint`, and `error`. `FormControls.tsx` imports `control` and exports `Input`, `Select`, and `Textarea`; `Field.tsx` owns only label, hint, error, and ARIA-id composition.

- [ ] **Step 7: Run primitive tests and type checking**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Button.test.tsx src/tests/components/ui/Field.test.tsx
npm run type-check
```

Expected: both commands PASS.

- [ ] **Step 8: Commit the primitives**

```bash
git add frontend/src/components/ui frontend/src/tests/components/ui frontend/src/index.css
git commit -m "feat: add scoped action and field primitives"
```

---

## Task 3: Generalize status and overflow-surface primitives

**Files:**

- Create: `frontend/src/components/ui/StatusBadge.tsx`
- Create: `frontend/src/components/ui/StatusBadge.module.css`
- Create: `frontend/src/components/ui/OverflowTable.tsx`
- Create: `frontend/src/components/ui/OverflowTable.module.css`
- Create: `frontend/src/tests/components/ui/StatusBadge.test.tsx`
- Create: `frontend/src/tests/components/ui/OverflowTable.test.tsx`
- Modify: `frontend/src/components/shared/StatusBadge.tsx`
- Modify: `frontend/src/components/shared/StatusBadge.module.css`
- Modify: `frontend/src/components/ui/index.ts`

- [ ] **Step 1: Write failing tests for a semantic status badge**

Use the interface:

```ts
export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}
```

Test that it renders supplied text, carries the tone class, does not force an ARIA role, and forwards attributes. Preserve existing contest behavior through the old wrapper.

- [ ] **Step 2: Implement the badge and compatibility wrapper**

Move generic badge visuals into `components/ui/StatusBadge.module.css`. Change `components/shared/StatusBadge.tsx` into a typed adapter from `ContestStatus` to label/tone, so `ContestCard` and `ContestDetail` keep their current API. Delete obsolete status-specific rules from the old module or delete the module once no import remains.

- [ ] **Step 3: Write failing tests for contained table overflow**

Use the interface:

```ts
export interface OverflowTableProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  children: React.ReactNode;
}
```

Assert that the wrapper is a named region with `tabIndex={0}` and contains the supplied semantic `<table>`. The CSS must set `max-width: 100%`, `overflow-x: auto`, and `overscroll-behavior-inline: contain`; it must never apply overflow to `body` or the page shell.

- [ ] **Step 4: Implement OverflowTable and export both primitives**

Include a visually subtle focus ring so keyboard users can identify the scroll container. Do not make table rows or cells generic components at this stage.

- [ ] **Step 5: Run status, contest, and overflow tests**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/StatusBadge.test.tsx src/tests/components/ui/OverflowTable.test.tsx src/tests/components/StatusBadge.test.tsx src/tests/components/ContestCard.test.tsx
```

Expected: PASS with existing contest labels unchanged.

- [ ] **Step 6: Commit the primitives**

```bash
git add frontend/src/components/ui frontend/src/components/shared/StatusBadge.tsx frontend/src/components/shared/StatusBadge.module.css frontend/src/tests/components
git commit -m "feat: add status and overflow primitives"
```

---

## Task 4: Add an accessible Dialog and migrate ConfirmationModal

**Files:**

- Create: `frontend/src/components/ui/Dialog.tsx`
- Create: `frontend/src/components/ui/Dialog.module.css`
- Create: `frontend/src/tests/components/ui/Dialog.test.tsx`
- Create: `frontend/src/tests/features/admin/ConfirmationModal.test.tsx`
- Modify: `frontend/src/components/ui/index.ts`
- Modify: `frontend/src/features/admin/shared/ConfirmationModal.tsx`
- Modify: `frontend/src/features/admin/shared/ModalLayout.module.css`

- [ ] **Step 1: Write failing dialog focus and keyboard tests**

Use this public interface:

```ts
export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}
```

Tests must prove:

- the surface uses `role="dialog"`, `aria-modal="true"`, and labelled title/description ids;
- initial focus uses `initialFocusRef`, otherwise the first focusable element;
- Tab and Shift+Tab wrap within the dialog;
- Escape calls `onClose` only when `closeOnEscape !== false`;
- closing restores focus to the element that opened it;
- clicking the backdrop closes, clicking inside does not.

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Dialog.test.tsx
```

Expected: FAIL because `Dialog` does not exist.

- [ ] **Step 3: Implement Dialog in a portal**

Render into `document.body` with `createPortal`. Capture `document.activeElement` on open, lock page scroll by preserving/restoring `document.body.style.overflow`, listen for `keydown`, and query focusable descendants using a single local helper. Add a close icon with the accessible name `Close dialog`; allow consumers to hide it only when the workflow supplies an equally clear cancel action.

- [ ] **Step 4: Write the ConfirmationModal adapter test**

Keep the existing prop contract so User, Problem, and Contest management do not need a coordinated rewrite. Assert that Cancel receives initial focus, the destructive confirmation uses `Button variant="destructive"`, and an async confirm cannot be invoked twice while pending.

Extend the adapter interface with only backward-compatible options:

```ts
interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'danger' | 'default';
  objectName?: string;
}
```

- [ ] **Step 5: Refactor ConfirmationModal onto Dialog and Button**

The safe Cancel button owns the initial focus ref. Track pending state locally, display `Working…`, and disable both actions during confirmation. Keep the component mounted only while `isOpen`. Remove confirmation-only layout rules from `ModalLayout.module.css`, but leave unrelated legacy modal rules until those screens migrate.

- [ ] **Step 6: Run dialog and Admin management tests**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Dialog.test.tsx src/tests/features/admin/ConfirmationModal.test.tsx src/tests/features/admin/UserManagement.test.tsx src/tests/features/admin/ProblemManagement.test.tsx src/tests/features/admin/ContestManagement.test.tsx
```

Expected: PASS, with no changed confirmation copy in legacy screens.

- [ ] **Step 7: Commit the dialog work**

```bash
git add frontend/src/components/ui frontend/src/features/admin/shared/ConfirmationModal.tsx frontend/src/features/admin/shared/ModalLayout.module.css frontend/src/tests/components/ui/Dialog.test.tsx frontend/src/tests/features/admin/ConfirmationModal.test.tsx
git commit -m "feat: add accessible confirmation dialogs"
```

---

## Task 5: Add an accessible Drawer foundation

**Files:**

- Create: `frontend/src/components/ui/Drawer.tsx`
- Create: `frontend/src/components/ui/Drawer.module.css`
- Create: `frontend/src/tests/components/ui/Drawer.test.tsx`
- Modify: `frontend/src/components/ui/index.ts`

- [ ] **Step 1: Write failing Drawer tests**

Use the same focus rules as Dialog and this interface:

```ts
export interface DrawerProps {
  open: boolean;
  title: string;
  side?: 'right' | 'left';
  children: React.ReactNode;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}
```

Test labelled dialog semantics, close button, Escape, backdrop close, focus containment/restoration, right-side default, and a reduced-motion-safe transition class.

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Drawer.test.tsx
```

Expected: FAIL with a missing-module error.

- [ ] **Step 3: Implement Drawer by sharing focus utilities, not Dialog markup**

Extract the focusable-selector and focus-wrap logic from `Dialog.tsx` to a private `frontend/src/components/ui/focusTrap.ts`. Both surfaces may import it; it is not exported from `index.ts`. Drawer should be `min(30rem, 100vw)` wide, fill the viewport height, and become full width at 390 px. Honor `prefers-reduced-motion`.

- [ ] **Step 4: Run Dialog and Drawer tests together**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/components/ui/Dialog.test.tsx src/tests/components/ui/Drawer.test.tsx
npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit the Drawer foundation**

```bash
git add frontend/src/components/ui frontend/src/tests/components/ui/Drawer.test.tsx
git commit -m "feat: add accessible drawer primitive"
```

---

## Task 6: Replace the overlapping Admin navigation with a responsive menu

**Files:**

- Create: `frontend/src/tests/layouts/admin/AdminNavbar.test.tsx`
- Modify: `frontend/src/layouts/admin/AdminNavbar.tsx`
- Modify: `frontend/src/layouts/admin/AdminNavbar.module.css`
- Modify: `frontend/src/layouts/admin/AdminLayout.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Write failing navigation behavior tests**

Mock `useAuth` and `useTheme`, render inside `MemoryRouter`, and cover:

- the full admin link set for administrators and the restricted set for staff;
- a `Menu` button with `aria-expanded="false"` and `aria-controls`;
- click toggles the menu and changes the accessible name to `Close menu`;
- selecting a navigation link closes the menu;
- Escape closes it and returns focus to the menu button;
- route changes close it;
- Logout awaits `logout()` before navigating to `/`;
- the active route uses `aria-current="page"` without measuring a hover slider.

Do not test CSS media queries in JSDOM; Playwright covers responsive rendering in Task 8.

- [ ] **Step 2: Run the navbar test and confirm the current implementation fails**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/layouts/admin/AdminNavbar.test.tsx
```

Expected: FAIL because there is no menu button, Escape handling, or awaited logout.

- [ ] **Step 3: Simplify AdminNavbar state and markup**

Remove `sliderStyle`, `navRef`, mouse measurement handlers, the delayed reset effect, and the slider element. Add `menuOpen`, a menu button ref, an id such as `admin-navigation`, and an effect that closes the menu on `location.pathname` changes. Handle Escape only while open.

The DOM order must be:

1. Home/logo link and Admin/Staff Panel brand.
2. Mobile menu toggle.
3. Primary navigation list.
4. Account actions containing username, theme toggle, and Logout.

Await logout before navigation:

```ts
const handleLogout = async () => {
  await logout();
  navigate('/');
};
```

- [ ] **Step 4: Replace absolute positioning with grid/flex responsive CSS**

Desktop (`min-width: 901px`) uses three grid columns: brand, navigation, actions. Navigation remains in normal flow. At `max-width: 900px`, show the menu toggle and render navigation/account actions as a stacked panel below the first row. At `max-width: 520px`, hide the visible username while retaining it in an accessible account label, reduce shell padding, and keep all tap targets at least 44 px tall.

Add a global `box-sizing: border-box` reset for `html` and descendants, plus `min-width: 0` on the Admin main container. Do not add `overflow-x: hidden`; overflow bugs must remain observable.

- [ ] **Step 5: Run navbar and Admin layout tests**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/tests/layouts/admin/AdminNavbar.test.tsx src/tests/layouts/admin/AdminLayout.test.tsx src/tests/pages/Admin.test.tsx
```

Expected: PASS, including the full-screen editor route remaining navbar-free.

- [ ] **Step 6: Commit the responsive shell**

```bash
git add frontend/src/layouts/admin/AdminNavbar.tsx frontend/src/layouts/admin/AdminNavbar.module.css frontend/src/layouts/admin/AdminLayout.tsx frontend/src/index.css frontend/src/tests/layouts/admin/AdminNavbar.test.tsx
git commit -m "feat: make admin navigation responsive"
```

---

## Task 7: Stabilize the current Authoring surface on desktop and mobile

**Files:**

- Modify: `frontend/src/features/admin/authoring/ProblemAuthoring.tsx`
- Modify: `frontend/src/features/admin/authoring/Authoring.module.css`
- Modify: `frontend/src/features/admin/authoring/AuthorProfiles.tsx`
- Modify: `frontend/src/features/admin/authoring/AuthorProfiles.module.css`
- Modify: `frontend/src/features/admin/authoring/AuthorProfiles.test.tsx`
- Modify: `frontend/src/tests/features/admin/ProblemAuthoring.test.tsx`

- [ ] **Step 1: Add failing component assertions for bounded action layout**

Extend the existing tests to require:

- Authoring top actions use the shared Button variants and the Problem Management link has equivalent secondary-action styling.
- The draft table is inside a named `OverflowTable` region.
- Every author profile row has a dedicated identity wrapper and a compact Edit button.
- The profile retry, remove-image, save, and cancel actions expose the intended primary/secondary/destructive hierarchy.

Prefer semantic assertions (`role`, accessible name, named region) over CSS-module class-name assertions. One focused class assertion is acceptable for the author identity wrapper because it protects the exact flex item that previously collapsed to zero width.

- [ ] **Step 2: Run the existing Authoring tests and confirm the new assertions fail**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring/AuthorProfiles.test.tsx src/tests/features/admin/ProblemAuthoring.test.tsx
```

Expected: FAIL on missing overflow region and primitive hierarchy.

- [ ] **Step 3: Migrate current Authoring actions without changing behavior**

Use `Button` for actual buttons and a local `actionLink` style for React Router links. Wrap the existing draft table, unchanged, in `<OverflowTable label="Saved drafts">`; the existing `<table>` becomes that component's child.

Retain the current New draft inline form because the short create dialog belongs to the dashboard migration plan. Retain all existing endpoint calls, tabs, and labels.

- [ ] **Step 4: Fix responsive Authoring and author-profile layout**

Use a padded authoring page with `width: min(100%, 1200px)` and prevent children from exceeding it. At 600 px and below:

- top actions stack and each action remains at least 44 px tall;
- table scrolling remains inside `OverflowTable`;
- profile rows use a three-column grid (`avatar minmax(0, 1fr) auto`) rather than inheriting page button width;
- the Edit button stays content-sized;
- profile editor actions wrap without overflow;
- long IDs, author names, and error text wrap within their cells.

Keep the full-screen statement editor rules untouched except for shared token substitutions.

- [ ] **Step 5: Run the Authoring test suites**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false src/features/admin/authoring src/tests/features/admin/ProblemAuthoring.test.tsx
```

Expected: PASS with current API and revision behavior unchanged.

- [ ] **Step 6: Commit the stabilized Authoring surface**

```bash
git add frontend/src/features/admin/authoring frontend/src/tests/features/admin/ProblemAuthoring.test.tsx
git commit -m "fix: stabilize authoring layouts and actions"
```

---

## Task 8: Add deterministic desktop and mobile visual regression coverage

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/tests/visual/fixtures.ts`
- Create: `frontend/tests/visual/admin-shell.spec.ts`
- Create: `frontend/tests/visual/author-profiles.spec.ts`
- Create: `frontend/tests/visual/admin-shell.spec.ts-snapshots/` (generated by Playwright)
- Create: `frontend/tests/visual/author-profiles.spec.ts-snapshots/` (generated by Playwright)
- Modify: `.gitignore`

- [ ] **Step 1: Install Playwright and add scripts**

Run:

```bash
cd frontend && npm install --save-dev @playwright/test
npx playwright install chromium
```

Add scripts:

```json
"test:visual": "playwright test",
"test:visual:update": "playwright test --update-snapshots"
```

Expected: `package.json` and `package-lock.json` include the resolved Playwright version; Chromium is available locally.

- [ ] **Step 2: Add Playwright configuration and confirm discovery**

Configure:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  webServer: {
    command: 'PORT=3100 BROWSER=none REACT_APP_API_URL=/api npm start',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Run:

```bash
cd frontend && npx playwright test --list
```

Expected: both visual specs are discovered in desktop and mobile projects once created; before that, configuration loads without a TypeScript error.

- [ ] **Step 3: Create deterministic API fixtures**

`fixtures.ts` must export `mockAdminApi(page)` and fulfill these request patterns with fixed dates and IDs:

- `**/api/me` → authenticated admin `{ id: 1, username: 'author.admin', role: 'admin' }`;
- `**/api/admin/authoring/drafts` → two deterministic drafts, one Draft and one Ready;
- `**/api/admin/author-profiles` → two profiles with deliberately long names and no remote images;
- any unhandled `**/api/**` request → a deliberate 404 fixture response so tests never contact a real backend.

Register the catch-all first and the specific routes afterward because Playwright evaluates the most recently registered matching route first. Freeze browser time with `page.clock.setFixedTime(new Date('2026-09-16T09:00:00+07:00'))` before navigation.

- [ ] **Step 4: Write the responsive Admin shell test before creating baselines**

For both projects:

```ts
await mockAdminApi(page);
await page.goto('/admin/authoring');
await expect(page.getByRole('heading', { name: 'Problem Authoring' })).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
```

On mobile, open the Menu and assert Authoring and Logout are visible without overlap. On desktop, assert the menu button is hidden and the full navigation is visible. Capture `admin-authoring-shell.png` after fonts are ready and animations are disabled.

- [ ] **Step 5: Write the author-profile regression test**

Open Author profiles, wait for both fixture rows, and assert in the browser:

```ts
const metrics = await page.getByRole('button', { name: /Edit International/ }).evaluate(button => {
  const row = button.closest('li')!;
  const identity = row.querySelector('[data-profile-identity]')!;
  return {
    buttonWidth: button.getBoundingClientRect().width,
    identityWidth: identity.getBoundingClientRect().width,
    rowWidth: row.getBoundingClientRect().width,
  };
});
expect(metrics.buttonWidth).toBeLessThan(160);
expect(metrics.identityWidth).toBeGreaterThan(120);
expect(metrics.rowWidth).toBeLessThanOrEqual(390);
```

Add `data-profile-identity` to the semantic identity wrapper specifically for stable measurement. Capture `author-profiles.png` in light mode, then set `data-theme="dark"` through the UI toggle and capture `author-profiles-dark.png` in the desktop project.

- [ ] **Step 6: Generate and inspect the approved baselines**

Run:

```bash
cd frontend && npm run test:visual:update
```

Expected: snapshots are created for 1280 × 720 and 390 × 844. Inspect every generated PNG. Reject and fix any baseline containing clipped text, overlapping navigation, full-width row buttons, document-wide horizontal overflow, missing focus indication, or unreadable dark-theme contrast. Do not approve a broken image merely because the test is deterministic.

- [ ] **Step 7: Run visual tests against the committed baselines**

Run:

```bash
cd frontend && npm run test:visual
```

Expected: PASS without updating snapshots. Add `test-results/` and `playwright-report/` to `.gitignore`; commit only expected snapshot PNGs.

- [ ] **Step 8: Commit the visual harness**

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/tests/visual .gitignore
git commit -m "test: add authoring visual regression baselines"
```

---

## Task 9: Run the full foundation verification gate

**Files:**

- Modify only if verification exposes a defect in files already covered by this plan.

- [ ] **Step 1: Run formatting and static checks**

Run:

```bash
cd frontend && npm run format:check
npm run type-check
npm run type-check:tests:all
npm run lint:check
```

Expected: all four commands PASS. If formatting alone fails, run `npm run format`, inspect the diff, and rerun the check.

- [ ] **Step 2: Run the complete unit/component suite**

Run:

```bash
cd frontend && CI=true npm test -- --watchAll=false
```

Expected: PASS with no changed authoring API assertions.

- [ ] **Step 3: Build the production frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS with no TypeScript, CSS, or bundle errors.

- [ ] **Step 4: Run the visual regression suite one final time**

Run:

```bash
cd frontend && npm run test:visual
```

Expected: PASS in both desktop and mobile projects with no new snapshots.

- [ ] **Step 5: Inspect scope and commit any verification-only correction**

Run:

```bash
git status --short
git diff --check
git log --oneline -9
```

Expected: no uncommitted changes, no whitespace errors, and one focused commit per completed task. If verification exposes a defect, return to that task's red/green steps, use its exact file-specific `git add` command, and commit the correction as `fix: complete authoring foundation verification` before repeating the entire gate.

## Completion Criteria

- Importing any CSS module cannot globally force unrelated buttons or fieldsets to change size.
- Existing Login, Register, contest status, Admin management, and full-screen statement-editor behavior remains green.
- Shared Button, Field, Input, Select, Textarea, StatusBadge, OverflowTable, Dialog, and Drawer primitives have typed contracts and direct tests.
- Confirmation dialogs have focus containment, safe initial focus, Escape behavior, pending-state protection, and focus restoration.
- Admin navigation is normal-flow on desktop and a keyboard-operable menu on narrow screens.
- Current Authoring and Author Profiles surfaces remain within the viewport at 390 × 844; profile identity content no longer collapses.
- Deterministic light/dark desktop and mobile baselines pass without contacting a live backend.
- Full frontend tests, type checks, lint, production build, and Playwright suite pass.
