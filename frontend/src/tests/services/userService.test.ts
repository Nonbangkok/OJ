import api from '../../services/api';
import userService from '../../services/userService';

jest.mock('../../services/api');

describe('User Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getProfile fetches public profile stats', async () => {
        const mockData = {
            id: 3,
            username: 'tester',
            role: 'user',
            hasAvatar: true,
            avatarUpdatedAt: '2026-09-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            problemsAttempted: 4,
            problemsSolved: 2,
            totalScore: 250,
            submissionCount: 9,
            verdictCounts: { Accepted: 3 },
            languageCounts: { cpp: 9 },
            dailyActivity: [{ day: '2026-09-18', count: 2 }],
        };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await userService.getProfile('tester');

        expect(api.get).toHaveBeenCalledWith('/users/tester/profile');
        expect(result).toEqual(mockData);
    });

    it('updateAvatar uploads the cropped PNG', async () => {
        const mockData = {
            message: 'Avatar updated',
            avatarUpdatedAt: '2026-09-19T00:00:00.000Z',
        };
        jest.mocked(api.put).mockResolvedValueOnce({ data: mockData });

        const blob = new Blob(['png'], { type: 'image/png' });
        const result = await userService.updateAvatar(blob);

        expect(api.put).toHaveBeenCalledWith(
            '/profile/avatar',
            expect.any(FormData),
            { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        const body = jest.mocked(api.put).mock.calls[0][1] as FormData;
        expect(body.get('avatar')).toBeInstanceOf(Blob);
        expect(result).toEqual(mockData);
    });
});
