import { useId } from 'react';

export interface GraderLogoProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name. An empty string marks the logo decorative (hidden from assistive tech). */
  title?: string;
}

/**
 * The Grader mark: three crescents, each a circle minus a "bite" circle.
 * Geometry was measured from the original logo512.png (pixel IoU 0.999).
 * The two dark crescents follow `currentColor`, so the mark adapts to the
 * theme; the third uses --logo-accent.
 */
const CRESCENTS = [
  { fill: 'currentColor', outer: [368.2, 148.2, 123.1], bite: [351.7, 272.8, 92.4] },
  { fill: 'currentColor', outer: [145.4, 314.9, 130.9], bite: [213.8, 405.4, 98.3] },
  { fill: 'var(--logo-accent)', outer: [400.4, 365.9, 101.1], bite: [466.6, 392.5, 66.6] },
] as const;

export default function GraderLogo({ size = 24, className, title = 'Grader' }: GraderLogoProps) {
  const id = useId().replace(/:/g, '');
  const decorative = title === '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <defs>
        {CRESCENTS.map(({ outer, bite }, i) => (
          <mask key={i} id={`${id}-c${i}`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
            <circle cx={outer[0]} cy={outer[1]} r={outer[2]} fill="#fff" />
            <circle cx={bite[0]} cy={bite[1]} r={bite[2]} fill="#000" />
          </mask>
        ))}
      </defs>
      {CRESCENTS.map(({ fill, outer }, i) => (
        <circle
          key={i}
          data-crescent=""
          cx={outer[0]}
          cy={outer[1]}
          r={outer[2]}
          fill={fill}
          mask={`url(#${id}-c${i})`}
        />
      ))}
    </svg>
  );
}
