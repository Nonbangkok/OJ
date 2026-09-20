import { Link } from 'react-router-dom';
import { Medal } from '@phosphor-icons/react';

import UserAvatar from '../../components/user/UserAvatar';
import tableStyles from '../../components/styles/Table.module.css';
import styles from './ScoreboardTable.module.css';

const MEDAL_WEIGHTS = ['gold', 'silver', 'bronze'] as const;

const ScoreboardTable = ({ scoreboard }) => {
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
                    {scoreboard.map((user, index) => (
                        <tr key={user.username} className={index < 3 ? styles[`rank-${index + 1}`] : ''}>
                            <td>{index + 1}</td>
                            <td>
                                <span className={styles['user-cell']}>
                                    <UserAvatar username={user.username} hasAvatar={user.has_avatar} size={28} />
                                    <Link to={`/profile/${user.username}`}>{user.username}</Link>
                                    {index < 3 && (
                                        <Medal
                                            size={18}
                                            weight="fill"
                                            aria-label={`Rank ${index + 1} medal`}
                                            className={`${styles.medal} ${styles[`medal-${MEDAL_WEIGHTS[index]}`]}`}
                                        />
                                    )}
                                </span>
                            </td>
                            <td>{user.problems_solved}</td>
                            <td>{user.total_score}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ScoreboardTable;
