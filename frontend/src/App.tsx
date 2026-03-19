import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Outlet } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import './App.css';

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
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Admin from './pages/admin/Admin';
import Contests from './pages/contest/Contests';
import ContestDetail from './pages/contest/ContestDetail';
import ContestProblems from './pages/contest/ContestProblems';
import ContestSubmissions from './pages/contest/ContestSubmissions';
import ContestScoreboard from './pages/contest/ContestScoreboard';
import { SettingsProvider } from './context/SettingsContext';

// Admin Pages
import UserManagement from './features/admin/users/UserManagement';
import ProblemManagement from './features/admin/problems/ProblemManagement';
import ContestManagement from './features/admin/contests/ContestManagement';
import Settings from './features/admin/settings/Settings';

// New layout for standard pages
const MainLayout: React.FC = () => (
  <main className="container">
    <Outlet />
  </main>
);

// This component will contain the logic for switching navbars
const Layout: React.FC = () => {
  const { user } = useAuth();
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
          <Route path="/problems" element={<Problems />} />
          {/* Note: ProblemDetail is used by both layouts, so we keep it duplicated for now */}
          <Route path="/problems/:problemId" element={<ProblemDetail />} />
          <Route path="/scoreboard" element={<Scoreboard />} />
          <Route path="/submissions" element={<Submissions />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/contests" element={<Contests />} />
        </Route>

        {/* Admin routes with their own layout */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Admin />} />
          <Route path="users" element={<UserManagement currentUser={user} />} />
          <Route path="problems" element={<ProblemManagement currentUser={user} />} />
          <Route path="contests" element={<ContestManagement currentUser={user} />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Contest routes with their own self-contained layout */}
        <Route path="/contests/:contestId" element={<ContestLayout />}>
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

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <Router>
            <Layout />
          </Router>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
