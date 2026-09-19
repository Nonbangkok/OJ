import { render, screen } from '@testing-library/react';

import KpiCard from './KpiCard';

describe('KpiCard', () => {
  it('renders the label and value', () => {
    render(<KpiCard label="Submissions" value={42} deltaPercent={null} />);

    expect(screen.getByText('Submissions')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('hides the delta when deltaPercent is null (all-time window)', () => {
    render(<KpiCard label="Users" value={5} deltaPercent={null} />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders a positive delta with a plus sign', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={12.4} />);

    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('renders a negative delta without a plus sign', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={-7.6} />);

    expect(screen.getByText('-8%')).toBeInTheDocument();
  });

  it('renders a zero delta as 0% (no plus sign)', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={0} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('supports string values', () => {
    render(<KpiCard label="Contest" value="running" deltaPercent={null} />);

    expect(screen.getByText('running')).toBeInTheDocument();
  });
});
