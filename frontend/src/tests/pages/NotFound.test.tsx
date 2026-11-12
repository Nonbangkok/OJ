import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { appRoutes } from '../../App';
import { AuthProvider } from '../../context/AuthContext';
import { SettingsProvider } from '../../context/SettingsContext';
import authService from '../../services/authService';

jest.mock('../../services/authService');

const renderAppAt = (path: string) => render(
    <AuthProvider>
        <SettingsProvider>
            <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
        </SettingsProvider>
    </AuthProvider>,
);

describe('unknown routes', () => {
    beforeEach(() => {
        (jest.mocked(authService.checkLogin) as jest.Mock).mockRejectedValue(new Error('guest'));
        (jest.mocked(authService.getSiteConfig) as jest.Mock).mockResolvedValue({
            siteAccessMode: 'public', registrationEnabled: true, passwordChangeEnabled: true,
        });
    });

    it('shows a "page not found" page with a way home instead of the router\'s developer error screen', async () => {
        renderAppAt('/definitely/not-a-page');

        expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
        expect(screen.queryByText(/hey developer/i)).not.toBeInTheDocument();
    });

    it('also catches unknown paths under /admin', async () => {
        renderAppAt('/admin/no-such-panel');

        expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    });
});
