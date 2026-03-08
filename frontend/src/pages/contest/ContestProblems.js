import { useParams } from 'react-router-dom';
import { useContestGuard } from '../../hooks/useContestGuard';
import { useProblems } from '../../hooks/useProblems';
import ProblemCard from '../../features/problem/ProblemCard';
import styles from '../problem/Problems.module.css';

const ContestProblems = () => {
  const { contestId } = useParams();

  // Contest access guard — handles redirect logic and polling
  const { isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

  // Fetch contest problems using the shared hook
  const { problems, loading: problemsLoading, error: problemsError } = useProblems(
    isAccessible ? contestId : null
  );

  if (!contestId) {
    return <div className="error-message">Error: No Contest ID specified in the URL.</div>;
  }

  if (guardLoading || problemsLoading) return <div>Loading problems...</div>;
  if (guardError) return <div className="error-message">{guardError}</div>;
  if (problemsError) return <div className="error-message">{problemsError}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>Contest Problems</h1>
      <div className={styles['problem-list']}>
        {problems.map(problem => (
          <ProblemCard key={problem.id} problem={problem} contestId={contestId} />
        ))}
      </div>
    </div>
  );
};

export default ContestProblems;