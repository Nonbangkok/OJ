import { Link } from 'react-router-dom';
import styles from './Problems.module.css';
import { useProblems } from '../../hooks/useProblems';
import { formatTimeAgo, formatDateAbsolute, generateResultString } from '../../utils/formatters';

const Problems = () => {
  const { problems, loading, error } = useProblems();

  if (loading) return <div>Loading problems...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['problems-page-container']}>
      <h1>All Problems</h1>
      <div className={styles['problem-list']}>
        {problems.map(problem => {
          const hasSubmitted = problem.submission_count > 0;

          return (
            <div key={problem.id} className={styles['problem-list-item']}>
              <div className={styles['problem-info']}>
                <h3 className={styles['problem-title']}>{problem.title}</h3>
                <p className={styles['problem-author']}>{problem.id}</p>
                <div className={styles['submission-status-placeholder']}>
                  {hasSubmitted && (
                    <div className={styles['submission-status']}>
                      <span className={styles['submission-time']}>
                        Submitted {formatTimeAgo(problem.latest_submission_at)} ({formatDateAbsolute(problem.latest_submission_at)})
                      </span>
                      <span className={styles['submission-tries']}>
                        {problem.submission_count} {problem.submission_count > 1 ? 'tries' : 'try'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles['problem-score-placeholder']}>
                {hasSubmitted && (
                  <div className={styles['problem-score-details']}>
                    <div className={styles['score-bar-container']}>
                      <div
                        className={`${styles['score-bar']} ${problem.best_score === 100 ? styles.full : styles.partial}`}
                        style={{ width: `${problem.best_score || 0}%` }}
                      >
                        <span>{problem.best_score || 0}</span>
                      </div>
                    </div>
                    <span className={styles['score-text']}>
                      {generateResultString(problem.best_submission_status, problem.best_submission_results)}
                    </span>
                  </div>
                )}
              </div>

              <Link to={`/problems/${problem.id}`} className={`${styles['problem-action-btn']} ${hasSubmitted ? styles.edit : styles.new}`}>
                {hasSubmitted ? 'Edit' : 'New'}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Problems; 