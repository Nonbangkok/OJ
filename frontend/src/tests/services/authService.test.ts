import api from '../../services/api';
import authService from '../../services/authService';

jest.mock('../../services/api');

describe('Auth Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('checkLogin fetches current user', async () => {
        const mockData = { isAuthenticated: true as const, user: { id: 1, username: 'testuser', role: 'user' as const } };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await authService.checkLogin();

        expect(api.get).toHaveBeenCalledWith('/me');
        expect(result).toEqual(mockData);
    });

    it('login sends credentials', async () => {
        const mockData = { message: 'Logged in', user: { id: 1, username: 'user', role: 'user' as const } };
        jest.mocked(api.post).mockResolvedValueOnce({ data: mockData });

        const result = await authService.login('user', 'pass');

        expect(api.post).toHaveBeenCalledWith('/login', { username: 'user', password: 'pass' });
        expect(result).toEqual(mockData);
    });

    it('logout sends logout request', async () => {
        jest.mocked(api.post).mockResolvedValueOnce({});

        await authService.logout();

        expect(api.post).toHaveBeenCalledWith('/logout');
    });

    it('register sends credentials', async () => {
        const mockData = { message: 'Registered', user: { id: 10, username: 'new' } };
        jest.mocked(api.post).mockResolvedValueOnce({ data: mockData });

        const result = await authService.register('new', 'pass');

        expect(api.post).toHaveBeenCalledWith('/register', { username: 'new', password: 'pass' });
        expect(result).toEqual(mockData);
    });

    it('getRegistrationSettings fetches registration settings', async () => {
        const mockData = { enabled: true };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await authService.getRegistrationSettings();

        expect(api.get).toHaveBeenCalledWith('/settings/registration');
        expect(result).toEqual(mockData);
    });
});
