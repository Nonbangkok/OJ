import { solveXp } from '../../config/progression';

describe('solveXp (mirror of backend constants/progression)', () => {
  it('follows round(20 * (difficulty / 800) ^ 1.5)', () => {
    expect([800, 1400, 1600, 2200, 3500].map(solveXp)).toEqual([20, 46, 57, 91, 183]);
  });
  it('unrated problems give 10 XP', () => {
    expect(solveXp(null)).toBe(10);
  });
});
