import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pins the visibility architecture: the end-user gate lives in the read
 * paths (controllers + the getVisible* helpers + the public list SQL), and
 * the INTERNAL systems (scheduler, rejudge, migration, judge pipeline)
 * never filter contests on is_visible — hiding is an access gate, not
 * data-existence.
 */
const readSource = (relativePath: string): string =>
    readFileSync(join(__dirname, '..', '..', ...relativePath.split('/')), 'utf8');

describe('contest visibility internal pins', () => {
    const internalFiles = [
        'services/contestScheduler.ts',
        'services/rejudgeService.ts',
        'services/problemMigration.ts',
        'services/submissionService.ts',
        'services/contestScoreboardQueryService.ts',
    ];

    it.each(internalFiles)('internal system %s never filters on contest is_visible', (file) => {
        const source = readSource(file);
        // Scoreboard service DOES gate (it is end-user facing via the
        // controller) — but it gates via isContestManagementRole, never by
        // adding is_visible to its SQL WHERE clauses over internal rows.
        // The judge/scheduler/migration files must not mention it at all.
        expect(source).not.toMatch(/is_visible\s*=\s*(true|false|\$)/);
    });

    it('contestAccess keeps the internal lookups unfiltered', () => {
        const source = readSource('services/contestAccess.ts');
        // getContestById / getContestStatusById select raw rows; only the
        // getVisible* wrappers apply the gate.
        expect(source).toContain('export const getVisibleContestById');
        expect(source).toContain('export const getVisibleContestStatusById');
        expect(source).toContain('export const isContestManagementRole');
    });

    it('the admin visibility route is wired with staff/admin auth', () => {
        const source = readSource('controllers/contestController.ts');
        expect(source).toMatch(
            /'\/admin\/contests\/:id\/visibility', requireAuth, requireStaffOrAdmin/,
        );
    });

    it('the public contest list filters hidden contests', () => {
        const source = readSource('services/contestQueryService.ts');
        expect(source).toContain('WHERE c.is_visible = true');
        expect(source).toContain('includeHidden');
    });

    it('the submission feed contest branch gates hidden contests', () => {
        const source = readSource('services/submissionQueryService.ts');
        expect(source).toContain('SELECT status, is_visible FROM contests WHERE id = $1');
    });
});
