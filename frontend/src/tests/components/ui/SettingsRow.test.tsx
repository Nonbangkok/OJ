import { render, screen } from '@testing-library/react';
import { SettingsRow } from '../../../components/ui';

describe('SettingsRow', () => {
  it('labels its control and shows the saved state', () => {
    render(<SettingsRow label="Allow registration" help="New accounts can sign up." htmlFor="reg" control={<input id="reg" type="checkbox" />} status="saved" />);
    expect(screen.getByRole('checkbox', { name: 'Allow registration' })).toBeInTheDocument();
    expect(screen.getByText('New accounts can sign up.')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('marks a danger row', () => {
    const { container } = render(<SettingsRow label="Replace database" control={<button type="button">Replace…</button>} danger />);
    expect(container.firstChild).toHaveAttribute('data-danger', 'true');
  });
});
