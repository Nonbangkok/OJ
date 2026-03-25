import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextDecoder, TextEncoder });

// Mock useTheme hook globally to apply to all tests
jest.mock('./context/ThemeContext', () => ({
    useTheme: () => ({ theme: 'light' })
}));

let consoleErrorSpy: jest.SpyInstance | null = null;

beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
});
