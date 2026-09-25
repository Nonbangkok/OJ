import { useCallback, useState } from 'react';

import { STRING_LIMITS, USER_VALIDATION } from '../../utils/constants';

/** A single Zod issue from the backend's 400 "Validation failed" payload. */
interface ZodIssueLike {
    path?: (string | number)[];
    code?: string;
    message?: string;
}

interface ApiErrorData {
    message?: unknown;
    errors?: unknown;
}

interface ApiLikeError {
    message?: unknown;
    response?: {
        data?: ApiErrorData;
    };
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

/**
 * Translate a backend Zod issue into the same wording the client-side
 * validation uses, so a 400 never surfaces raw Zod jargon
 * ("Too small: expected string to have >=8 characters").
 */
const formatIssue = (issue: ZodIssueLike): string => {
    const field = issue.path?.[0];
    if (field === 'username') {
        if (issue.code === 'too_small') {
            return `Username must be at least ${USER_VALIDATION.MIN_USERNAME_LENGTH} characters long.`;
        }
        if (issue.code === 'too_big') {
            return `Username must be at most ${STRING_LIMITS.USERNAME} characters long.`;
        }
    }
    if (field === 'password') {
        if (issue.code === 'too_small') {
            return `Password must be at least ${USER_VALIDATION.MIN_PASSWORD_LENGTH} characters long.`;
        }
        if (issue.code === 'too_big') {
            return `Password must be at most ${STRING_LIMITS.PASSWORD} characters long.`;
        }
    }
    return typeof issue.message === 'string' && issue.message ? issue.message : 'Invalid value.';
};

/**
 * Extract a readable message from an API failure:
 * - 400 Zod failures carry `errors[]` (issue paths + codes)
 * - everything else (409 duplicate username, 403, 500…) carries `message`
 */
export const getCreateUserErrorMessage = (error: unknown): string => {
    const apiError = isObjectRecord(error) ? (error as ApiLikeError) : { message: String(error) };
    const data = apiError.response?.data;

    if (isObjectRecord(data)) {
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            return data.errors
                .filter(isObjectRecord)
                .map((issue) => formatIssue(issue as ZodIssueLike))
                .join(' ');
        }
        if (typeof data.message === 'string' && data.message && data.message !== 'Validation failed') {
            return data.message;
        }
    }

    if (typeof apiError.message === 'string' && apiError.message) {
        return apiError.message;
    }

    return 'Failed to create user.';
};

export interface AddUserFieldErrors {
    username?: string;
    password?: string;
}

/**
 * State for the admin "Create New User" dialog. Validation mirrors the
 * backend createAdminUserSchema (username 3–50, password 8–256) so a bad
 * payload is blocked client-side before the request; server rejections
 * (case-insensitive duplicate username, etc.) are surfaced as `serverError`
 * and keep the dialog open for a retry.
 */
const useAddUserModal = (onSave: (userData: { username: string; password: string; role: string }) => unknown) => {
    const [username, setUsernameState] = useState('');
    const [password, setPasswordState] = useState('');
    const [role, setRole] = useState('user');
    const [fieldErrors, setFieldErrors] = useState<AddUserFieldErrors>({});
    const [serverError, setServerError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const validate = (): AddUserFieldErrors => {
        const errors: AddUserFieldErrors = {};
        const trimmedUsername = username.trim();
        if (trimmedUsername.length < USER_VALIDATION.MIN_USERNAME_LENGTH) {
            errors.username = `Username must be at least ${USER_VALIDATION.MIN_USERNAME_LENGTH} characters long.`;
        } else if (trimmedUsername.length > STRING_LIMITS.USERNAME) {
            errors.username = `Username must be at most ${STRING_LIMITS.USERNAME} characters long.`;
        }
        if (password.length < USER_VALIDATION.MIN_PASSWORD_LENGTH) {
            errors.password = `Password must be at least ${USER_VALIDATION.MIN_PASSWORD_LENGTH} characters long.`;
        } else if (password.length > STRING_LIMITS.PASSWORD) {
            errors.password = `Password must be at most ${STRING_LIMITS.PASSWORD} characters long.`;
        }
        return errors;
    };

    // Editing a field clears its own error (and any stale server error) so
    // the message never lingers after the admin starts fixing the input.
    const setUsername = (value: string) => {
        setUsernameState(value);
        setFieldErrors((prev) => (prev.username ? { ...prev, username: undefined } : prev));
        setServerError('');
    };

    const setPassword = (value: string) => {
        setPasswordState(value);
        setFieldErrors((prev) => (prev.password ? { ...prev, password: undefined } : prev));
        setServerError('');
    };

    const handleSave = async () => {
        if (isSubmitting) return;
        const errors = validate();
        if (errors.username || errors.password) {
            setFieldErrors(errors);
            setServerError('');
            return;
        }
        setFieldErrors({});
        setServerError('');
        setIsSubmitting(true);
        try {
            await onSave({ username, password, role });
        } catch (error) {
            setServerError(getCreateUserErrorMessage(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    /** Clear everything — called each time the dialog opens. */
    const resetForm = useCallback(() => {
        setUsernameState('');
        setPasswordState('');
        setRole('user');
        setFieldErrors({});
        setServerError('');
        setIsSubmitting(false);
    }, []);

    return {
        username,
        setUsername,
        password,
        setPassword,
        role,
        setRole,
        fieldErrors,
        serverError,
        isSubmitting,
        resetForm,
        handleSave
    };
};

export default useAddUserModal;
