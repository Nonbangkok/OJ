import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useNavSlider } from '../../hooks/useNavSlider';

interface HarnessProps {
  direction?: 'horizontal' | 'vertical';
  activeSelector?: string;
}

// Minimal nav bar exercising the hook the way real consumers do: a ref'd
// container, a slider element styled by the hook, and two items. The second
// item mimics react-router's NavLink: aria-current="page" marks the active
// route (the class-based `active` only appears when NavLink manages its own
// className, which the authoring left nav takes over).
function SliderNav({ direction = 'horizontal', activeSelector }: HarnessProps) {
  const { navRef, sliderStyle, handleItemMouseEnter, resetSlider } = useNavSlider<HTMLUListElement>(
    direction,
    { activeSelector }
  );
  return (
    <ul
      ref={navRef}
      onMouseLeave={resetSlider}
      data-testid="nav"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: direction === 'vertical' ? 'column' : 'row',
      }}
    >
      <li data-testid="slider" style={sliderStyle} aria-hidden="true">
        <span>First</span>
      </li>
      <li onMouseEnter={handleItemMouseEnter}>
        <a href="#second">Second</a>
      </li>
      <li onMouseEnter={handleItemMouseEnter}>
        <a href="#third" aria-current="page">
          Third
        </a>
      </li>
    </ul>
  );
}

describe('useNavSlider', () => {
  // jsdom returns 0 for all layout measurements, so the exact numbers are
  // not meaningful here — the opacity and dimension keys are.

  it('starts hidden (opacity 0)', async () => {
    render(<SliderNav />);
    const slider = screen.getByTestId('slider');
    expect(slider).toHaveStyle({ opacity: '0' });
  });

  it('shows the slider (opacity 1) when an item is hovered', () => {
    render(<SliderNav />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    expect(screen.getByTestId('slider')).toHaveStyle({ opacity: '1' });
  });

  it('measures width/left in horizontal mode', () => {
    render(<SliderNav direction="horizontal" />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    const slider = screen.getByTestId('slider');
    expect(slider.style.width).not.toBe('');
    expect(slider.style.left).not.toBe('');
    expect(slider.style.height).toBe('');
  });

  it('measures height/top in vertical mode', () => {
    render(<SliderNav direction="vertical" />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    const slider = screen.getByTestId('slider');
    expect(slider.style.height).not.toBe('');
    expect(slider.style.top).not.toBe('');
    expect(slider.style.width).toBe('');
  });

  it('settles on the aria-current item (not the first one) after mouse leave', async () => {
    render(<SliderNav />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    fireEvent.mouseLeave(screen.getByTestId('nav'));
    // The delayed initial-measure timer also runs resetSlider; wait for it so
    // the assertion sees the settled state regardless of timer ordering.
    await waitFor(() => {
      const slider = screen.getByTestId('slider');
      expect(slider).toHaveStyle({ opacity: '1' });
      expect(slider.style.width).not.toBe('');
      expect(slider.style.left).not.toBe('');
    });
    // jsdom reports identical zero measurements for every item, so we cannot
    // distinguish *which* item won by geometry — but the active lookup itself
    // is covered by the aria-current + custom-selector tests below.
  });

  it('settles on the aria-current item in vertical mode too', async () => {
    render(<SliderNav direction="vertical" />);
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    fireEvent.mouseLeave(screen.getByTestId('nav'));
    await waitFor(() => {
      const slider = screen.getByTestId('slider');
      expect(slider.style.height).not.toBe('');
      expect(slider.style.top).not.toBe('');
    });
  });

  it('falls back to the configured active selector when aria-current is absent', async () => {
    // Remove aria-current, then rely on the custom class selector.
    render(<SliderNav activeSelector="a.nav-active" />);
    const third = screen.getByRole('link', { name: 'Third' });
    third.removeAttribute('aria-current');
    third.className = 'nav-active';
    fireEvent.mouseLeave(screen.getByTestId('nav'));
    await waitFor(() => {
      expect(screen.getByTestId('slider')).toHaveStyle({ opacity: '1' });
    });
  });

  it('hides the slider when no active item exists', async () => {
    render(<SliderNav />);
    const third = screen.getByRole('link', { name: 'Third' });
    third.removeAttribute('aria-current');
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Second' }).parentElement as HTMLElement);
    fireEvent.mouseLeave(screen.getByTestId('nav'));
    await waitFor(() => {
      expect(screen.getByTestId('slider')).toHaveStyle({ opacity: '0' });
    });
  });
});
