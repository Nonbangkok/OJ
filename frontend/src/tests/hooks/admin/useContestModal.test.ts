import { renderHook, waitFor, act } from '@testing-library/react';
import useContestModal from '../../../hooks/admin/useContestModal';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useContestModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes default values for new contest', () => {
        const { result } = renderHook(() => useContestModal(null, jest.fn(), jest.fn()));

        expect(result.current.formData.title).toBe('');
        expect(result.current.formData.description).toBe('');
        expect(result.current.formData.start_time).toBeInstanceOf(Date);
        expect(result.current.formData.end_time).toBeInstanceOf(Date);
        expect(result.current.error).toBe('');
    });

    it('pre-fills data when editing existing contest', () => {
        const mockContest = {
            id: 1,
            title: 'Existing',
            description: 'Desc',
            start_time: '2025-01-01T10:00:00.000Z',
            end_time: '2025-01-01T12:00:00.000Z'
        };

        const { result } = renderHook(() => useContestModal(mockContest, jest.fn(), jest.fn()));

        expect(result.current.formData.title).toBe('Existing');
        expect(result.current.formData.description).toBe('Desc');
        expect(result.current.formData.start_time).toEqual(new Date(mockContest.start_time));
    });

    it('handles field changes', () => {
        const { result } = renderHook(() => useContestModal(null, jest.fn(), jest.fn()));

        act(() => {
            result.current.handleChange({ target: { name: 'title', value: 'New Title' } });
        });

        expect(result.current.formData.title).toBe('New Title');
    });

    it('validates start and end times properly', async () => {
        const { result } = renderHook(() => useContestModal(null, jest.fn(), jest.fn()));

        const now = new Date();
        const pastDate = new Date(now.getTime() - 100000);

        act(() => {
            result.current.handleDateChange(pastDate, 'start_time');
            result.current.handleDateChange(now, 'end_time');
            result.current.handleChange({ target: { name: 'title', value: 'Test' } });
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(result.current.error).toBe('Start time must be in the future');
        expect(adminService.createContest).not.toHaveBeenCalled();
    });

    it('creates contest on valid submit', async () => {
        const mockSuccess = jest.fn();
        const mockClose = jest.fn();
        (jest.mocked(adminService.createContest) as jest.Mock).mockResolvedValueOnce({});

        const { result } = renderHook(() => useContestModal(null, mockClose, mockSuccess));

        // Use valid future dates
        const start = new Date(Date.now() + 86400000);
        const end = new Date(start.getTime() + 3600000);

        act(() => {
            result.current.handleChange({ target: { name: 'title', value: 'New Contest' } });
            result.current.handleDateChange(start, 'start_time');
            result.current.handleDateChange(end, 'end_time');
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: jest.fn() });
        });

        expect(adminService.createContest).toHaveBeenCalled();
        expect(mockSuccess).toHaveBeenCalled();
    });

    it('re-seeds the form when the edited contest changes', () => {
        const first = { id: 1, title: 'First', description: 'A', start_time: '2025-01-01T10:00:00.000Z', end_time: '2025-01-01T12:00:00.000Z' };
        const second = { id: 2, title: 'Second', description: 'B', start_time: '2025-02-01T10:00:00.000Z', end_time: '2025-02-01T12:00:00.000Z' };
        const { result, rerender } = renderHook(
            ({ contest }) => useContestModal(contest, jest.fn(), jest.fn()),
            { initialProps: { contest: first } as { contest: typeof first | null } },
        );

        act(() => {
            result.current.handleChange({ target: { name: 'title', value: 'Edited' } });
        });
        expect(result.current.formData.title).toBe('Edited');

        rerender({ contest: second });
        expect(result.current.formData.title).toBe('Second');
        expect(result.current.formData.start_time).toEqual(new Date(second.start_time));

        // Switching to "new contest" seeds the empty default form.
        rerender({ contest: null });
        expect(result.current.formData.title).toBe('');
        expect(result.current.formData.start_time).toBeInstanceOf(Date);
    });
});
