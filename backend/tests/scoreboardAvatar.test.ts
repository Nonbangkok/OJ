import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pins the scoreboard SQL contract: both the global scoreboard and the
 * contest scoreboard (running and finished branches) must expose whether
 * each user has an avatar, so the UI can render profile pictures.
 * The row types must carry the flag through to the API.
 */
const readSource = (relativePath: string): string =>
  readFileSync(join(__dirname, '..', ...relativePath.split('/')), 'utf8');

describe('scoreboard avatar exposure', () => {
  it('global scoreboard selects has_avatar', () => {
    const source = readSource('services/submissionQueryService.ts');
    expect(source).toContain('(u.avatar_png IS NOT NULL) AS has_avatar');
    expect(readSource('types/service.ts')).toContain('has_avatar: boolean;');
  });

  it('contest scoreboard selects has_avatar in both branches', () => {
    // The scoreboard SQL was split into contestScoreboardQueryService (see the
    // contest service split); the avatar contract follows the split module.
    const source = readSource('services/contestScoreboardQueryService.ts');
    const occurrences = source.split('(u.avatar_png IS NOT NULL) AS has_avatar').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
