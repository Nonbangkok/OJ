import { BrowserRouter as Router, Routes, Route, useLocation, Outlet } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// Components
import Navbar from './components/navbar/Navbar';
import ContestLayout from './layouts/contest/ContestLayout';
import AdminLayout from './layouts/admin/AdminLayout';

// Pages
import Home from './pages/home/Home';
import Problems from './pages/problem/Problems';
import ProblemDetail from './pages/problem/ProblemDetail';
import Scoreboard from './pages/scoreboard/Scoreboard';
import Submissions from './pages/submission/Submissions';
import UserProfile from './pages/user/UserProfile';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Admin from './pages/admin/Admin';
import Contests from './pages/contest/Contests';
import ContestDetail from './pages/contest/ContestDetail';
import ContestProblems from './pages/contest/ContestProblems';
import ContestSubmissions from './pages/contest/ContestSubmissions';
import ContestScoreboard from './pages/contest/ContestScoreboard';
import { SettingsProvider } from './context/SettingsContext';
import PrivateRoute from './components/shared/PrivateRoute';

// Admin Pages
import UserManagement from './features/admin/users/UserManagement';
import ProblemManagement from './features/admin/problems/ProblemManagement';
import ContestManagement from './features/admin/contests/ContestManagement';
import Settings from './features/admin/settings/Settings';
import AnalysisPage from './features/admin/analysis/AnalysisPage';
import ProblemAuthoring from './features/admin/authoring/ProblemAuthoring';
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

// New layout for standard pages
const MainLayout = () => (
  <main className="container">
    <Outlet />
  </main>
);

// This component will contain the logic for switching navbars
const Layout = () => {
  const location = useLocation();

  // Use a regular expression for a more robust check.
  // This ensures that we match URLs like `/contests/123` or `/contests/some-id/problems`
  // but explicitly NOT `/contests` or `/contests/`.
  const isContestPage = /^\/contests\/[^/]+/.test(location.pathname);
  const isAdminPage = /^\/admin/.test(location.pathname);


  return (
    <div className="App">
      {isContestPage || isAdminPage ? null : <Navbar />}
      {/* Remove the main container from here */}
      <Routes>
        {/* Standard routes wrapped in MainLayout */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          {/* Site-private mode: guests get the shared auth-required screen
              (with post-login returnTo) instead of these content pages. */}
          <Route path="/problems" element={<PrivateRoute><Problems /></PrivateRoute>} />
          {/* Note: ProblemDetail is used by both layouts, so we keep it duplicated for now */}
          <Route path="/problems/:problemId" element={<PrivateRoute><ProblemDetail /></PrivateRoute>} />
          <Route path="/scoreboard" element={<PrivateRoute><Scoreboard /></PrivateRoute>} />
          <Route path="/submissions" element={<PrivateRoute><Submissions /></PrivateRoute>} />
          <Route path="/profile/:username" element={<PrivateRoute><UserProfile /></PrivateRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/contests" element={<PrivateRoute><Contests /></PrivateRoute>} />
        </Route>

        {/* Admin routes with their own layout */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Admin />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="problems" element={<ProblemManagement />} />
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
          <Route path="settings" element={<Settings />} />
          <Route path="analysis" element={<AnalysisPage />} />
        </Route>

        {/* Contest routes with their own self-contained layout */}
        <Route path="/contests/:contestId" element={<PrivateRoute><ContestLayout /></PrivateRoute>}>
          <Route index element={<ContestDetail />} />
          <Route path="problems" element={<ContestProblems />} />
          <Route path="problems/:problemId" element={<ProblemDetail />} />
          <Route path="submissions" element={<ContestSubmissions />} />
          <Route path="scoreboard" element={<ContestScoreboard />} />
        </Route>
      </Routes>
    </div>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SettingsProvider>
            <Router>
              <Layout />
            </Router>
          </SettingsProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
