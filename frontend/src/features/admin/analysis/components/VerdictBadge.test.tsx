import { render, screen } from '@testing-library/react';

import VerdictBadge from './VerdictBadge';

describe('VerdictBadge', () => {
  it('renders the verdict text', () => {
    render(<VerdictBadge verdict="Accepted" />);

    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it.each([
    ['Accepted'],
    ['Wrong Answer'],
    ['Time Limit Exceeded'],
    ['Memory Limit Exceeded'],
    ['Runtime Error'],
    ['Compilation Error'],
    ['System Error'],
    ['Skipped'],
  ])('maps known verdict %s to its colour class', (verdict) => {
    const { container } = render(<VerdictBadge verdict={verdict} />);

    const badge = container.firstChild as HTMLElement;
    expect(badge.className).not.toContain('default');
  });

  it('uses a slug class for unknown verdicts (unstyled, so CSS renders the default look)', () => {
    const { container } = render(<VerdictBadge verdict="Some New Verdict" />);

    const badge = container.firstChild as HTMLElement;
    // The slug class has no CSS rule, so the badge keeps the base .badge
    // styling — the visual fallback — without a literal .default class.
    expect(badge.className).toContain('some-new-verdict');
  });
});
