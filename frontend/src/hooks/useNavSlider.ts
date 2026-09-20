import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { SliderStyle } from '../types';

/**
 * Shared hover-follow slider for navigation bars: a gray pill that slides to
 * whichever link is hovered and settles back on the active one on mouse leave
 * (the effect used by the main navbar, contest navbar, admin navbar and the
 * authoring left nav).
 *
 * The slider element must be rendered as the first child of the nav container
 * this hook's ref is attached to.
 *
 * `direction` picks the measured axis:
 * - `horizontal` — top navbars; the pill tracks width/left of each item.
 * - `vertical` — left nav bars; the pill tracks height/top of each item.
 */

export type NavSliderDirection = 'horizontal' | 'vertical';

interface NavSliderMeasurement {
  offsetSize: number;
  offsetPosition: number;
}

export interface UseNavSliderResult<T extends HTMLElement> {
  navRef: RefObject<T | null>;
  sliderStyle: SliderStyle;
  handleItemMouseEnter: (e: { currentTarget: HTMLElement }) => void;
  resetSlider: () => void;
}

function measureItem(el: HTMLElement, direction: NavSliderDirection): NavSliderMeasurement {
  if (direction === 'vertical') {
    return { offsetSize: el.offsetHeight, offsetPosition: el.offsetTop };
  }
  return { offsetSize: el.offsetWidth, offsetPosition: el.offsetLeft };
}

/** Walks up to the element positioned against the nav container (the `li` in
 *  top navbars) so offsetLeft/offsetWidth are measured in nav coordinates —
 *  measuring the `a` itself would yield its position inside the `li`. */
function measurableAncestor(el: HTMLElement, nav: HTMLElement | null): HTMLElement {
  if (!nav) return el;
  let current: HTMLElement | null = el;
  while (current && current.offsetParent !== nav && current !== nav) {
    current = current.parentElement;
  }
  return current ?? el;
}

/** Finds the active item: NavLink marks the current route with
 *  `aria-current="page"` (always) and/or an `active` class (only when the
 *  consumer doesn't take over `className`), so both are checked. */
function findActiveItem(nav: HTMLElement | null, activeSelector: string): HTMLElement | null {
  if (!nav) return null;
  try {
    return (
      nav.querySelector<HTMLElement>('[aria-current="page"]') ??
      nav.querySelector<HTMLElement>(activeSelector)
    );
  } catch {
    return null;
  }
}

/** Grows the pill `padding` px beyond the item on both sides of the measured axis. */
function withPadding(m: NavSliderMeasurement, padding: number): NavSliderMeasurement {
  return { offsetSize: m.offsetSize + padding * 2, offsetPosition: m.offsetPosition - padding };
}

export function useNavSlider<T extends HTMLElement = HTMLElement>(
  direction: NavSliderDirection,
  options?: {
    /** Extra padding around the hovered item, in px. Horizontal only. */
    itemPadding?: number;
    /** Extra vertical offset applied to the pill. Vertical only. */
    topOffset?: number;
    /** Selector matching the active item, e.g. 'a.active' or '.active'. Defaults to 'a.active'. */
    activeSelector?: string;
    /** Re-measures when this key changes (e.g. [location.pathname, user]) —
     *  the active item moves as routes or role-gated links change. */
    recalcKey?: unknown;
  }
): UseNavSliderResult<T> {
  const { itemPadding = 10, topOffset = 0, activeSelector = 'a.active', recalcKey } = options ?? {};
  const navRef = useRef<T | null>(null);
  const [sliderStyle, setSliderStyle] = useState<SliderStyle>({ opacity: 0 });

  const trackItem = useCallback(
    (el: HTMLElement) => {
      // Hover handlers sit on the `li` (top navbars) or the `a` (left nav);
      // normalize to whichever element is positioned against the nav itself.
      const target = measurableAncestor(el, navRef.current);
      const m = withPadding(measureItem(target, direction), itemPadding);
      if (direction === 'vertical') {
        setSliderStyle({ height: m.offsetSize, top: m.offsetPosition + topOffset, opacity: 1 });
      } else {
        setSliderStyle({ width: m.offsetSize, left: m.offsetPosition, opacity: 1 });
      }
    },
    [direction, itemPadding, topOffset]
  );

  const handleItemMouseEnter = useCallback(
    (e: { currentTarget: HTMLElement }) => {
      trackItem(e.currentTarget);
    },
    [trackItem]
  );

  const resetSlider = useCallback(() => {
    const activeItem = findActiveItem(navRef.current, activeSelector);
    if (activeItem) {
      trackItem(activeItem);
    } else {
      setSliderStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  }, [activeSelector, trackItem]);

  // Measuring needs the DOM laid out; recalc whenever the consumer re-runs
  // this effect (pass its deps via `recalcKey`, e.g. [location.pathname, user]).
  useEffect(() => {
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSlider, recalcKey]);

  return { navRef, sliderStyle, handleItemMouseEnter, resetSlider };
}

/** Style object for the slider element; spread into a `style` prop alongside
 *  the inline style returned by the hook. Consumers keep their own CSS module
 *  class for colors/transition — this carries only the shared geometry. */
export const navSliderBaseStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
};
