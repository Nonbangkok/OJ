import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextDecoder, TextEncoder });

// jsdom has no ResizeObserver; react-resizable-panels v4 observes its group
// and panel sizes with it. A no-op is enough: layout maths is not under test.
if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
        observe() { }
        unobserve() { }
        disconnect() { }
    }
    globalThis.ResizeObserver = ResizeObserverStub;
}

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
