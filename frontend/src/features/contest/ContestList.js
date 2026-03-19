import ContestCard from './ContestCard';
import styles from './ContestList.module.css';

const ContestList = ({ contests, user, onJoin }) => {
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
