import { Link } from 'react-router-dom';
import { Medal } from '@phosphor-icons/react';

import UserAvatar from '../../components/user/UserAvatar';
import tableStyles from '../../components/styles/Table.module.css';
import styles from './ScoreboardTable.module.css';

const MEDAL_WEIGHTS = ['gold', 'silver', 'bronze'] as const;
const MEDAL_RANKS = [1, 2, 3];

interface ScoreboardEntry {
    username: string;
    has_avatar?: boolean;
    problems_solved: number;
    total_score: number;
}

/**
 * SCORE-003: competition ranking (1, 1, 3) over total_score — the array
 * index previously gave tied users different ranks. Rows arrive sorted by
 * the API (score DESC, time ASC); equal scores get equal rank and the next
 * rank skips by the number of tied rows above it.
 */
const computeRanks = (scoreboard: ScoreboardEntry[]): number[] =>
    scoreboard.reduce<number[]>((ranks, user, index) => {
        const previous = scoreboard[index - 1];
        const tiedWithPrevious =
            previous !== undefined && previous.total_score === user.total_score;
        ranks.push(tiedWithPrevious ? ranks[index - 1] : index + 1);
        return ranks;
    }, []);

const ScoreboardTable = ({ scoreboard }: { scoreboard: ScoreboardEntry[] }) => {
    const ranks = computeRanks(scoreboard);

    return (
        <div className={tableStyles['table-container']}>
            <table className={tableStyles.table}>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>User</th>
                        <th>Problems Solved</th>
                        <th>Total Score</th>
                    </tr>
                </thead>
                <tbody>
                    {scoreboard.map((user, index) => {
                        const rank = ranks[index];
                        const medalIndex = MEDAL_RANKS.indexOf(rank);
                        return (
                            <tr key={user.username} className={rank <= 3 ? styles[`rank-${rank}`] : ''}>
                                <td>{rank}</td>
                                <td>
                                    <span className={styles['user-cell']}>
                                        <UserAvatar username={user.username} hasAvatar={user.has_avatar} size={28} />
                                        <Link to={`/profile/${user.username}`}>{user.username}</Link>
                                        {medalIndex >= 0 && (
                                            <Medal
                                                size={18}
                                                weight="fill"
                                                aria-label={`Rank ${rank} medal`}
                                                className={`${styles.medal} ${styles[`medal-${MEDAL_WEIGHTS[medalIndex]}`]}`}
                                            />
                                        )}
                                    </span>
                                </td>
                                <td>{user.problems_solved}</td>
                                <td>{user.total_score}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default ScoreboardTable;
