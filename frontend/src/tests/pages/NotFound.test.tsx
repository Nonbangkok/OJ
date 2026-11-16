import { fireEvent, render, screen, within } from '@testing-library/react';
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
        Element.prototype.scrollIntoView = jest.fn();
        (jest.mocked(authService.checkLogin) as jest.Mock).mockRejectedValue(new Error('guest'));
        (jest.mocked(authService.getSiteConfig) as jest.Mock).mockResolvedValue({
            siteAccessMode: 'public', registrationEnabled: true, passwordChangeEnabled: true,
        });
    });

    it('shows a "page not found" page with a way home instead of the router\'s developer error screen', async () => {
        renderAppAt('/definitely/not-a-page');

        expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
        expect(screen.queryByText(/hey developer/i)).not.toBeInTheDocument();
    });

    it('shows the requested path', async () => {
        renderAppAt('/problemz/vector_eraze?tab=submit');

        expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
        expect(screen.getByText('/problemz/vector_eraze')).toBeInTheDocument();
    });

    it('Search opens the command palette', async () => {
        renderAppAt('/definitely/not-a-page');

        fireEvent.click(await screen.findByRole('button', { name: 'Search for a page' }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('the Search button\'s shortcut reads Ctrl+K off Apple platforms', async () => {
        renderAppAt('/definitely/not-a-page');
        const button = await screen.findByRole('button', { name: 'Search for a page' });
        expect(within(button).getByText('Ctrl+K')).toBeInTheDocument();
    });

    it('also catches unknown paths under /admin', async () => {
        renderAppAt('/admin/no-such-panel');

        expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    });
});
