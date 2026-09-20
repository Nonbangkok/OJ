import { renderHook, waitFor, act } from '@testing-library/react';
import useProblemModal from '../../../hooks/admin/useProblemModal';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useProblemModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getAuthors) as jest.Mock).mockResolvedValue([{ id: 1, username: 'admin' }]);
    });

    it('initializes default values', async () => {
        const { result } = renderHook(() => useProblemModal(null, jest.fn(), null, { username: 'admin' }));

        expect(result.current.formData.title).toBe('');
        expect(result.current.formData.time_limit_ms).toBe(1000);
        expect(result.current.formData.author).toBe('admin');

        await waitFor(() => {
            expect(result.current.authors).toHaveLength(1);
        });
    });

    it('pre-fills data when editing existing problem', async () => {
        const mockProblem = {
            id: 1,
            title: 'Existing',
            time_limit_ms: 2000,
            memory_limit_mb: 256,
            author: 'admin2'
        };

        const { result } = renderHook(() => useProblemModal(
            mockProblem,
            jest.fn(),
            null,
            { username: 'admin' }
        ));

        await waitFor(() => {
            expect(result.current.formData.title).toBe('Existing');
            expect(result.current.formData.time_limit_ms).toBe(2000);
            expect(result.current.formData.author).toBe('admin2');
        });
    });

    it('handles save correctly', async () => {
        const mockSave = jest.fn();

        const { result } = renderHook(() => useProblemModal(
            null,
            mockSave,
            null,
            { username: 'admin' }
        ));

        act(() => {
            result.current.handleChange({ target: { name: 'title', value: 'New title' } });
        });

        act(() => {
            result.current.handleSave();
        });

        expect(mockSave).toHaveBeenCalledWith({
            problemData: expect.objectContaining({
                title: 'New title',
                author: 'admin',
                time_limit_ms: 1000,
                memory_limit_mb: 256
            }),
            pdfFile: null,
            zipFile: null
        }, false); // false for isEditing
    });

    it('round-trips difficulty: prefills, edits, and clears to null', async () => {
        const mockProblem = {
            id: 'p-difficulty',
            title: 'Rated',
            author: 'admin',
            categories: [],
            time_limit_ms: 2000,
            memory_limit_mb: 256,
            difficulty: 1700
        };

        const { result } = renderHook(() => useProblemModal(
            mockProblem,
            jest.fn(),
            null,
            { username: 'admin' }
        ));

        await waitFor(() => {
            expect(result.current.formData.difficulty).toBe(1700);
        });

        // Editing the dropdown sends the numeric value.
        act(() => {
            result.current.handleChange({ target: { name: 'difficulty', value: '2400' } });
        });
        expect(result.current.formData.difficulty).toBe(2400);

        // "Unrated" maps back to null (clears the rating on save).
        act(() => {
            result.current.handleChange({ target: { name: 'difficulty', value: '' } });
        });
        expect(result.current.formData.difficulty).toBeNull();

        const mockSave = jest.fn();
        const { result: fresh } = renderHook(() => useProblemModal(
            mockProblem,
            mockSave,
            null,
            { username: 'admin' }
        ));
        await waitFor(() => {
            expect(fresh.current.formData.difficulty).toBe(1700);
        });
        act(() => {
            fresh.current.handleChange({ target: { name: 'difficulty', value: '' } });
        });
        act(() => {
            fresh.current.handleSave();
        });
        expect(mockSave).toHaveBeenCalledWith({
            problemData: expect.objectContaining({ difficulty: null }),
            pdfFile: null,
            zipFile: null
        }, true);
    });

    it('defaults difficulty to null (Unrated) for new problems', async () => {
        const { result } = renderHook(() => useProblemModal(null, jest.fn(), null, { username: 'admin' }));

        await waitFor(() => {
            expect(result.current.authors).toHaveLength(1);
        });
        expect(result.current.formData.difficulty).toBeNull();
    });
});
