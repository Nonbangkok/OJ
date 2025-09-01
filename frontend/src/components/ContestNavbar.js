import React, { useState, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import styles from './ContestNavbar.module.css';
import { useAuth } from '../context/AuthContext';

const API_URL = process.env.REACT_APP_API_URL;

function ContestNavbar() {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [contestTitle, setContestTitle] = useState('Contest');

  useEffect(() => {
    const fetchContestTitle = async () => {
      try {
        // We only need the title, so a lightweight API endpoint would be ideal,
        // but for now, we can use the main contest detail endpoint.
        const response = await axios.get(`${API_URL}/contests/${contestId}`, { withCredentials: true });
        setContestTitle(response.data.title);
      } catch (error) {
        console.error("Failed to fetch contest title", error);
        // Keep default title on error
      }
    };

    if (contestId) {
      fetchContestTitle();
    }
  }, [contestId]);

  const handleExit = () => {
    navigate('/contests'); // Navigate back to the main contests list
  };

  return (
    <nav className={styles.contestNav}>
      <div className={styles.navLeft}>
        <span className={styles.contestBrand}>
          {contestTitle}
        </span>
      </div>
      <div className={styles.navCenter}>
        <NavLink to={`/contests/${contestId}/problems`} className={({ isActive }) => isActive ? styles.activeLink : styles.navLink}>
          Problems
        </NavLink>
        <NavLink to={`/contests/${contestId}/submissions`} className={({ isActive }) => isActive ? styles.activeLink : styles.navLink}>
          Submissions
        </NavLink>
        <NavLink to={`/contests/${contestId}/scoreboard`} className={({ isActive }) => isActive ? styles.activeLink : styles.navLink}>
          Scoreboard
        </NavLink>
      </div>
      <div className={styles.navRight}>
        <button onClick={handleExit} className={styles.exitButton}>
          Exit Contest
        </button>
        {user && (
          <>
            <span className={styles.username}>{user.username} ({user.role})</span>
            <button onClick={logout} className={styles.logoutButton}>Logout</button>
          </>
        )}
      </div>
    </nav>
  );
}

export default ContestNavbar;
