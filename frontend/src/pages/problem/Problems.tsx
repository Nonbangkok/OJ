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
      <div className={styles['problem-list']}>
        {problems.map(problem => (
          <ProblemCard key={problem.id} problem={problem} />
        ))}
      </div>
    </div>
  );
};

export default Problems;