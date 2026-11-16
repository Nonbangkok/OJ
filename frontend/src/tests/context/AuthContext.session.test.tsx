import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';

jest.mock('../../services/authService');

const Probe = () => {
  const { user, logout } = useAuth();
  return (
    <div>
      <span data-testid="role">{user?.role ?? 'guest'}</span>
      <button type="button" onClick={() => { void logout(); }}>out</button>
    </div>
  );
};

describe('AuthContext session upkeep', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('logging out clears the had-session flag so later guest 401s are not "expired"', async () => {
    (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValue({ isAuthenticated: true, user: { id: 1, username: 'n', role: 'user', hasAvatar: false } });
    (jest.mocked(authService.logout) as jest.Mock).mockResolvedValue(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('user'));
    expect(window.sessionStorage.getItem('oj:had-session')).toBe('1');
    await act(async () => { screen.getByRole('button', { name: 'out' }).click(); });
    expect(screen.getByTestId('role')).toHaveTextContent('guest');
    expect(window.sessionStorage.getItem('oj:had-session')).toBeNull();
  });

  it('re-reads the session when the window regains focus (role changes apply without reload)', async () => {
    (jest.mocked(authService.checkLogin) as jest.Mock)
      .mockResolvedValueOnce({ isAuthenticated: true, user: { id: 1, username: 'n', role: 'staff', hasAvatar: false } })
      .mockResolvedValueOnce({ isAuthenticated: true, user: { id: 1, username: 'n', role: 'user', hasAvatar: false } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('staff'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('user'));
  });
});
