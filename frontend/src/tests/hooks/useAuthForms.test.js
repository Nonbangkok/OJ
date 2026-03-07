import { renderHook, act } from '@testing-library/react';
import { useAuthForms } from '../../hooks/useAuthForms';

describe('useAuthForms', () => {
    it('should initialize with default values', () => {
        const { result } = renderHook(() => useAuthForms());

        expect(result.current.formData).toEqual({ username: '', password: '' });
        expect(result.current.error).toBe('');
        expect(result.current.success).toBe('');
        expect(result.current.loading).toBe(false);
    });

    it('should initialize with custom values', () => {
        const { result } = renderHook(() => useAuthForms({ username: 'admin', password: 'pass' }));

        expect(result.current.formData).toEqual({ username: 'admin', password: 'pass' });
    });

    it('should update form data on handleChange', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange({ target: { id: 'username', value: 'testuser' } });
        });

        expect(result.current.formData.username).toBe('testuser');
    });

    it('should validate username length', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange({ target: { id: 'username', value: 'ab' } });
            result.current.handleChange({ target: { id: 'password', value: 'password123' } });
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(false);
        expect(result.current.error).toBe('Username must be at least 3 characters long.');
    });

    it('should validate password length', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange({ target: { id: 'username', value: 'testuser' } });
            result.current.handleChange({ target: { id: 'password', value: '12345' } });
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(false);
        expect(result.current.error).toBe('Password must be at least 6 characters long.');
    });

    it('should pass validation with valid inputs', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange({ target: { id: 'username', value: 'testuser' } });
            result.current.handleChange({ target: { id: 'password', value: 'password123' } });
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(true);
        expect(result.current.error).toBe('');
    });

    it('should allow setting error and success messages', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.setError('Something went wrong');
        });
        expect(result.current.error).toBe('Something went wrong');

        act(() => {
            result.current.setSuccess('Done!');
        });
        expect(result.current.success).toBe('Done!');
    });
});
