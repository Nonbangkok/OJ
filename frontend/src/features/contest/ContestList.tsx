import React from 'react';
import ContestCard from './ContestCard';
import styles from './ContestList.module.css';
import type { Contest, User } from '../../types';

interface ContestListProps {
    contests: Contest[];
    user: User | null;
    onJoin: (contestId: string | number) => void;
}

const ContestList: React.FC<ContestListProps> = ({ contests, user, onJoin }) => {
    if (!contests || contests.length === 0) {
        return (
            <div className={styles.noContests}>
                <div className={styles.noContestsIcon}>🏅</div>
                <h3>No contests available at the moment</h3>
                <p>Please check back later for new contests</p>
            </div>
        );
    }

    return (
        <div className={styles.contestGrid}>
            {contests.map(contest => (
                <ContestCard
                    key={contest.id}
                    contest={contest}
                    user={user}
                    onJoin={onJoin}
                />
            ))}
        </div>
    );
};

export default ContestList;
