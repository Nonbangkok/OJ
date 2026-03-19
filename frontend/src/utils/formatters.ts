import { USER_ROLES, SUBMISSION_STATUS } from './constants';
import type { Submission } from '../types/index';

interface User {
    role: string;
    username: string;
}

interface TestCaseResult {
    status: string;
}

/**
 * Converts a date string to a human-readable "X ago" format.
 * @param {string} dateString - ISO date string
 * @returns {string} Relative time string (e.g., "5 minutes ago")
 */
export const formatTimeAgo = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return `${Math.floor(interval)} years ago`;
    interval = seconds / 2592000;
    if (interval > 1) return `${Math.floor(interval)} months ago`;
    interval = seconds / 86400;
    if (interval > 1) return `${Math.floor(interval)} days ago`;
    interval = seconds / 3600;
    if (interval > 1) return `${Math.floor(interval)} hours ago`;
    interval = seconds / 60;
    if (interval > 1) return `${Math.floor(interval)} minutes ago`;
    return `${Math.floor(seconds)} seconds ago`;
};

/**
 * Formats a date string into Thai Buddhist calendar absolute format.
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "01/03/69 09:15:30")
 */
export const formatDateAbsolute = (dateString: string): string => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const pad = (num: number): string => num.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${(d.getFullYear() + 543) % 100} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * Generates a compact result string from submission results.
 * @param {string} status - Overall submission status
 * @param {TestCaseResult[]} results - Array of test case results
 * @returns {string} Result string (e.g., "[PP-TS]")
 */
export const generateResultString = (status: string, results: TestCaseResult[]): string => {
    if (status === SUBMISSION_STATUS.COMPILATION_ERROR) {
        return SUBMISSION_STATUS.COMPILATION_ERROR;
    }
    if (!results || results.length === 0) {
        return '';
    }
    const charMap: Record<string, string> = {
        'Accepted': 'P',
        'Wrong Answer': '-',
        'Time Limit Exceeded': 'T',
        'Runtime Error': 'R',
        'Memory Limit Exceeded': 'M',
        'Skipped': 'S',
    };
    const resultChars = results.map(r => charMap[r.status] || '?').join('');
    return `[${resultChars}]`;
};

/**
 * Returns a CSS class name based on submission status.
 * @param {string} status - Submission status string
 * @returns {string} CSS class name (e.g., "status-accepted")
 */
export const getStatusClass = (status: string): string => {
    if (!status) return '';
    return `status-${status.split(' ')[0]?.toLowerCase() || ''}`;
};

/**
 * Formats a datetime into a localized short format.
 * @param {string} dateTime - ISO date string
 * @returns {string} Formatted date (e.g., "Mar 1, 2026, 09:15 AM")
 */
export const formatDateTime = (dateTime: string): string => {
    return new Date(dateTime).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Calculates remaining time until a given end time.
 * @param {string} endTime - ISO date string for the end time
 * @returns {string} Human-readable remaining time (e.g., "2h 30m remaining")
 */
export const getRemainingTime = (endTime: string): string => {
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Finished';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m remaining`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m remaining`;
    } else {
        return `${minutes}m remaining`;
    }
};

/**
 * Checks if a user can view the code of a given submission.
 * @param {Submission} submission - Submission object with optional `username` field
 * @param {User} user - Current user object with `role` and `username` fields
 * @returns {boolean}
 */
export const canViewCode = (submission: Submission, user: User | null): boolean => {
    if (!user) return false;
    if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.STAFF) return true;
    return submission.username === user.username;
};
