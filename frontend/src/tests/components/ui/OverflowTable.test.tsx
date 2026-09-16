import { render, screen } from '@testing-library/react';
import { OverflowTable } from '../../../components/ui';

describe('OverflowTable', () => {
  it('exposes a focusable named region around the supplied semantic table', () => {
    render(
      <OverflowTable label="Contest standings" data-testid="standings-container">
        <table>
          <caption>Contest standings</caption>
          <tbody>
            <tr>
              <td>Ada</td>
            </tr>
          </tbody>
        </table>
      </OverflowTable>,
    );

    const region = screen.getByRole('region', { name: 'Contest standings' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('data-testid', 'standings-container');
    expect(region).toContainElement(screen.getByRole('table', { name: 'Contest standings' }));
  });
});
