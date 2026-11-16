import { render, screen } from '@testing-library/react';

import KpiCard from './KpiCard';

describe('KpiCard', () => {
  it('renders the label and value', () => {
    render(<KpiCard label="Submissions" value={42} deltaPercent={null} comparison="30d" />);

    expect(screen.getByText('Submissions')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('hides the delta when deltaPercent is null (all-time window)', () => {
    render(<KpiCard label="Users" value={5} deltaPercent={null} comparison="30d" />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders a rise as an up arrow against the previous window', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={12.4} comparison="30d" />);

    expect(screen.getByText('▲ 12% vs prev. 30d')).toBeInTheDocument();
  });

  it('renders a fall as a down arrow with no minus sign', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={-7.6} comparison="7d" />);

    expect(screen.getByText('▼ 8% vs prev. 7d')).toBeInTheDocument();
  });

  it('renders no change as a bare 0%', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={0} comparison="30d" />);

    expect(screen.getByText('0% vs prev. 30d')).toBeInTheDocument();
  });

  it('keeps the delta neutral: no rise/fall colouring', () => {
    render(<KpiCard label="Accepted" value={10} deltaPercent={-40} comparison="30d" />);

    expect(screen.getByText('▼ 40% vs prev. 30d').className).not.toMatch(/up|down/);
  });

  it('supports string values', () => {
    render(<KpiCard label="Contest" value="running" deltaPercent={null} comparison="30d" />);

    expect(screen.getByText('running')).toBeInTheDocument();
  });
});
