import {
  createBrowserRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui';

// Shells
import AppShell from './components/shell/AppShell';
import AuthShell from './components/shell/AuthShell';
import { CommandPaletteProvider } from './components/shell/CommandPaletteContext';
import ContestLayout from './features/contest/ContestLayout';
import AdminLayout from './layouts/admin/AdminLayout';

// Pages
import Home from './pages/home/Home';
import Problems from './pages/problem/Problems';
import ProblemDetail from './pages/problem/ProblemDetail';
import Scoreboard from './pages/scoreboard/Scoreboard';
import Submissions from './pages/submission/Submissions';
import SubmissionDetailPage from './pages/submission/SubmissionDetailPage';
import UserProfile from './pages/user/UserProfile';
import NotFound from './pages/notfound/NotFound';
import LearnHome from './pages/learn/LearnHome';
import TrackPage from './pages/learn/TrackPage';
import LessonPage from './pages/learn/LessonPage';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Admin from './pages/admin/Admin';
import Contests from './pages/contest/Contests';
import ContestDetail from './pages/contest/ContestDetail';
import ContestProblems from './pages/contest/ContestProblems';
import ContestSubmissions from './pages/contest/ContestSubmissions';
import ContestScoreboard from './pages/contest/ContestScoreboard';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import PrivateRoute from './components/shared/PrivateRoute';
import {
  adminProblemsLoader,
  publicProblemsLoader,
  revalidateProblemListOnPathChange,
  type AdminProblemListLoaderData,
  type PublicProblemListLoaderData,
} from './routing/problemListLoaders';

// Admin Pages
import UserManagement from './features/admin/users/UserManagement';
import ProblemManagement from './features/admin/problems/ProblemManagement';
import ContestManagement from './features/admin/contests/ContestManagement';
import Settings from './features/admin/settings/Settings';
import AnalysisPage from './features/admin/analysis/AnalysisPage';
import ProblemEditPage from './features/admin/problems/ProblemEditPage';
import ContestEditPage from './features/admin/contests/ContestEditPage';
import ProblemAuthoring from './features/admin/authoring/ProblemAuthoring';
import LessonsAdminPage from './features/admin/lessons/LessonsAdminPage';
import {
  DraftMetadata,
  DraftStatement,
  DraftSolution,
  DraftTestcases,
  DraftGenerator,
  DraftVerify,
  DraftJobs,
  DraftAiDocs,
} from './features/admin/authoring/DraftWorkspace';

const PublicProblemsRoute = () => {
  const initialPageSpan = useLoaderData() as PublicProblemListLoaderData;
  return <PrivateRoute><Problems initialPageSpan={initialPageSpan} /></PrivateRoute>;
};

const AdminProblemsRoute = () => {
  const initialPageSpan = useLoaderData() as AdminProblemListLoaderData;
  const { user } = useAuth();
  return <ProblemManagement initialPageSpan={initialPageSpan} currentUser={user} />;
};

// The root route owns React Router's native, history-entry-keyed restoration.
// Data loaders below ensure list rows are present before the saved scroll is
// applied when returning from a problem detail page.
// Picks the shell for the current route: auth pages get the bare auth
// column, contest pages render their own ContestShell (route element), the
// statement editor is full-bleed, and everything else lives in the AppShell.
const RootLayout = () => {
  const { pathname } = useLocation();
  const isAuthPage = /^\/(login|register)\/?$/.test(pathname);
  const isContestPage = /^\/contests\/[^/]+/.test(pathname);
  const isEditor = /^\/admin\/authoring\/[^/]+\/editor\/?$/.test(pathname);

  // A signed-out visitor to a private Grader only ever sees the door: the
  // private landing (and login/register) in the AuthShell, no sidebar.
  const { user, isLoading: authLoading } = useAuth();
  const { isPrivateMode, isLoading: settingsLoading } = useSettings();
  const privateGuest = !authLoading && !settingsLoading && !user && isPrivateMode;

  let content = <Outlet />;
  if (isAuthPage || (privateGuest && !isContestPage && !isEditor)) {
    content = <AuthShell><Outlet /></AuthShell>;
  } else if (!isContestPage && !isEditor) {
    content = <AppShell><div className="container"><Outlet /></div></AppShell>;
  }

  return (
    <CommandPaletteProvider>
      <div className="App">
        {content}
        <ScrollRestoration />
      </div>
    </CommandPaletteProvider>
  );
};

// Exported so routing can be tested with a memory router.
export const appRoutes = createRoutesFromElements(
  <Route element={<RootLayout />} hydrateFallbackElement={<main className="container">Loading…</main>}>
    <Route>
      <Route path="/" element={<Home />} />
      <Route path="/problems" loader={publicProblemsLoader} shouldRevalidate={revalidateProblemListOnPathChange} element={<PublicProblemsRoute />} />
      <Route path="/problems/:problemId" element={<PrivateRoute><ProblemDetail /></PrivateRoute>} />
      <Route path="/scoreboard" element={<PrivateRoute><Scoreboard /></PrivateRoute>} />
      <Route path="/submissions" element={<PrivateRoute><Submissions /></PrivateRoute>} />
      <Route path="/submissions/:submissionId" element={<PrivateRoute><SubmissionDetailPage /></PrivateRoute>} />
      <Route path="/profile/:username" element={<PrivateRoute><UserProfile /></PrivateRoute>} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/contests" element={<PrivateRoute><Contests /></PrivateRoute>} />
      <Route path="/learn" element={<PrivateRoute><LearnHome /></PrivateRoute>} />
      <Route path="/learn/:trackSlug" element={<PrivateRoute><TrackPage /></PrivateRoute>} />
      <Route path="/learn/:trackSlug/:lessonSlug" element={<PrivateRoute><LessonPage /></PrivateRoute>} />
      {/* Anything no other route matches (including unknown /admin and
          /contests/:id sub-paths) gets a real 404 page, not the router's
          developer error screen. */}
      <Route path="*" element={<NotFound />} />
    </Route>

    <Route path="/admin" element={<AdminLayout />}>
      <Route index element={<Admin />} />
      <Route path="users" element={<UserManagement />} />
      <Route path="problems" loader={adminProblemsLoader} shouldRevalidate={revalidateProblemListOnPathChange} element={<AdminProblemsRoute />} />
      <Route path="problems/:problemId/:tab?" element={<ProblemEditPage />} />
      <Route path="authoring" element={<ProblemAuthoring />} />
      <Route path="authoring/profiles" element={<ProblemAuthoring />} />
      <Route path="authoring/ai-docs" element={<ProblemAuthoring />} />
      <Route path="authoring/:draftId" element={<ProblemAuthoring />}>
        <Route index element={<DraftMetadata />} />
        <Route path="metadata" element={<DraftMetadata />} />
        <Route path="statement" element={<DraftStatement />} />
        <Route path="solution" element={<DraftSolution />} />
        <Route path="testcases" element={<DraftTestcases />} />
        <Route path="generator" element={<DraftGenerator />} />
        <Route path="verify" element={<DraftVerify />} />
        <Route path="jobs" element={<DraftJobs />} />
        <Route path="ai-docs" element={<DraftAiDocs />} />
      </Route>
      <Route path="authoring/:draftId/editor" element={<ProblemAuthoring editorMode />} />
      <Route path="contests" element={<ContestManagement />} />
      <Route path="contests/:contestId/:tab?" element={<ContestEditPage />} />
      <Route path="lessons" element={<LessonsAdminPage />} />
      <Route path="settings" element={<Settings />} />
      <Route path="analysis" element={<AnalysisPage />} />
      <Route path="analysis/:tab" element={<AnalysisPage />} />
    </Route>

    <Route path="/contests/:contestId" element={<PrivateRoute><ContestLayout /></PrivateRoute>}>
      <Route index element={<ContestDetail />} />
      <Route path="problems" element={<ContestProblems />} />
      <Route path="problems/:problemId" element={<ProblemDetail />} />
      <Route path="submissions" element={<ContestSubmissions />} />
      <Route path="submissions/:submissionId" element={<SubmissionDetailPage />} />
      <Route path="scoreboard" element={<ContestScoreboard />} />
    </Route>
  </Route>,
);

const router = createBrowserRouter(appRoutes);

const App = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SettingsProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </SettingsProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
