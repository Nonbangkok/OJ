import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextDecoder, TextEncoder });

// Mock useTheme hook globally to apply to all tests
jest.mock('./context/ThemeContext', () => ({
    useTheme: () => ({ theme: 'light' })
}));

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    (console.error as jest.Mock).mockRestore();
});
