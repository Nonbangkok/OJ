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

// jsdom has no PointerEvent; Base UI menus construct one when a menu item is
// activated from the keyboard. A MouseEvent subclass carries the same fields
// the code reads.
if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventStub extends MouseEvent {
        pointerId: number;
        pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
            this.pointerType = init.pointerType ?? '';
        }
    }
    globalThis.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
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
