import { useState } from 'react';
import { difficultyBand } from '../../utils/constants';
import styles from './ProblemCard.module.css';

export const DifficultyChip = ({ difficulty }: { difficulty?: number | null }) => {
    const band = difficultyBand(difficulty);
    if (difficulty == null || band == null) return null;

    return (
        <span
            data-testid="problem-difficulty"
            data-band={band}
            className={styles[`difficulty-chip-${band}`]}
            title={`Difficulty ${difficulty}`}
        >
            {difficulty}
        </span>
    );
};

interface ProblemCategoryRevealProps {
    categories?: readonly string[];
    highlightCategory?: string | null;
}

export const ProblemCategoryReveal = ({ categories = [], highlightCategory = null }: ProblemCategoryRevealProps) => {
    const [revealed, setRevealed] = useState(false);
    const filteredCategory = highlightCategory && categories.includes(highlightCategory)
        ? highlightCategory
        : null;
    const revealedCategories = revealed
        ? (filteredCategory
            ? [filteredCategory, ...categories.filter(category => category !== filteredCategory)]
            : categories)
        : [];
    const hasHiddenCategories = categories.length > 0
        && (filteredCategory ? categories.length > 1 : true);

    return (
        <>
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
        </>
    );
};
