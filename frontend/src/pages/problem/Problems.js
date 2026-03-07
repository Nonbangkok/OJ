import styles from './Problems.module.css';
import { useProblems } from '../../hooks/useProblems';
import ProblemCard from '../../features/problems/ProblemCard';

const Problems = () => {
  const { problems, loading, error } = useProblems();

  if (loading) return <div>Loading problems...</div>;
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