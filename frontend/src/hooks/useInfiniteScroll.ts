import { useEffect, useRef } from 'react';

type UseInfiniteScrollOptions = {
  enabled: boolean;
  /** Change this after appending rows so a still-nearby sentinel is observed again. */
  observationKey: string | number;
  onLoadMore: () => void;
  rootMargin?: string;
};

/**
 * Observes an existing list footer and asks its owner to load/reveal another
 * batch as it approaches the viewport. The manual button remains available
 * when IntersectionObserver is unavailable or auto-loading is disabled.
 */
export const useInfiniteScroll = ({
  enabled,
  observationKey,
  onLoadMore,
  rootMargin = '400px 0px',
}: UseInfiniteScrollOptions) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const target = targetRef.current;
    if (!enabled || !target || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
      },
      { rootMargin }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, observationKey, rootMargin]);

  return targetRef;
};
