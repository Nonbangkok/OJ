import api from '../../services/api';
import authService from '../../services/authService';

jest.mock('../../services/api');

describe('Auth Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('checkLogin fetches current user', async () => {
        const mockData = { isAuthenticated: true, user: { username: 'testuser' } };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await authService.checkLogin();

        expect(api.get).toHaveBeenCalledWith('/me');
        expect(result).toEqual(mockData);
    });

    it('login sends credentials', async () => {
        const mockData = { user: { username: 'user', role: 'user' } };
        api.post.mockResolvedValueOnce({ data: mockData });

        const result = await authService.login('user', 'pass');

        expect(api.post).toHaveBeenCalledWith('/login', { username: 'user', password: 'pass' });
        expect(result).toEqual(mockData);
    });

    it('logout sends logout request', async () => {
        api.post.mockResolvedValueOnce({});

        await authService.logout();

        expect(api.post).toHaveBeenCalledWith('/logout');
    });

    it('register sends credentials', async () => {
        const mockData = { user: { username: 'new', role: 'user' } };
        api.post.mockResolvedValueOnce({ data: mockData });

        const result = await authService.register('new', 'pass');

        expect(api.post).toHaveBeenCalledWith('/register', { username: 'new', password: 'pass' });
        expect(result).toEqual(mockData);
    });
});
