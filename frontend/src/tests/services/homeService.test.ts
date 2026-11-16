import api from '../../services/api';
import homeService from '../../services/homeService';

jest.mock('../../services/api');

describe('homeService', () => {
  it('getHome fetches the logged-in home summary', async () => {
    const summary = { currentStreak: 2, solvedToday: false, week: [], continue: null, startWith: [], collections: [], levelUp: null };
    jest.mocked(api.get).mockResolvedValueOnce({ data: summary });

    await expect(homeService.getHome()).resolves.toEqual(summary);
    expect(api.get).toHaveBeenCalledWith('/me/home');
  });
});
