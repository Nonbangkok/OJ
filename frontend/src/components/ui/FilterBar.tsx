import { useState, type ReactNode } from 'react';
import { Funnel, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ActionMenu } from './ActionMenu';
import { Drawer } from './Drawer';
import styles from './FilterBar.module.css';

export interface FilterChip {
  key: string;
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
}

export interface FilterBarProps {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  segments?: ReactNode;
  filters?: FilterChip[];
  resultCount?: ReactNode;
  trailing?: ReactNode;
}

function Chip({ chip }: { chip: FilterChip }) {
  const current = chip.options.find((o) => o.value === chip.value);
  if (current) {
    return (
      <button type="button" className={styles.chipSet} aria-label={`Remove filter ${chip.label}: ${current.label}`} onClick={() => chip.onChange(null)}>
        <span>{chip.label}: <b>{current.label}</b></span>
        <X size={12} aria-hidden="true" />
      </button>
    );
  }
  return (
    <ActionMenu
      label={`Add filter: ${chip.label}`}
      triggerClassName={styles.chipAdd}
      triggerContent={<><Plus size={12} aria-hidden="true" />{chip.label}</>}
      items={chip.options.map((o) => ({ key: o.value, label: o.label, onClick: () => chip.onChange(o.value) }))}
    />
  );
}

/**
 * Phone sheet: unset filters list their options inline. A menu would open
 * under the drawer's backdrop and outside its focus trap.
 */
function SheetOptions({ chip }: { chip: FilterChip }) {
  if (chip.options.some((o) => o.value === chip.value)) return <Chip chip={chip} />;
  return (
    <div role="group" aria-label={chip.label} className={styles.sheetOptions}>
      {chip.options.map((o) => (
        <button key={o.value} type="button" className={styles.chipAdd} onClick={() => chip.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Search + segmented control + filter chips + result count, one row (filters collapse on phones). */
export function FilterBar({ search, segments, filters = [], resultCount, trailing }: FilterBarProps) {
  const isPhone = useMediaQuery('(max-width: 639px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeCount = filters.filter((f) => f.options.some((o) => o.value === f.value)).length;

  return (
    <div className={styles.bar}>
      {search && (
        <label className={styles.search}>
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label={search.placeholder}
            placeholder={search.placeholder}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </label>
      )}
      {segments}
      {filters.length > 0 && (isPhone ? (
        <>
          <button type="button" className={styles.chipSet} onClick={() => setSheetOpen(true)}>
            <Funnel size={14} aria-hidden="true" />{`Filters · ${activeCount}`}
          </button>
          <Drawer open={sheetOpen} title="Filters" onClose={() => setSheetOpen(false)}>
            <div className={styles.sheet}>
              {filters.map((chip) => (
                <div key={chip.key} className={styles.sheetGroup}>
                  <span className={styles.sheetLabel}>{chip.label}</span>
                  <SheetOptions chip={chip} />
                </div>
              ))}
            </div>
          </Drawer>
        </>
      ) : filters.map((chip) => <Chip key={chip.key} chip={chip} />))}
      {(resultCount || trailing) && (
        <div className={styles.trailing}>
          {resultCount && <span className={styles.count}>{resultCount}</span>}
          {trailing}
        </div>
      )}
    </div>
  );
}

export default FilterBar;
