import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PrivateRoute from '../../components/shared/PrivateRoute';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';

// Mutable test knobs flipped per case.
let mockAuthUser: { username: string } | null = null;
let mockIsPrivateMode = false;
let mockRegistrationEnabled = true;

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser, isLoading: false, login: jest.fn(), logout: jest.fn() }),
}));

jest.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    registrationEnabled: mockRegistrationEnabled,
    accessMode: mockIsPrivateMode ? 'private' : 'public',
    isPrivateMode: mockIsPrivateMode,
    isLoading: false,
    refreshSettings: jest.fn(),
  }),
}));

const Content = () => <div>protected content</div>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/problems" element={<PrivateRoute><Content /></PrivateRoute>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('PrivateRoute (site-private mode)', () => {
  beforeEach(() => {
    mockAuthUser = null;
    mockIsPrivateMode = false;
    mockRegistrationEnabled = true;
  });

  it('PUBLIC mode renders the content for guests', () => {
    renderAt('/problems');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('PRIVATE mode shows the auth-required screen for guests, preserving the route', () => {
    mockIsPrivateMode = true;
    renderAt('/problems');
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByText('Private Grader')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fproblems',
    );
  });

  it('PRIVATE mode renders content for authenticated users', () => {
    mockIsPrivateMode = true;
    mockAuthUser = { username: 'tester' };
    renderAt('/problems');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('hides the Create account action when registration is disabled', () => {
    mockIsPrivateMode = true;
    mockRegistrationEnabled = false;
    renderAt('/problems');
    expect(screen.queryByText('Create account')).not.toBeInTheDocument();
  });
});
