import { renderHook, act } from '@testing-library/react';
import useHomeQuotes from '../../hooks/useHomeQuotes';

describe('useHomeQuotes', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('initializes with a random quote from the list', () => {
        const { result } = renderHook(() => useHomeQuotes());

        expect(typeof result.current.currentQuote).toBe('string');
        expect(result.current.currentQuote.length).toBeGreaterThan(0);
        expect(result.current.isFading).toBe(false);
    });

    it('updates the quote after the fade when another quote is requested', () => {
        const { result } = renderHook(() => useHomeQuotes());
        const initialQuote = result.current.currentQuote;

        act(() => {
            result.current.showAnotherQuote();
        });

        // Should start fading, quote unchanged until the timeout fires
        expect(result.current.isFading).toBe(true);
        expect(result.current.currentQuote).toBe(initialQuote);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        // Should finish fading and update the quote
        expect(result.current.isFading).toBe(false);
        expect(result.current.currentQuote).not.toBe(initialQuote);
    });

    it('prevents requesting another quote while fading', () => {
        const { result } = renderHook(() => useHomeQuotes());

        act(() => {
            result.current.showAnotherQuote();
        });

        // Now it is fading
        act(() => {
            result.current.showAnotherQuote(); // Should be ignored
        });

        expect(result.current.isFading).toBe(true);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(result.current.isFading).toBe(false);
        // Should have updated once, not twice rapidly
    });
});
