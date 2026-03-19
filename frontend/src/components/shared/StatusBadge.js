import styles from './StatusBadge.module.css';

const StatusBadge = ({ status }) => {
    const statusClasses = {
        'scheduled': `${styles.badge} ${styles.scheduled}`,
        'running': `${styles.badge} ${styles.running}`,
        'finishing': `${styles.badge} ${styles.finishing}`,
        'finished': `${styles.badge} ${styles.finished}`
    };

    const statusText = {
        'scheduled': 'Scheduled',
        'running': 'Running',
        'finishing': 'Finishing',
        'finished': 'Finished'
    };

    return (
        <span className={statusClasses[status] || styles.badge}>
            {statusText[status] || status}
        </span>
    );
};

export default StatusBadge;
