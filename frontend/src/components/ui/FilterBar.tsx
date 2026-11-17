import { useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, Funnel, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ActionMenu, MENU_TRIGGER_GAP, MENU_VIEWPORT_MARGIN } from './ActionMenu';
import menuStyles from './ActionMenu.module.css';
import { Drawer } from './Drawer';
import styles from './FilterBar.module.css';

type FilterOption = { value: string; label: string };

/** One value at a time: picking sets it, the chip's X clears it. */
export interface SingleFilterChip {
  key: string;
  label: string;
  multiple?: false;
  value?: string;
  options: FilterOption[];
  onChange: (value: string | null) => void;
}

/** Any number of values: a checkbox menu that stays open while ticking; an empty list is unset. */
export interface MultiFilterChip {
  key: string;
  label: string;
  multiple: true;
  values: string[];
  options: FilterOption[];
  onChange: (values: string[]) => void;
}

export type FilterChip = SingleFilterChip | MultiFilterChip;

const isActive = (chip: FilterChip): boolean => (chip.multiple === true
  ? chip.values.length > 0
  : chip.options.some((o) => o.value === chip.value));

/** Selected labels in option order; values no option names (an old link) keep their raw text. */
const selectedLabels = (chip: MultiFilterChip): string => {
  const known = chip.options.filter((o) => chip.values.includes(o.value)).map((o) => o.label);
  const unknown = chip.values.filter((v) => !chip.options.some((o) => o.value === v));
  return [...known, ...unknown].join(', ');
};

const toggled = (values: string[], value: string): string[] => (values.includes(value)
  ? values.filter((v) => v !== value)
  : [...values, value]);

function MultiChip({ chip }: { chip: MultiFilterChip }) {
  const summary = selectedLabels(chip);
  const set = chip.values.length > 0;
  return (
    <span className={styles.multi}>
      <Menu.Root modal={false}>
        <Menu.Trigger
          className={set ? styles.chipSet : styles.chipAdd}
          aria-label={set ? `Edit filter ${chip.label}: ${summary}` : `Add filter: ${chip.label}`}
        >
          {set
            ? <span className={styles.summary}>{chip.label}: <b>{summary}</b></span>
            : <><Plus size={12} aria-hidden="true" />{chip.label}</>}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className={menuStyles.positioner} side="bottom" align="start" sideOffset={MENU_TRIGGER_GAP} collisionPadding={MENU_VIEWPORT_MARGIN}>
            <Menu.Popup className={menuStyles.menu} aria-label={chip.label}>
              {chip.options.map((o) => (
                <Menu.CheckboxItem
                  key={o.value}
                  className={`${menuStyles.item} ${styles.checkItem}`}
                  label={o.label}
                  checked={chip.values.includes(o.value)}
                  closeOnClick={false}
                  onCheckedChange={() => chip.onChange(toggled(chip.values, o.value))}
                >
                  <span className={styles.checkBox} aria-hidden="true">
                    <Menu.CheckboxItemIndicator><Check size={11} weight="bold" /></Menu.CheckboxItemIndicator>
                  </span>
                  {o.label}
                </Menu.CheckboxItem>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {set && (
        <button type="button" className={styles.clear} aria-label={`Remove filter ${chip.label}: ${summary}`} onClick={() => chip.onChange([])}>
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export interface FilterBarProps {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  segments?: ReactNode;
  filters?: FilterChip[];
  resultCount?: ReactNode;
  trailing?: ReactNode;
}

function Chip({ chip }: { chip: FilterChip }) {
  if (chip.multiple === true) return <MultiChip chip={chip} />;
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
  if (chip.multiple === true) {
    return (
      <div role="group" aria-label={chip.label} className={styles.sheetOptions}>
        {chip.options.map((o) => {
          const on = chip.values.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} className={on ? styles.chipSet : styles.chipAdd} onClick={() => chip.onChange(toggled(chip.values, o.value))}>{o.label}</button>
          );
        })}
      </div>
    );
  }
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
  const activeCount = filters.filter(isActive).length;

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
