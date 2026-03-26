import styles from './Problems.module.css';
import { useProblems } from '../../hooks/useProblems';
import ProblemCard from '../../features/problem/ProblemCard';

import LoadingPage from '../../components/shared/LoadingPage';

const Problems = () => {
  const { problems, loading, error } = useProblems();

  if (loading) return <LoadingPage />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>All Problems</h1>
      {problems.length > 0 ? (
        <div className={styles['problem-list']}>
          {problems.map(problem => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </div>
      ) : (
        <div className={styles['no-problems-container']}>
          <div className={styles['no-problems-icon']}>📂</div>
          <div className={styles['no-problems-title']}>Problem not available.</div>
          <div className={styles['no-problems-subtext']}>Check back later or try refreshing the page.</div>
        </div>
      )}
    </div>
  );
};

export default Problems;