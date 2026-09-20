import { useState, useEffect } from 'react';
import { NavLink, useParams, useLocation } from 'react-router-dom';
import contestService from '../../services/contestService';
import styles from './ContestNavbar.module.css';
import NavbarUserMenu from '../../components/navbar/NavbarUserMenu';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import logo from '../../assets/logo512.png';
import darkmodeLogo from '../../assets/logo512_darkmode.png';
import { useNavSlider } from '../../hooks/useNavSlider';
import type { Contest } from '../../types';

const ContestNavbar = () => {
  const { contestId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [contest, setContest] = useState<Contest | null>(null);
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const {
    navRef,
    sliderStyle,
    handleItemMouseEnter,
    resetSlider,
  } = useNavSlider<HTMLUListElement>('horizontal', {
    recalcKey: location.pathname + String(user?.role) + String(contest?.status),
  });

  useEffect(() => {
    const fetchContestDetails = async () => {
      try {
        if (!contestId) {
          return;
        }

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
              <li onMouseEnter={handleItemMouseEnter}>
                <NavLink to={`/contests/${contestId}/problems`}>Problems</NavLink>
              </li>
              <li onMouseEnter={handleItemMouseEnter}>
                <NavLink to={`/contests/${contestId}/submissions`}>Submissions</NavLink>
              </li>
            </>
          )}
          <li onMouseEnter={handleItemMouseEnter}>
            <NavLink to={`/contests/${contestId}/scoreboard`}>Scoreboard</NavLink>
          </li>
        </ul>

        <div className={styles['nav-actions']}>
          {user && <NavbarUserMenu />}
        </div>
      </div>
    </nav>
  );
}

export default ContestNavbar;
