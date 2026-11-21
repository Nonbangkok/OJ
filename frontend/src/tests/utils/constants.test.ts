import { APP_CONSTANTS, JAVA_STARTER_TEMPLATE, SUPPORTED_LANGUAGES, getLanguageDisplayName, judgedLimits } from '../../utils/constants';

describe('Project Constants', () => {
    it('has the correct system admin username', () => {
        expect(APP_CONSTANTS.SYSTEM_ADMIN_USERNAME).toBe('Nonbangkok');
    });

    it('has the correct submission cache expiry', () => {
        expect(APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY).toBe(30 * 60 * 1000);
    });

    it('offers Java 25 as a submission language', () => {
        expect([...SUPPORTED_LANGUAGES]).toEqual(['cpp', 'python', 'java']);
        expect(getLanguageDisplayName('java')).toBe('Java 25');
    });

    it('keeps the C++ and Python judged limits', () => {
        expect(judgedLimits('cpp', 1000, 256)).toEqual({ timeMs: 1000, memoryMb: 256 });
        expect(judgedLimits('python', 1000, 256)).toEqual({ timeMs: 4000, memoryMb: 512 });
        expect(judgedLimits('unknown', 1000, 256)).toEqual({ timeMs: 1000, memoryMb: 256 });
    });

    it('shows Java time x2 + 0.5 s and a heap clamped to 16..512 MB', () => {
        expect(judgedLimits('java', 1000, 256)).toEqual({ timeMs: 2500, memoryMb: 256 });
        expect(judgedLimits('java', 1000, 1024)).toEqual({ timeMs: 2500, memoryMb: 512 });
        expect(judgedLimits('java', 2000, 4)).toEqual({ timeMs: 4500, memoryMb: 16 });
    });

    it('starts Java editors with a class Main and no package', () => {
        expect(JAVA_STARTER_TEMPLATE).toContain('public class Main');
        expect(JAVA_STARTER_TEMPLATE).toContain('public static void main(String[] args)');
        expect(JAVA_STARTER_TEMPLATE).not.toMatch(/^package /m);
    });
});
