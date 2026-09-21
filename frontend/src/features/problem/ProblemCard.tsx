import { Link } from 'react-router-dom';
import { formatTimeAgo, formatDateAbsolute, generateResultString } from '../../utils/formatters';
import { difficultyBand } from '../../utils/constants';
import type { ProblemSummary } from '../../types';
import styles from './ProblemCard.module.css';

interface ProblemCardProps {
    problem: ProblemSummary;
    contestId?: string | null;
    /** When a specific category filter is active, show only that category's
     *  badge; with no filter (default) badges stay hidden — categories can
     *  reveal problem content, so they are opt-in. */
    highlightCategory?: string | null;
}

const ProblemCard = ({ problem, contestId = null, highlightCategory = null }: ProblemCardProps) => {
    const submissionCount = Number(problem.submission_count ?? 0);
    const hasSubmitted = submissionCount > 0;
    const linkPath = contestId
        ? `/contests/${contestId}/problems/${problem.id}`
        : `/problems/${problem.id}`;
    const difficulty = problem.difficulty ?? null;
    const band = difficultyBand(difficulty);
    // Only the selected category is ever shown, and only while a filter is
    // active — problems with several categories display just the one chosen.
    const visibleCategory = highlightCategory && problem.categories?.includes(highlightCategory)
        ? highlightCategory
        : null;

    return (
        <div className={styles['problem-list-item']}>
            <div className={styles['problem-info']}>
                <h3 className={styles['problem-title']}>{problem.title}</h3>
                <p className={styles['problem-author']}>
                    {problem.id}
                    {visibleCategory && (
                        <span className={styles['problem-category']}>{visibleCategory}</span>
                    )}
                    {difficulty !== null && band !== null && (
                        <span
                            data-testid="problem-difficulty"
                            data-band={band}
                            className={styles[`difficulty-chip-${band}`]}
                            title={`Difficulty ${difficulty}`}
                        >
                            {difficulty}
                        </span>
                    )}
                </p>
                <div className={styles['submission-status-placeholder']}>
                    {hasSubmitted && (
                        <div className={styles['submission-status']}>
                            <span className={styles['submission-time']}>
                                Submitted {formatTimeAgo(problem.latest_submission_at)} ({formatDateAbsolute(problem.latest_submission_at)})
                            </span>
                            <span className={styles['submission-tries']}>
                                {submissionCount} {submissionCount > 1 ? 'tries' : 'try'}
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

            <Link
                to={linkPath}
                className={`${styles['problem-action-btn']} ${hasSubmitted ? styles.edit : styles.new}`}
            >
                {hasSubmitted ? 'Edit' : 'New'}
            </Link>
        </div>
    );
};

export default ProblemCard;
