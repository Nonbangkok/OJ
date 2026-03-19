import React from 'react';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
    status: 'scheduled' | 'running' | 'finishing' | 'finished' | string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
    const statusClasses: Record<string, string> = {
        'scheduled': `${styles.badge} ${styles.scheduled}`,
        'running': `${styles.badge} ${styles.running}`,
        'finishing': `${styles.badge} ${styles.finishing}`,
        'finished': `${styles.badge} ${styles.finished}`
    };

    const statusText: Record<string, string> = {
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
