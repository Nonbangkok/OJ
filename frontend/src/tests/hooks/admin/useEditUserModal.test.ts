import { renderHook, act } from '@testing-library/react';
import useEditUserModal from '../../../hooks/admin/useEditUserModal';

describe('useEditUserModal', () => {
    const mockUser = { id: 1, username: 'testuser', role: 'admin' };

    it('initializes with values from user prop', () => {
        const { result } = renderHook(() => useEditUserModal(mockUser, jest.fn(), jest.fn()));

        expect(result.current.formData.username).toBe('testuser');
        expect(result.current.formData.role).toBe('admin');
    });

    it('updates formData via handleChange', () => {
        const { result } = renderHook(() => useEditUserModal(mockUser, jest.fn(), jest.fn()));

        act(() => {
            result.current.handleChange({ target: { id: 'username', value: 'newname' } });
            result.current.handleChange({ target: { id: 'role', value: 'staff' } });
        });

        expect(result.current.formData.username).toBe('newname');
        expect(result.current.formData.role).toBe('staff');
    });

    it('calls onSave and onClose when handleSave is called', () => {
        const mockSave = jest.fn();
        const mockClose = jest.fn();
        const { result } = renderHook(() => useEditUserModal(mockUser, mockClose, mockSave));

        act(() => {
            result.current.handleSave();
        });

        expect(mockSave).toHaveBeenCalledWith(1, {
            username: 'testuser',
            role: 'admin'
        });
        expect(mockClose).toHaveBeenCalled();
    });
});
