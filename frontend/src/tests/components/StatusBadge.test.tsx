import { render, screen } from '@testing-library/react';
import StatusBadge from '../../components/shared/StatusBadge';

// Mock CSS modules
jest.mock('../../components/shared/StatusBadge.module.css', () => ({
    badge: 'badge',
    scheduled: 'scheduled',
    running: 'running',
    finishing: 'finishing',
    finished: 'finished'
}));

describe('StatusBadge', () => {
    it('renders scheduled status', () => {
        render(<StatusBadge status="scheduled" />);
        expect(screen.getByText('Scheduled')).toBeInTheDocument();
    });

    it('renders running status', () => {
        render(<StatusBadge status="running" />);
        expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders finishing status', () => {
        render(<StatusBadge status="finishing" />);
        expect(screen.getByText('Finishing')).toBeInTheDocument();
    });

    it('renders finished status', () => {
        render(<StatusBadge status="finished" />);
        expect(screen.getByText('Finished')).toBeInTheDocument();
    });

    it('renders unknown status as-is', () => {
        render(<StatusBadge status="unknown" />);
        expect(screen.getByText('unknown')).toBeInTheDocument();
    });
});
