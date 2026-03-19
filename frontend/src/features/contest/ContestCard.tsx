import React from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatDateTime } from '../../utils/formatters';
import styles from './ContestCard.module.css';
import type { Contest, User } from '../../types';

interface ContestCardProps {
    contest: Contest;
    user: User | null;
    onJoin: (contestId: string | number) => void;
}

const ContestCard: React.FC<ContestCardProps> = ({ contest, user, onJoin }) => {
    const isJoinable = (): boolean => {
        if (!user) return false;
        const now = new Date();
        const endTime = new Date(contest.endTime);
        return now < endTime;
    };

    const isViewable = (): boolean => {
        return contest.status === 'running' && contest.is_participant;
    };

    return (
        <div className={styles.contestCard}>
            <div className={styles.contestHeader}>
                <h3 className={styles.contestTitle}>{contest.title}</h3>
                <StatusBadge status={contest.status} />
            </div>

            {contest.description && (
                <p className={styles.contestDescription}>{contest.description}</p>
            )}

            <div className={styles.contestTiming}>
                <div className={styles.timeInfo}>
                    <span className={styles.timeLabel}>Start:</span>
                    <span className={styles.timeValue}>{formatDateTime(contest.startTime)}</span>
                </div>
                <div className={styles.timeInfo}>
                    <span className={styles.timeLabel}>End:</span>
                    <span className={styles.timeValue}>{formatDateTime(contest.endTime)}</span>
                </div>
            </div>

            <div className={styles.contestStats}>
                <span className={styles.stat}>Participants: {contest.participant_count || 0}</span>
                <span className={styles.stat}>Problems: {contest.problem_count || 0}</span>
            </div>

            <div className={styles.contestActions}>
                {isJoinable() && !contest.is_participant && (
                    <button
                        className={`${styles.actionBtn} ${styles.joinBtn}`}
                        onClick={() => onJoin(contest.id)}
                    >
                        Join Contest
                    </button>
                )}

                {contest.is_participant && contest.status === 'scheduled' && (
                    <span className={styles.joinedStatus}>
                        You are registered
                    </span>
                )}

                {isViewable() && (
                    <Link
                        to={`/contests/${contest.id}`}
                        className={`${styles.actionBtn} ${styles.enterBtn}`}
                    >
                        Enter Contest
                    </Link>
                )}

                {contest.status === 'finished' && (
                    <Link
                        to={`/contests/${contest.id}/scoreboard`}
                        className={`${styles.actionBtn} ${styles.scoreboardBtn}`}
                    >
                        View Results
                    </Link>
                )}

                {!user && isJoinable() && (
                    <Link
                        to="/login"
                        className={`${styles.actionBtn} ${styles.loginBtn}`}
                    >
                        🔑 Login to Join
                    </Link>
                )}
            </div>
        </div>
    );
};

export default ContestCard;
