import { Link } from 'react-router-dom';
import { formatTimeAgo, formatDateAbsolute, generateResultString } from '../../utils/formatters';
import type { ProblemSummary } from '../../types';
import { DifficultyChip, ProblemCategoryReveal } from './ProblemMetadata';
import styles from './ProblemCard.module.css';

interface ProblemCardProps {
    problem: ProblemSummary;
    contestId?: string | null;
    /** When category filters are active, matching badges show by default;
     *  other categories stay opt-in because they can reveal problem content. */
    highlightCategories?: readonly string[];
}

const ProblemCard = ({ problem, contestId = null, highlightCategories = [] }: ProblemCardProps) => {
    const submissionCount = Number(problem.submission_count ?? 0);
    const hasSubmitted = submissionCount > 0;
    const linkPath = contestId
        ? `/contests/${contestId}/problems/${problem.id}`
        : `/problems/${problem.id}`;
    // Computed once: the legacy [PPPP...] pattern string, rendered as the
    // score column's second row and exposed as a native title tooltip so a
    // long truncated pattern stays inspectable.
    const resultString = hasSubmitted
        ? generateResultString(problem.best_submission_status, problem.best_submission_results)
        : '';

    return (
        <div className={styles['problem-list-item']}>
            <div className={styles['problem-info']}>
                <h3 className={styles['problem-title']}>{problem.title}</h3>
                <p className={styles['problem-author']}>
                    <span className={styles['problem-id']}>{problem.id}</span>
                    <DifficultyChip difficulty={problem.difficulty} />
                    <ProblemCategoryReveal categories={problem.categories} highlightCategories={highlightCategories} />
                </p>
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
                        <span className={styles['score-text']} title={resultString}>
                            {resultString}
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
