import { renderHook, act, waitFor } from '@testing-library/react';
import useAddUserModal, { getCreateUserErrorMessage } from '../../../hooks/admin/useAddUserModal';

describe('useAddUserModal', () => {
    it('initializes default values properly', () => {
        const { result } = renderHook(() => useAddUserModal(jest.fn()));

        expect(result.current.username).toBe('');
        expect(result.current.password).toBe('');
        expect(result.current.role).toBe('user');
        expect(result.current.fieldErrors).toEqual({});
        expect(result.current.serverError).toBe('');
        expect(result.current.isSubmitting).toBe(false);
    });

    it('rejects a too-short username client-side without calling onSave', async () => {
        const mockSave = jest.fn();
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('ab');
            result.current.setPassword('password123');
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.fieldErrors.username).toBe('Username must be at least 3 characters long.');
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('rejects a too-short password client-side (min 8, matching the backend)', async () => {
        const mockSave = jest.fn();
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('testuser');
            result.current.setPassword('1234567');
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.fieldErrors.password).toBe('Password must be at least 8 characters long.');
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('rejects an over-long username client-side (max 50, matching the backend)', async () => {
        const mockSave = jest.fn();
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('u'.repeat(51));
            result.current.setPassword('password123');
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.fieldErrors.username).toBe('Username must be at most 50 characters long.');
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('clears a field error once the admin edits that field', async () => {
        const { result } = renderHook(() => useAddUserModal(jest.fn()));

        act(() => {
            result.current.setPassword('short');
        });
        await act(async () => {
            await result.current.handleSave();
        });
        expect(result.current.fieldErrors.password).toBeDefined();

        act(() => {
            result.current.setPassword('password123');
        });
        expect(result.current.fieldErrors.password).toBeUndefined();
    });

    it('calls onSave with the form values when valid, including the admin role', async () => {
        const mockSave = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('testuser');
            result.current.setPassword('password123');
            result.current.setRole('admin');
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.fieldErrors).toEqual({});
        expect(result.current.serverError).toBe('');
        expect(mockSave).toHaveBeenCalledWith({
            username: 'testuser',
            password: 'password123',
            role: 'admin'
        });
    });

    it('surfaces a rejected onSave as serverError and keeps state for a retry', async () => {
        const mockSave = jest.fn().mockRejectedValue({
            response: { status: 409, data: { message: 'Username already exists.' } },
        });
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('newadmin');
            result.current.setPassword('password123');
        });
        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.serverError).toBe('Username already exists.');
        expect(result.current.username).toBe('newadmin');
        expect(result.current.isSubmitting).toBe(false);

        // Editing the input clears the server error; retrying re-asks the
        // (still-rejecting) save and surfaces the error again.
        act(() => {
            result.current.setUsername('newadmin2');
        });
        expect(result.current.serverError).toBe('');
        await act(async () => {
            await result.current.handleSave();
        });
        expect(mockSave).toHaveBeenCalledTimes(2);
        expect(mockSave).toHaveBeenLastCalledWith({
            username: 'newadmin2',
            password: 'password123',
            role: 'user',
        });
        expect(result.current.serverError).toBe('Username already exists.');
    });

    it('resetForm clears fields, errors, and role', async () => {
        const mockSave = jest.fn().mockRejectedValue({
            response: { status: 409, data: { message: 'Username already exists.' } },
        });
        const { result } = renderHook(() => useAddUserModal(mockSave));

        act(() => {
            result.current.setUsername('someone');
            result.current.setPassword('password123');
            result.current.setRole('staff');
        });
        await act(async () => {
            await result.current.handleSave();
        });
        expect(result.current.serverError).toBe('Username already exists.');

        act(() => {
            result.current.resetForm();
        });

        expect(result.current.username).toBe('');
        expect(result.current.password).toBe('');
        expect(result.current.role).toBe('user');
        expect(result.current.fieldErrors).toEqual({});
        expect(result.current.serverError).toBe('');
        expect(result.current.isSubmitting).toBe(false);
    });
});

describe('getCreateUserErrorMessage', () => {
    it('translates a backend Zod 400 into readable field messages', () => {
        const error = {
            response: {
                status: 400,
                data: {
                    message: 'Validation failed',
                    errors: [
                        { code: 'too_small', path: ['username'], message: 'Too small: expected string to have >=3 characters' },
                        { code: 'too_small', path: ['password'], message: 'Too small: expected string to have >=8 characters' },
                    ],
                },
            },
        };

        expect(getCreateUserErrorMessage(error)).toBe(
            'Username must be at least 3 characters long. Password must be at least 8 characters long.'
        );
    });

    it('falls back to the message field for non-Zod errors (409 duplicate)', () => {
        const error = {
            response: { status: 409, data: { message: 'Username already exists.' } },
        };

        expect(getCreateUserErrorMessage(error)).toBe('Username already exists.');
    });

    it('uses the error message when there is no response payload', () => {
        expect(getCreateUserErrorMessage(new Error('Network Error'))).toBe('Network Error');
    });

    it('falls back to a generic message when nothing readable exists', () => {
        expect(getCreateUserErrorMessage({})).toBe('Failed to create user.');
    });
});
