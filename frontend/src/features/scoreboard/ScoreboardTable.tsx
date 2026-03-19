import React from 'react';
import tableStyles from '../../components/styles/Table.module.css';
import styles from './ScoreboardTable.module.css';
import type { ScoreboardEntry } from '../../types';

interface ScoreboardTableProps {
    scoreboard: ScoreboardEntry[];
}

const ScoreboardTable: React.FC<ScoreboardTableProps> = ({ scoreboard }) => {
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
                    {scoreboard.map((entry, index) => (
                        <tr key={entry.username || index} className={index < 3 ? styles[`rank-${index + 1}`] : ''}>
                            <td>{index + 1}</td>
                            <td>
                                {index === 0 && '🥇 '}
                                {index === 1 && '🥈 '}
                                {index === 2 && '🥉 '}
                                {entry.username || 'Unknown User'}
                            </td>
                            <td>{entry.problems_solved}</td>
                            <td>{entry.total_score}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ScoreboardTable;
