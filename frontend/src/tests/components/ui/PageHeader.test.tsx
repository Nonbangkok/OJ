import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';

describe('PageHeader', () => {
  it('renders the title as the page heading with breadcrumb, meta, actions and tabs', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Problems"
          description="Create, edit and publish problems."
          meta={<span>142 problems</span>}
          breadcrumb={[{ label: 'Manage', to: '/admin' }, { label: 'Problems' }]}
          actions={<button type="button">New problem</button>}
          tabs={<div role="tablist" aria-label="Sections" />}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Problems' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/admin');
    expect(within(crumbs).queryByRole('link', { name: 'Problems' })).toBeNull();
    expect(screen.getByText('Create, edit and publish problems.')).toBeInTheDocument();
    expect(screen.getByText('142 problems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New problem' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
  });

  it('omits the breadcrumb when none is given', () => {
    render(<MemoryRouter><PageHeader title="Ranking" /></MemoryRouter>);
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
});
