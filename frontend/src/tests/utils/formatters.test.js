import {
    formatTimeAgo,
    formatDateAbsolute,
    generateResultString,
    getStatusClass,
    formatDateTime,
    getRemainingTime,
    canViewCode,
} from '../../utils/formatters';

describe('formatters', () => {
    describe('formatTimeAgo', () => {
        it('returns empty string for null/undefined', () => {
            expect(formatTimeAgo(null)).toBe('');
            expect(formatTimeAgo(undefined)).toBe('');
        });

        it('returns "X seconds ago" for recent date', () => {
            const now = new Date();
            const past = new Date(now.getTime() - 5000); // 5 seconds ago
            expect(formatTimeAgo(past.toISOString())).toMatch(/\d+ seconds ago/);
        });

        it('returns "X minutes ago" for minutes ago', () => {
            const now = new Date();
            const past = new Date(now.getTime() - 5 * 60 * 1000);
            expect(formatTimeAgo(past.toISOString())).toBe('5 minutes ago');
        });

        it('returns "X hours ago" for hours ago', () => {
            const now = new Date();
            const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
            expect(formatTimeAgo(past.toISOString())).toBe('2 hours ago');
        });
    });

    describe('formatDateAbsolute', () => {
        it('returns empty string for null/undefined', () => {
            expect(formatDateAbsolute(null)).toBe('');
            expect(formatDateAbsolute(undefined)).toBe('');
        });

        it('formats date in Thai Buddhist calendar format', () => {
            const date = new Date('2026-03-01T09:15:30Z');
            const result = formatDateAbsolute(date.toISOString());
            expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
        });
    });

    describe('generateResultString', () => {
        it('returns "Compilation Error" for compilation error status', () => {
            expect(generateResultString('Compilation Error', [])).toBe('Compilation Error');
        });

        it('returns empty string for empty results', () => {
            expect(generateResultString('Accepted', [])).toBe('');
            expect(generateResultString('Accepted', null)).toBe('');
        });

        it('returns compact string for test case results', () => {
            const results = [
                { status: 'Accepted' },
                { status: 'Wrong Answer' },
                { status: 'Time Limit Exceeded' },
            ];
            expect(generateResultString('Accepted', results)).toBe('[P-T]');
        });

        it('maps unknown status to ?', () => {
            const results = [{ status: 'Unknown' }];
            expect(generateResultString('Accepted', results)).toBe('[?]');
        });
    });

    describe('getStatusClass', () => {
        it('returns empty string for null/undefined', () => {
            expect(getStatusClass(null)).toBe('');
            expect(getStatusClass(undefined)).toBe('');
        });

        it('returns status class for single word status', () => {
            expect(getStatusClass('Accepted')).toBe('status-accepted');
        });

        it('returns first word lowercase for multi-word status', () => {
            expect(getStatusClass('Time Limit Exceeded')).toBe('status-time');
        });
    });

    describe('formatDateTime', () => {
        it('formats date in en-US locale', () => {
            const date = new Date('2026-03-01T09:15:00Z');
            const result = formatDateTime(date.toISOString());
            expect(result).toMatch(/Mar.*2026/);
        });
    });

    describe('getRemainingTime', () => {
        it('returns "Finished" when end time has passed', () => {
            const past = new Date(Date.now() - 60000);
            expect(getRemainingTime(past.toISOString())).toBe('Finished');
        });

        it('returns "Xm remaining" for future within an hour', () => {
            const future = new Date(Date.now() + 30 * 60 * 1000);
            expect(getRemainingTime(future.toISOString())).toMatch(/\d+m remaining/);
        });

        it('returns "Xh Xm remaining" for future within a day', () => {
            const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
            expect(getRemainingTime(future.toISOString())).toMatch(/\d+h \d+m remaining/);
        });
    });

    describe('canViewCode', () => {
        it('returns false when user is null', () => {
            expect(canViewCode({ username: 'test' }, null)).toBe(false);
        });

        it('returns true when user is admin', () => {
            expect(canViewCode({ username: 'other' }, { role: 'admin' })).toBe(true);
        });

        it('returns true when user is staff', () => {
            expect(canViewCode({ username: 'other' }, { role: 'staff' })).toBe(true);
        });

        it('returns true when user owns the submission', () => {
            expect(canViewCode({ username: 'me' }, { username: 'me', role: 'user' })).toBe(true);
        });

        it('returns false when user is regular and does not own submission', () => {
            expect(canViewCode({ username: 'other' }, { username: 'me', role: 'user' })).toBe(false);
        });
    });
});
