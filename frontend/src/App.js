import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import './App.css';
import './components/Table.css';

// Components
import Navbar from './components/Navbar';

// Pages
import Home from './pages/Home';
import Problems from './pages/Problems';
import Submissions from './pages/Submissions';
import Scoreboard from './pages/Scoreboard';
import Login from './pages/Login';
import Register from './pages/Register';
import ProblemDetail from './pages/ProblemDetail';
import Admin from './pages/Admin';
import Contests from './pages/Contests';
import ContestDetail from './pages/ContestDetail';
import ContestScoreboard from './pages/ContestScoreboard';
import ContestSubmissions from './pages/ContestSubmissions';


function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <Router>
            <div className="App">
              <Navbar />
              <main className="container">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/problems" element={<Problems />} />
                  <Route path="/problems/:id" element={<ProblemDetail />} />
                  <Route path="/submissions" element={<Submissions />} />
                  <Route path="/scoreboard" element={<Scoreboard />} />
                  <Route path="/contests" element={<Contests />} />
                  <Route path="/contests/:contestId" element={<ContestDetail />} />
                  <Route path="/contests/:contestId/scoreboard" element={<ContestScoreboard />} />
                  <Route path="/contests/:contestId/submissions" element={<ContestSubmissions />} />
                  <Route path="/contests/:contestId/problems/:problemId" element={<ProblemDetail />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                </Routes>
              </main>
            </div>
          </Router>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
