import tableStyles from '../../components/styles/Table.module.css';
import styles from './ScoreboardTable.module.css';

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
                                {index === 0 && '🥇 '}
                                {index === 1 && '🥈 '}
                                {index === 2 && '🥉 '}
                                {user.username}
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
