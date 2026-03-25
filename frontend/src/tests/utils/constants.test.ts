import { APP_CONSTANTS } from '../../utils/constants';

describe('Project Constants', () => {
    it('has the correct system admin username', () => {
        expect(APP_CONSTANTS.SYSTEM_ADMIN_USERNAME).toBe('Nonbangkok');
    });

    it('has the correct submission cache expiry', () => {
        expect(APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY).toBe(30 * 60 * 1000);
    });
});
