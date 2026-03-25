import styles from './LoadingPage.module.css';
import { useTheme } from '../../context/ThemeContext';
import logoLight from '../../assets/logo512.png';
import logoDark from '../../assets/logo512_darkmode.png';

/**
 * LoadingPage component for full-screen loading state with animated logo.
 * @returns {JSX.Element}
 */
const LoadingPage = () => {
    const { theme } = useTheme();
    const logo = theme === 'dark' ? logoDark : logoLight;

    return (
        <div className={styles.loadingContainer} id="loading-page">
            <div className={styles.bgPattern}></div>
            <div className={styles.logoWrapper}>
                <div className={styles.glowEffect}></div>
                <img
                    src={logo}
                    alt="Loading Logo"
                    className={styles.logo}
                />
            </div>
            <div className={styles.loadingText}>
                LOADING<span className={styles.dots}></span>
            </div>
        </div>
    );
};

export default LoadingPage;
