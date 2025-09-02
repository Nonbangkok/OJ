import React, { useState, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import styles from './ContestNavbar.module.css';
import { useAuth } from '../context/AuthContext';
import ThemeToggleButton from './ThemeToggleButton';

const API_URL = process.env.REACT_APP_API_URL;

// A simple, self-contained SVG icon component for the back arrow
const ArrowLeftIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="19" y1="12" x2="5" y2="12"></line>
    <polyline points="12 19 5 12 12 5"></polyline>
  </svg>
);

function ContestNavbar() {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [contest, setContest] = useState(null);

  useEffect(() => {
    const fetchContestDetails = async () => {
      try {
        const response = await axios.get(`${API_URL}/contests/${contestId}`, { withCredentials: true });
        setContest(response.data);
      } catch (error) {
        console.error("Failed to fetch contest details", error);
      }
    };

    if (contestId) {
      fetchContestDetails();
    }
  }, [contestId]);

  const handleExit = () => {
    navigate('/contests');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles.effectHolder}></div>
      <div className={styles['navbar-container']}>
        <div className={styles['nav-left']}>
          <button onClick={handleExit} className={styles['back-btn']} title="Exit Contest">
            <ArrowLeftIcon />
          </button>
          <NavLink to={`/contests/${contestId}`} className={styles['nav-brand']}>
            {contest?.title}
          </NavLink>
        </div>
        
        <ul className={styles['nav-links']}>
          {contest && contest.status !== 'finished' && (
            <>
              <li>
                <NavLink to={`/contests/${contestId}/problems`}>Problems</NavLink>
              </li>
              <li>
                <NavLink to={`/contests/${contestId}/submissions`}>Submissions</NavLink>
              </li>
            </>
          )}
          <li>
            <NavLink to={`/contests/${contestId}/scoreboard`}>Scoreboard</NavLink>
          </li>
        </ul>
        
        <div className={styles['nav-actions']}>
          {user && (
            <span className={styles.username}>
              {user.username}
            </span>
          )}
          {/* The Exit Contest button has been moved to the left as an icon */}
          {user && (
            <button onClick={handleLogout} className={styles['logout-btn']}>
              Logout
            </button>
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
}

export default ContestNavbar;
