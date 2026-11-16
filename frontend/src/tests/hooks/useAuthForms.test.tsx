import { renderHook, act } from '@testing-library/react';
import { useAuthForms } from '../../hooks/useAuthForms';

/** A change event for the input named `name` (inputs are matched by name). */
const change = (name: string, value: string) =>
    ({ target: { name, id: '', value } }) as unknown as React.ChangeEvent<HTMLInputElement>;

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
            result.current.handleChange(change('username', 'testuser'));
        });

        expect(result.current.formData.username).toBe('testuser');
    });

    it('should validate username length', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange(change('username', 'ab'));
            result.current.handleChange(change('password', 'password123'));
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(false);
        expect(result.current.fieldErrors.username).toBe('Username must be at least 3 characters long.');
    });

    it('should validate password length', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange(change('username', 'testuser'));
            result.current.handleChange(change('password', '12345'));
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(false);
        expect(result.current.fieldErrors.password).toBe('Password must be at least 6 characters long.');
    });

    it('should pass validation with valid inputs', () => {
        const { result } = renderHook(() => useAuthForms());

        act(() => {
            result.current.handleChange(change('username', 'testuser'));
            result.current.handleChange(change('password', 'password123'));
        });

        let isValid;
        act(() => {
            isValid = result.current.validate();
        });

        expect(isValid).toBe(true);
        expect(result.current.fieldErrors).toEqual({});
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

    it('flags a confirm password that does not match', () => {
        const { result } = renderHook(() => useAuthForms({ username: '', password: '', confirmPassword: '' }));
        act(() => {
            result.current.handleChange(change('username', 'newuser'));
            result.current.handleChange(change('password', 'pass123'));
            result.current.handleChange(change('confirmPassword', 'pass124'));
        });
        let isValid;
        act(() => { isValid = result.current.validate(); });
        expect(isValid).toBe(false);
        expect(result.current.fieldErrors).toEqual({ confirmPassword: "Passwords don't match." });
        act(() => { result.current.handleChange(change('confirmPassword', 'pass123')); });
        expect(result.current.fieldErrors.confirmPassword).toBeUndefined();
    });
});
