import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatTimeAgo, formatDateAbsolute, generateResultString } from '../../utils/formatters';
import { difficultyBand } from '../../utils/constants';
import type { ProblemSummary } from '../../types';
import styles from './ProblemCard.module.css';

interface ProblemCardProps {
    problem: ProblemSummary;
    contestId?: string | null;
    /** When a specific category filter is active, that category's badge
     *  shows by default; with no filter badges stay hidden — categories can
     *  reveal problem content, so they are opt-in per card. */
    highlightCategory?: string | null;
}

const ProblemCard = ({ problem, contestId = null, highlightCategory = null }: ProblemCardProps) => {
    const [revealed, setRevealed] = useState(false);
    const submissionCount = Number(problem.submission_count ?? 0);
    const hasSubmitted = submissionCount > 0;
    const linkPath = contestId
        ? `/contests/${contestId}/problems/${problem.id}`
        : `/problems/${problem.id}`;
    const difficulty = problem.difficulty ?? null;
    const band = difficultyBand(difficulty);

    const categories = problem.categories ?? [];
    const hasCategories = categories.length > 0;
    // With a filter active the selected category leads; once revealed, every
    // remaining category joins it (selected first, then the rest).
    const filteredCategory = highlightCategory && categories.includes(highlightCategory)
        ? highlightCategory
        : null;
    const revealedCategories = revealed
        ? (filteredCategory
            ? [filteredCategory, ...categories.filter(c => c !== filteredCategory)]
            : categories)
        : [];

    // The toggle exists whenever categories could stay hidden: by default all
    // are hidden, and under a filter the non-selected ones are.
    const hasHiddenCategories = hasCategories
        && (filteredCategory ? categories.length > 1 : true);

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
                    {!revealed && filteredCategory && (
                        <span className={styles['problem-category']}>{filteredCategory}</span>
                    )}
                    {revealedCategories.map(category => (
                        <span key={category} className={styles['problem-category']}>{category}</span>
                    ))}
                    {hasHiddenCategories && (
                        <button
                            type="button"
                            className={styles['category-toggle']}
                            aria-expanded={revealed}
                            onClick={() => setRevealed(previous => !previous)}
                        >
                            {revealed ? 'Hide categories' : (filteredCategory ? 'Show all categories' : 'Show categories')}
                        </button>
                    )}
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
