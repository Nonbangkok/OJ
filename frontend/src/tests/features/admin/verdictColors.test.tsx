import { act, render, screen, waitFor } from '@testing-library/react';
import { useVerdictColors } from '../../../features/admin/analysis/analysisCharts';

function Probe() {
  const colors = useVerdictColors();
  return <p data-testid="accepted">{colors.accepted}</p>;
}

describe('useVerdictColors', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--verdict-accepted');
  });

  it('re-reads the tokens once the theme attribute actually changes', async () => {
    const root = document.documentElement;
    root.style.setProperty('--verdict-accepted', '#15803d');
    render(<Probe />);
    expect(screen.getByTestId('accepted')).toHaveTextContent('#15803d');

    // ThemeProvider sets data-theme in an effect, after consumers rendered: the hook must follow the attribute.
    act(() => {
      root.style.setProperty('--verdict-accepted', '#3fb950');
      root.setAttribute('data-theme', 'dark');
    });
    await waitFor(() => expect(screen.getByTestId('accepted')).toHaveTextContent('#3fb950'));
  });

  it('falls back to the fixed palette when a token is missing', () => {
    render(<Probe />);
    expect(screen.getByTestId('accepted').textContent).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
