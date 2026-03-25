import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggleButton from '../../components/shared/ThemeToggleButton';

const mockToggleTheme = jest.fn();
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({
        theme: 'light',
        toggleTheme: mockToggleTheme,
    })),
}));

const mockUseTheme = require('../../context/ThemeContext').useTheme;

describe('ThemeToggleButton', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(mockUseTheme).mockReturnValue({ theme: 'light', toggleTheme: mockToggleTheme });
    });

    it('renders with light theme (moon icon)', () => {
        render(<ThemeToggleButton />);

        expect(screen.getByRole('button')).toBeInTheDocument();
        expect(screen.getByLabelText(/switch to dark mode/i)).toBeInTheDocument();
        expect(screen.getByText('🌙')).toBeInTheDocument();
    });

    it('renders with dark theme (sun icon)', () => {
        jest.mocked(mockUseTheme).mockReturnValue({ theme: 'dark', toggleTheme: mockToggleTheme });

        render(<ThemeToggleButton />);

        expect(screen.getByLabelText(/switch to light mode/i)).toBeInTheDocument();
        expect(screen.getByText('☀️')).toBeInTheDocument();
    });

    it('calls toggleTheme when clicked', () => {
        render(<ThemeToggleButton />);

        fireEvent.click(screen.getByRole('button'));

        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });
});
