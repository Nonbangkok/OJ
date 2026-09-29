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
    highlightCategories?: readonly string[];
}

export const ProblemCategoryReveal = ({
    categories = [],
    highlightCategory = null,
    highlightCategories,
}: ProblemCategoryRevealProps) => {
    const [revealed, setRevealed] = useState(false);
    const selectedCategoryNames = highlightCategories ?? (highlightCategory ? [highlightCategory] : []);
    const filteredCategories = selectedCategoryNames.filter(category => categories.includes(category));
    const orderedCategories = [...filteredCategories, ...categories.filter(category => !filteredCategories.includes(category))];
    const revealedCategories = revealed ? orderedCategories : [];
    const hasHiddenCategories = categories.length > filteredCategories.length;

    return (
        <>
            {!revealed && filteredCategories.map(category => (
                <span key={category} className={styles['problem-category']}>{category}</span>
            ))}
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
                    {revealed ? 'Hide categories' : (filteredCategories.length > 0 ? 'Show all categories' : 'Show categories')}
                </button>
            )}
        </>
    );
};
