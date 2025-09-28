import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import styles from './ContestNavbar.module.css';
import { useAuth } from '../context/AuthContext';
import ThemeToggleButton from './ThemeToggleButton';
import { useTheme } from '../context/ThemeContext'; // Import useTheme
import logo from '../assets/logo512.png'; // Import default logo
import darkmodeLogo from '../assets/logo512_darkmode.png'; // Import dark mode logo

const API_URL = process.env.REACT_APP_API_URL;

function ContestNavbar() {
  const { contestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [contest, setContest] = useState(null);
  const navRef = useRef(null);
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const [sliderStyle, setSliderStyle] = useState({ opacity: 0 });

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

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleMouseEnter = (e) => {
    const li = e.currentTarget;
    setSliderStyle({
      width: li.offsetWidth + 20,
      left: li.offsetLeft - 10,
      opacity: 1,
    });
  };

  const resetSlider = () => {
    try {
      const activeLink = navRef.current?.querySelector('a.active');
      if (activeLink && activeLink.parentElement) {
        const activeLi = activeLink.parentElement;
        setSliderStyle({
          width: activeLi.offsetWidth + 20,
          left: activeLi.offsetLeft - 10,
          opacity: 1,
        });
      } else {
        setSliderStyle({ ...sliderStyle, opacity: 0 });
      }
    } catch (e) {
      setSliderStyle({ opacity: 0 });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
  }, [location.pathname, user, contest]); // Re-calculate on path, user or contest change

  return (
    <nav className={styles.navbar}>
      <div className={styles.effectHolder}></div>
      <div className={styles['navbar-container']}>
        <div className={styles['nav-left']}>
          <NavLink to="/contests" className={styles['back-btn']}>
            <img src={currentLogo} alt="Grader Logo" className={styles['nav-logo']} />
          </NavLink>
          <NavLink to={`/contests/${contestId}`} className={styles['nav-brand']}>
            {contest?.title}
          </NavLink>
        </div>
        
        <ul ref={navRef} className={styles['nav-links']} onMouseLeave={resetSlider}>
          <div className={styles.slider} style={sliderStyle} />
          {contest && contest.status !== 'finished' && (
            <>
              <li onMouseEnter={handleMouseEnter}>
                <NavLink to={`/contests/${contestId}/problems`}>Problems</NavLink>
              </li>
              <li onMouseEnter={handleMouseEnter}>
                <NavLink to={`/contests/${contestId}/submissions`}>Submissions</NavLink>
              </li>
            </>
          )}
          <li onMouseEnter={handleMouseEnter}>
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
