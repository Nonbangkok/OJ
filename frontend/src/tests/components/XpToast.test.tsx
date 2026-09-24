import { render, screen, act } from '@testing-library/react';
import XpToast from '../../components/user/XpToast';
import type { SubmissionUpdatePayload } from '../../services/realtimeService';

const makeEvent = (
  overrides: Partial<SubmissionUpdatePayload> = {},
): SubmissionUpdatePayload => ({
    type: 'submission_update',
    submissionId: 1,
    table: 'submissions',
    overall_status: 'Accepted',
    score: 100,
    user_id: 1,
    ...overrides,
});

describe('XpToast', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('shows a "+N XP" toast for an Accepted event with xp_awarded', () => {
        render(<XpToast event={makeEvent({ xp_awarded: 46 })} />);

        expect(screen.getByText('+46 XP')).toBeInTheDocument();
    });

    it('exposes the toast to screen readers as a polite status', () => {
        render(<XpToast event={makeEvent({ xp_awarded: 46 })} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders nothing when xp_awarded is absent', () => {
        render(<XpToast event={makeEvent()} />);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders nothing when xp_awarded is 0 (already-solved problem)', () => {
        render(<XpToast event={makeEvent({ xp_awarded: 0 })} />);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders nothing when the verdict is not Accepted', () => {
        render(
            <XpToast
                event={makeEvent({ overall_status: 'Wrong Answer', xp_awarded: 46 })}
            />,
        );

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders nothing before any event has arrived', () => {
        render(<XpToast event={null} />);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('auto-dismisses after four seconds', () => {
        const { rerender } = render(
            <XpToast event={makeEvent({ submissionId: 1, xp_awarded: 46 })} />,
        );
        expect(screen.getByText('+46 XP')).toBeInTheDocument();

        act(() => {
            jest.advanceTimersByTime(4000);
        });

        expect(screen.queryByText('+46 XP')).not.toBeInTheDocument();
    });

    it('replaces the toast when a newer qualifying event arrives', () => {
        const { rerender } = render(
            <XpToast event={makeEvent({ submissionId: 1, xp_awarded: 46 })} />,
        );

        rerender(<XpToast event={makeEvent({ submissionId: 2, xp_awarded: 20 })} />);

        expect(screen.getByText('+20 XP')).toBeInTheDocument();
        expect(screen.queryByText('+46 XP')).not.toBeInTheDocument();
    });

    it('stays hidden when a later event has no xp_awarded but the timer is still running', () => {
        const { rerender } = render(
            <XpToast event={makeEvent({ submissionId: 1, xp_awarded: 46 })} />,
        );

        // A non-qualifying follow-up event (e.g. the same user submits again
        // while the toast is up): the running toast must survive.
        rerender(<XpToast event={makeEvent({ submissionId: 2, overall_status: 'Running', xp_awarded: undefined })} />);

        expect(screen.getByText('+46 XP')).toBeInTheDocument();
    });
});
