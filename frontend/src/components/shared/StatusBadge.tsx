import { StatusBadge as UiStatusBadge } from '../ui/StatusBadge';
import type { ContestStatus } from '../../types/models';

type StatusBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface ContestStatusBadgeProps {
    status: ContestStatus | string;
}

const contestStatuses: Record<ContestStatus, { label: string; tone: StatusBadgeTone }> = {
    scheduled: { label: 'Scheduled', tone: 'info' },
    running: { label: 'Running', tone: 'success' },
    finishing: { label: 'Finishing', tone: 'warning' },
    finished: { label: 'Finished', tone: 'neutral' },
};

const StatusBadge = ({ status }: ContestStatusBadgeProps) => {
    const contestStatus = contestStatuses[status as ContestStatus];

    return <UiStatusBadge tone={contestStatus?.tone}>{contestStatus?.label ?? status}</UiStatusBadge>;
};

export default StatusBadge;
