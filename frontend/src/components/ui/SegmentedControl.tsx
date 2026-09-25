import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Options rendered in order; exactly one should match `value`. */
  options: readonly SegmentedOption<T>[];
  /** Currently selected value. */
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group (rendered as aria-label). */
  'aria-label'?: string;
  className?: string;
}

/**
 * Compact segmented scope toggle (e.g. "All drafts | My drafts",
 * "All Submissions | My Submissions"). One shared container with a
 * background; the selected segment is indicated by background/contrast,
 * never by an underline. Height matches the shared 2.1rem control height
 * so it aligns with inputs and selects in grouped toolbars.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={[styles.segment, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={[
            styles.segmentBtn,
            option.value === value ? styles.active : '',
          ].filter(Boolean).join(' ')}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
