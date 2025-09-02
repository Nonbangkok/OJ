import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Outlet } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import './App.css';

// Components
import Navbar from './components/Navbar';
import ContestLayout from './components/ContestLayout';

// Pages
import Home from './pages/Home';
import Problems from './pages/Problems';
import ProblemDetail from './pages/ProblemDetail';
import Scoreboard from './pages/Scoreboard';
import Submissions from './pages/Submissions';
import Login from './pages/Login';
import Register from './pages/Register';
import Admin from './pages/Admin';
import Contests from './pages/Contests';
import ContestDetail from './pages/ContestDetail';
import ContestProblems from './pages/ContestProblems';
import ContestSubmissions from './pages/ContestSubmissions';
import ContestScoreboard from './pages/ContestScoreboard';
import { SettingsProvider } from './context/SettingsContext';

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

  return (
    <div className="App">
      {isContestPage ? null : <Navbar />}
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
          <Route path="/admin" element={<Admin />} />
          <Route path="/contests" element={<Contests />} />
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

function App() {
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
