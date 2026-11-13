import { renderHook, waitFor } from '@testing-library/react';
import useProblemModal from '../../hooks/admin/useProblemModal';
import adminService from '../../services/adminService';

jest.mock('../../services/adminService');

describe('useProblemModal re-seed', () => {
    it('keeps the saved header type when the problem object is re-passed', async () => {
        (jest.mocked(adminService.getAuthors) as jest.Mock).mockResolvedValue([]);
        (jest.mocked(adminService.getProblemFiles) as jest.Mock).mockResolvedValue({
            problem_type: 'header', submission_filename: 'student.h', files: [],
        });
        const onSave = jest.fn();
        const user = { username: 'admin' };
        const { result, rerender } = renderHook(
            ({ problem }) => useProblemModal(problem, onSave, null, user),
            { initialProps: { problem: { id: 'P1', title: 'One' } } },
        );
        await waitFor(() => expect(result.current.formData.problem_type).toBe('header'));

        rerender({ problem: { id: 'P1', title: 'One' } });

        expect(result.current.formData.problem_type).toBe('header');
        expect(result.current.formData.submission_filename).toBe('student.h');
    });
});
