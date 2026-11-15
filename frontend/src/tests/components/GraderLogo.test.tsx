import { render, screen } from '@testing-library/react';
import GraderLogo from '../../components/brand/GraderLogo';

describe('GraderLogo', () => {
  it('renders an accessible image named Grader by default', () => {
    render(<GraderLogo />);
    const svg = screen.getByRole('img', { name: 'Grader' });
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('viewBox', '0 0 512 512');
  });

  it('sizes to the size prop', () => {
    render(<GraderLogo size={32} />);
    expect(screen.getByRole('img', { name: 'Grader' })).toHaveAttribute('width', '32');
  });

  it('draws three crescents: two in currentColor, one in the logo accent', () => {
    const { container } = render(<GraderLogo />);
    const crescents = [...container.querySelectorAll('[data-crescent]')];
    expect(crescents).toHaveLength(3);
    expect(crescents.filter((c) => c.getAttribute('fill') === 'currentColor')).toHaveLength(2);
    expect(crescents.filter((c) => c.getAttribute('fill') === 'var(--logo-accent)')).toHaveLength(1);
  });

  it('is hidden from assistive tech when title is empty', () => {
    const { container } = render(<GraderLogo title="" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each instance its own mask ids', () => {
    const { container } = render(<><GraderLogo /><GraderLogo /></>);
    const ids = [...container.querySelectorAll('mask')].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
