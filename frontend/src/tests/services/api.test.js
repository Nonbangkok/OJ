describe('API Utility', () => {
    const originalEnv = process.env.REACT_APP_API_URL;

    beforeEach(() => {
        process.env.REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
    });

    afterEach(() => {
        process.env.REACT_APP_API_URL = originalEnv;
    });

    it('is configured with base URL from env', () => {
        jest.isolateModules(() => {
            process.env.REACT_APP_API_URL = 'http://localhost:5000/api';
            const api = require('../../services/api').default;
            expect(api.defaults.baseURL).toBe('http://localhost:5000/api');
        });
    });

    it('includes credentials config', () => {
        const api = require('../../services/api').default;
        expect(api.defaults.withCredentials).toBe(true);
    });
});
