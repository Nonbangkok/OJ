import { renderHook, waitFor, act } from '@testing-library/react';
import useProblemMigrationModal from '../../../hooks/admin/useProblemMigrationModal';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useProblemMigrationModal', () => {
    const mockContest = { id: 1, title: 'Test Contest' };
    const mockAvailable = [
        { id: 'PROB1', title: 'Problem 1' },
        { id: 'PROB2', title: 'Problem 2' }
    ];
    const mockContestProblems = [
        { id: 'PROB3', title: 'Problem 3' }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getAvailableProblems) as jest.Mock).mockResolvedValue(mockAvailable);
        (jest.mocked(adminService.getContestProblemsAdmin) as jest.Mock).mockResolvedValue(mockContestProblems);
    });

    it('fetches problems on mount', async () => {
        const { result } = renderHook(() => useProblemMigrationModal(mockContest, jest.fn()));

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.availableProblems).toEqual(mockAvailable);
        expect(result.current.contestProblems).toEqual(mockContestProblems);
    });

    it('handles moving problems to contest', async () => {
        (jest.mocked(adminService.migrateContestProblems) as jest.Mock).mockResolvedValueOnce({});
        const mockSuccess = jest.fn();
        const { result } = renderHook(() => useProblemMigrationModal(mockContest, mockSuccess));

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Select a problem
        act(() => {
            result.current.handleSelectAvailable('PROB1');
        });
        expect(result.current.selectedAvailable).toContain('PROB1');

        // Move to contest
        await act(async () => {
            await result.current.handleMoveToContest();
        });

        expect(adminService.migrateContestProblems).toHaveBeenCalledWith(1, ['PROB1'], 'move_to_contest');
        expect(mockSuccess).toHaveBeenCalled();
        expect(result.current.selectedAvailable).toEqual([]);
    });

    it('handles moving problems to main', async () => {
        (jest.mocked(adminService.migrateContestProblems) as jest.Mock).mockResolvedValueOnce({});
        const { result } = renderHook(() => useProblemMigrationModal(mockContest, jest.fn()));

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Select a problem from contest
        act(() => {
            result.current.handleSelectContest('PROB3');
        });

        // Move to main
        await act(async () => {
            await result.current.handleMoveToMain();
        });

        expect(adminService.migrateContestProblems).toHaveBeenCalledWith(1, ['PROB3'], 'move_to_main');
    });

    it('handles selection of all problems', async () => {
        const { result } = renderHook(() => useProblemMigrationModal(mockContest, jest.fn()));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleSelectAllAvailable();
        });
        expect(result.current.selectedAvailable).toHaveLength(2);

        act(() => {
            result.current.handleSelectAllAvailable(); // Deselect all
        });
        expect(result.current.selectedAvailable).toHaveLength(0);
    });
});
