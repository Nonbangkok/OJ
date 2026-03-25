import { render, screen, fireEvent } from '@testing-library/react';
import Navbar from '../components/navbar/Navbar';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';

// Mock react-router-dom
jest.mock('react-router-dom', () => ({
  NavLink: ({ children, to }) => <a href={to}>{children}</a>,
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/' }),
}));

// Mock the context hooks
jest.mock('../context/AuthContext');
jest.mock('../context/SettingsContext');
jest.mock('../context/ThemeContext', () => ({
  useTheme: jest.fn(),
}));

// Mock assets
jest.mock('../assets/logo512.png', () => 'test-file-stub');
jest.mock('../assets/logo512_darkmode.png', () => 'test-file-stub');

describe('Navbar Component', () => {
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      logout: mockLogout,
    });
    jest.mocked(useSettings).mockReturnValue({
      registrationEnabled: true,
      isLoading: false,
      refreshSettings: jest.fn(),
    });
    jest.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme: jest.fn(),
    });
  });

  test('renders login and register links when user is not logged in', () => {
    render(<Navbar />);

    expect(screen.getByText(/Login/i)).toBeInTheDocument();
    expect(screen.getByText(/Register/i)).toBeInTheDocument();
  });

  test('does not render register link if registration is disabled', () => {
    jest.mocked(useSettings).mockReturnValue({
      registrationEnabled: false,
      isLoading: false,
      refreshSettings: jest.fn(),
    });

    render(<Navbar />);

    expect(screen.queryByText(/Register/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Login/i)).toBeInTheDocument();
  });

  test('renders username and logout button when user is logged in', () => {
    jest.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: 'testuser', role: 'user' },
      isLoading: false,
      login: jest.fn(),
      logout: mockLogout,
    });

    render(<Navbar />);

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText(/Logout/i)).toBeInTheDocument();
  });

  test('renders Admin Panel link only for admins', () => {
    jest.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: 'adminuser', role: 'admin' },
      isLoading: false,
      login: jest.fn(),
      logout: mockLogout,
    });

    render(<Navbar />);

    expect(screen.getByText(/Admin Panel/i)).toBeInTheDocument();
  });

  test('calls logout function when logout button is clicked', () => {
    jest.mocked(useAuth).mockReturnValue({
      user: { id: 3, username: 'testuser', role: 'user' },
      isLoading: false,
      login: jest.fn(),
      logout: mockLogout,
    });

    render(<Navbar />);

    fireEvent.click(screen.getByText(/Logout/i));
    expect(mockLogout).toHaveBeenCalled();
  });
});
