import styles from './LoadingPage.module.css';
import GraderLogo from '../brand/GraderLogo';

/**
 * LoadingPage component for full-screen loading state with animated logo.
 * @returns {JSX.Element}
 */
const LoadingPage = () => {
    return (
        <div className={styles.loadingContainer} id="loading-page">
            <div className={styles.logoWrapper}>
                <GraderLogo size={120} title="Loading" className={styles.logo} />
            </div>
            <div className={styles.loadingText}>
                LOADING<span className={styles.dots}></span>
            </div>
        </div>
    );
};

export default LoadingPage;
