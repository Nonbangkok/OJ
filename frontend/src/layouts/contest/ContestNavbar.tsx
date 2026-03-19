import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useParams, useNavigate, useLocation } from 'react-router-dom';
import contestService from '../../services/contestService';
import styles from './ContestNavbar.module.css';
import { useAuth } from '../../context/AuthContext';
import ThemeToggleButton from '../../components/shared/ThemeToggleButton';
import { useTheme } from '../../context/ThemeContext';
import logo from '../../assets/logo512.png';
import darkmodeLogo from '../../assets/logo512_darkmode.png';
import type { Contest } from '../../types';

const ContestNavbar: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [contest, setContest] = useState<Contest | null>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const [sliderStyle, setSliderStyle] = useState<React.CSSProperties>({ opacity: 0 });

  useEffect(() => {
    const fetchContestDetails = async (): Promise<void> => {
      try {
        if (!contestId) return;
        const data = await contestService.getById(contestId);
        setContest(data);
      } catch (error) {
        console.error("Failed to fetch contest details", error);
      }
    };

    if (contestId) {
      fetchContestDetails();
    }
  }, [contestId]);

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/');
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLLIElement>): void => {
    const li = e.currentTarget;
    setSliderStyle({
      width: li.offsetWidth + 20,
      left: li.offsetLeft - 10,
      opacity: 1,
    });
  };

  const resetSlider = (): void => {
    try {
      const activeLink = navRef.current?.querySelector('a.active');
      if (activeLink && activeLink.parentElement) {
        const activeLi = activeLink.parentElement as HTMLLIElement;
        setSliderStyle({
          width: activeLi.offsetWidth + 20,
          left: activeLi.offsetLeft - 10,
          opacity: 1,
        });
      } else {
        setSliderStyle((prev) => ({ ...prev, opacity: 0 }));
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
          <NavLink to="/contests" className={styles['back-btn'] || ''}>
            <img src={currentLogo} alt="Grader Logo" className={styles['nav-logo']} />
          </NavLink>
          <NavLink to={`/contests/${contestId}`} className={styles['nav-brand'] || ''}>
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
