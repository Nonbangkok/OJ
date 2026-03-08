import { renderHook, act } from '@testing-library/react';
import useAddUserModal from '../../../hooks/admin/useAddUserModal';

describe('useAddUserModal', () => {
    it('initializes default values properly', () => {
        const { result } = renderHook(() => useAddUserModal(jest.fn()));

        expect(result.current.username).toBe('');
        expect(result.current.password).toBe('');
        expect(result.current.role).toBe('user');
        expect(result.current.error).toBe('');
    });

    it('validates fields correctly and calls back if valid', () => {
        const mockSave = jest.fn();
        const { result } = renderHook(() => useAddUserModal(mockSave));

        // Test invalid fields (too short)
        act(() => {
            result.current.setUsername('ab');
            result.current.setPassword('123');
            result.current.handleSave();
        });

        expect(result.current.error).toBe('Username must be at least 3 characters long.');
        expect(mockSave).not.toHaveBeenCalled();

        // Fill fields correctly
        act(() => {
            result.current.setUsername('testuser');
            result.current.setPassword('password123');
            result.current.setRole('staff');
        });

        act(() => {
            result.current.handleSave();
        });

        expect(result.current.error).toBe('');
        expect(mockSave).toHaveBeenCalledWith({
            username: 'testuser',
            password: 'password123',
            role: 'staff'
        });
    });
});
