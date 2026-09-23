import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import NavbarUserMenu from './NavbarUserMenu';
import styles from './Navbar.module.css';
import { useTheme } from '../../context/ThemeContext';
import logo from '../../assets/logo512.png';
import darkmodeLogo from '../../assets/logo512_darkmode.png';
import { USER_ROLES } from '../../utils/constants';
import { useNavSlider } from '../../hooks/useNavSlider';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { registrationEnabled } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme(); // Get current theme
  const currentLogo = theme === 'dark' ? darkmodeLogo : logo; // Choose logo based on theme
  const {
    navRef,
    sliderStyle,
    handleItemMouseEnter,
    resetSlider,
  } = useNavSlider<HTMLUListElement>('horizontal', { recalcKey: location.pathname + String(user?.role) });

  const handleLogout = () => {
    try {
      void logout();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles['navbar-container']}>
        <NavLink to="/" className={styles['nav-brand']}>
          <img src={currentLogo} alt="Grader Logo" className={styles['nav-logo']} />
          <span className={styles['nav-brand-name']}>Grader</span>
        </NavLink>
        <ul ref={navRef} className={styles['nav-links']} onMouseLeave={resetSlider}>
          <div className={styles.slider} style={sliderStyle} />
          <li onMouseEnter={handleItemMouseEnter}><NavLink to="/problems">Problems</NavLink></li>
          <li onMouseEnter={handleItemMouseEnter}><NavLink to="/submissions">Submissions</NavLink></li>
          <li onMouseEnter={handleItemMouseEnter}><NavLink to="/scoreboard">Scoreboard</NavLink></li>
          <li onMouseEnter={handleItemMouseEnter}><NavLink to="/contests">Contests</NavLink></li>
          {user?.role === USER_ROLES.ADMIN && (
            <li onMouseEnter={handleItemMouseEnter}><NavLink to="/admin">Admin Panel</NavLink></li>
          )}
          {user?.role === USER_ROLES.STAFF && (
            <li onMouseEnter={handleItemMouseEnter}><NavLink to="/admin">Staff Panel</NavLink></li>
          )}
        </ul>
        <div className={styles['nav-actions']}>
          {user ? (
            <NavbarUserMenu />
          ) : (
            <>
              <NavLink to="/login" className={styles['nav-action-link']}>Login</NavLink>
              {/* Conditionally render the Register link based on the setting */}
              {registrationEnabled && (
                <NavLink to="/register" className={styles['nav-action-link']}>Register</NavLink>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
