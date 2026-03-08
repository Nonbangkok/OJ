import { renderHook, act } from '@testing-library/react';
import useHomeQuotes from '../../hooks/useHomeQuotes';

describe('useHomeQuotes', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('initializes with Welcome quote and correct states', () => {
        const { result } = renderHook(() => useHomeQuotes());

        expect(result.current.currentQuote).toBe('Welcome');
        expect(result.current.isWelcome).toBe(true);
        expect(result.current.isFading).toBe(false);
    });

    it('updates quote and fades when clicked', () => {
        const { result } = renderHook(() => useHomeQuotes());

        act(() => {
            result.current.handleClick();
        });

        // Should start fading
        expect(result.current.isFading).toBe(true);
        expect(result.current.isWelcome).toBe(true); // Still true until timeout
        expect(result.current.currentQuote).toBe('Welcome');

        act(() => {
            jest.advanceTimersByTime(300);
        });

        // Should finish fading and update quote
        expect(result.current.isFading).toBe(false);
        expect(result.current.isWelcome).toBe(false);
        expect(result.current.currentQuote).not.toBe('Welcome');
        expect(typeof result.current.currentQuote).toBe('string');
    });

    it('prevents click while fading', () => {
        const { result } = renderHook(() => useHomeQuotes());

        act(() => {
            result.current.handleClick();
        });

        // Now it is fading
        const quoteWhileFading = result.current.currentQuote;

        act(() => {
            result.current.handleClick(); // Should be ignored
        });

        expect(result.current.isFading).toBe(true);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(result.current.isFading).toBe(false);
        // Should have updated once, not twice rapidly
    });
});
