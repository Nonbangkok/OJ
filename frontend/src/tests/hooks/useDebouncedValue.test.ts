import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

describe('useDebouncedValue', () => {
  afterEach(() => jest.useRealTimers());

  it('updates only after the delay and cancels superseded values', () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: '' },
    });

    rerender({ value: 'g' });
    act(() => { jest.advanceTimersByTime(200); });
    rerender({ value: 'graph' });
    act(() => { jest.advanceTimersByTime(299); });
    expect(result.current).toBe('');
    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe('graph');
  });
});
