import { render, screen } from '@testing-library/react';
import { Countdown, ProgressBar, StatusDot } from '../../../components/ui';

describe('Countdown', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-16T10:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  const base = { start_time: '2026-11-16T09:00:00Z', end_time: '2026-11-16T11:42:17Z' };

  it.each([
    ['running', /^ENDS IN 01:42:17$/],
    ['scheduled', /^STARTS IN /],
    ['finishing', /^JUDGING$/],
    ['finished', /^ENDED$/],
  ] as const)('%s', (status, text) => {
    const contest = status === 'scheduled' ? { status, start_time: '2026-11-16T12:00:00Z', end_time: '2026-11-16T15:00:00Z' } : { status, ...base };
    render(<Countdown contest={contest} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('exposes its value and clamps to the max', () => {
    render(<ProgressBar value={120} max={100} label="Level progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Level progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
});

describe('StatusDot', () => {
  it('is text with a dot, never a control', () => {
    render(<StatusDot tone="pass" label="Visible" />);
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
