import { act, renderHook } from '@testing-library/react';
import { formatRemaining, useCountdown } from '../../../components/shell/useCountdown';

describe('formatRemaining', () => {
  it.each([
    [0, '00:00:00'],
    [-5, '00:00:00'],
    [3_723_000, '01:02:03'],
    [90_061_000, '1d 01:01'],
  ])('%i ms → %s', (ms, label) => {
    expect(formatRemaining(ms)).toBe(label);
  });
});

describe('useCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('ticks down to zero and stops without going negative', () => {
    const { result } = renderHook(() => useCountdown(new Date('2026-11-16T10:00:02Z')));
    expect(result.current.label).toBe('00:00:02');
    expect(result.current.done).toBe(false);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(result.current.done).toBe(true);
    expect(result.current.label).toBe('00:00:00');
    act(() => { jest.advanceTimersByTime(5000); });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.label).toBe('00:00:00');
  });

  it('is done and empty without a target', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toEqual({ remainingMs: 0, label: '', done: true });
  });
});
