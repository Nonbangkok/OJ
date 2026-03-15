import { render, screen } from '@testing-library/react';
import ThemeToggleButton from '../components/shared/ThemeToggleButton';
import { useTheme } from '../context/ThemeContext';

jest.mock('../context/ThemeContext', () => ({
    useTheme: jest.fn(),
}));

describe('ThemeToggleButton', () => {
    test('renders the toggle button', () => {
        useTheme.mockReturnValue({ theme: 'light', toggleTheme: jest.fn() });
        render(<ThemeToggleButton />);
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
    });
});
