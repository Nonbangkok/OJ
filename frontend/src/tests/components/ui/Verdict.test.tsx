import { render, screen } from '@testing-library/react';
import { ScoreCell, StatusMark, TestcaseStrip, VerdictText } from '../../../components/ui';
import { verdictLabel, verdictTone } from '../../../components/ui/verdictStatus';
import type { TestCaseResult } from '../../../types';

const results = (statuses: string[]): TestCaseResult[] => statuses.map((status, i) => ({ testCase: i + 1, status }));
const tenWith = (failAt: number, failStatus = 'Wrong Answer') =>
  results([...Array(10)].map((_, i) => (i < failAt ? 'Accepted' : i === failAt ? failStatus : 'Skipped')));

describe('verdictTone', () => {
  it.each([
    ['Accepted', 'pass'], ['Wrong Answer', 'fail'], ['Runtime Error', 'fail'], ['Compilation Error', 'fail'],
    ['Time Limit Exceeded', 'limit'], ['Memory Limit Exceeded', 'limit'], ['Pending', 'pending'],
    ['Compiling', 'pending'], ['Running', 'pending'], ['Skipped', 'none'], [null, 'none'],
  ])('%s → %s', (status, tone) => expect(verdictTone(status)).toBe(tone));
});

describe('verdictLabel', () => {
  it('counts passed cases from the results', () => {
    expect(verdictLabel('Wrong Answer', tenWith(6))).toBe('WRONG 6/10');
    expect(verdictLabel('Time Limit Exceeded', tenWith(8, 'Time Limit Exceeded'))).toBe('TIME LIMIT 8/10');
    expect(verdictLabel('Memory Limit Exceeded', tenWith(2, 'Memory Limit Exceeded'))).toBe('MEMORY LIMIT 2/10');
    expect(verdictLabel('Runtime Error', tenWith(3, 'Runtime Error'))).toBe('RUNTIME ERROR 3/10');
  });
  it.each([
    ['Accepted', 'ACCEPTED'], ['Wrong Answer', 'WRONG'], ['Compilation Error', 'COMPILATION ERROR'],
    ['Pending', 'PENDING'], ['Compiling', 'COMPILING'], ['Running', 'RUNNING'], ['Skipped', 'NOT RUN'], ['System Error', 'SYSTEM ERROR'],
  ])('%s without results → %s', (status, label) => expect(verdictLabel(status)).toBe(label));
});

describe('VerdictText', () => {
  it('pairs a status mark with the mono label', () => {
    const { container } = render(<VerdictText status="Wrong Answer" results={tenWith(6)} />);
    expect(screen.getByText('WRONG 6/10')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('StatusMark', () => {
  it('is decorative', () => {
    const { container } = render(<StatusMark tone="pass" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('TestcaseStrip', () => {
  const tones = (container: HTMLElement) => [...container.querySelectorAll('[data-segment]')].map((s) => s.getAttribute('data-tone'));

  it('the small strip is always six segments, filled in proportion to the cases passed', () => {
    const { container } = render(<TestcaseStrip results={tenWith(6)} />);
    expect(screen.getByRole('img', { name: '6 of 10 test cases passed' })).toBeInTheDocument();
    // 6/10 → 3.6 of 6 → 4 passed, then the failing verdict, then not reached.
    expect(tones(container)).toEqual(['pass', 'pass', 'pass', 'pass', 'fail', 'none']);
  });

  it('full marks fill all six; a near miss still shows its failure', () => {
    const all = render(<TestcaseStrip results={tenWith(10)} />);
    expect(tones(all.container)).toEqual(Array(6).fill('pass'));
    all.unmount();
    const many = results([...Array(60)].map((_, i) => (i < 59 ? 'Accepted' : 'Time Limit Exceeded')));
    const nearly = render(<TestcaseStrip results={many} />);
    expect(screen.getByRole('img', { name: '59 of 60 test cases passed' })).toBeInTheDocument();
    expect(tones(nearly.container)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'limit']);
    nearly.unmount();
    const none = render(<TestcaseStrip results={tenWith(0)} />);
    expect(tones(none.container)).toEqual(['fail', 'none', 'none', 'none', 'none', 'none']);
  });

  it('the large strip (submission page) still shows every case', () => {
    const { container } = render(<TestcaseStrip results={tenWith(6)} size="lg" />);
    expect(container.querySelectorAll('[data-segment]')).toHaveLength(10);
  });
});

describe('ScoreCell', () => {
  it('shows a dash when not attempted and the score otherwise', () => {
    const { rerender } = render(<ScoreCell score={null} attempted={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<ScoreCell score={40} attempted />);
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});
