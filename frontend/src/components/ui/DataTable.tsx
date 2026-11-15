import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { InlineError } from './States';
import styles from './DataTable.module.css';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  sortable?: boolean;
  mobile?: 'primary' | 'meta' | 'hidden';
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  rowActions?: (row: T) => ActionMenuItem[];
  /** Name used for the row's checkbox and actions; defaults to the first primary cell when it is text. */
  rowLabel?: (row: T) => string;
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
  sort?: { key: string; direction: 'asc' | 'desc'; onChange: (key: string) => void };
  loading?: boolean;
  error?: { message: string; onRetry?: () => void };
  empty?: ReactNode;
  highlightKey?: string;
}

export const PHONE_TABLE_QUERY = '(max-width: 639px)';
const SKELETON_ROWS = 5;
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="menuitem"]';

function SelectAll({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label="Select all" checked={checked} onChange={onChange} className={styles.checkbox} />;
}

/** The standard table: left text, right mono numbers, row activation, ⋯ actions, two-line phone layout. */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns, rows, rowKey, caption, onRowClick, rowHref, rowActions, rowLabel, selection, sort, loading, error, empty, highlightKey,
  } = props;
  const isPhone = useMediaQuery(PHONE_TABLE_QUERY);
  const navigate = useNavigate();
  const primary = columns.find((c) => c.mobile === 'primary') ?? columns[0];

  const labelOf = (row: T): string => {
    if (rowLabel) return rowLabel(row);
    const value = primary?.cell(row);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : rowKey(row);
  };
  const activatable = Boolean(onRowClick || rowHref);
  const activate = (row: T) => {
    if (onRowClick) onRowClick(row);
    else if (rowHref) navigate(rowHref(row));
  };
  const onRowMouse = (row: T) => (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    activate(row);
  };
  const onRowKey = (row: T) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    activate(row);
  };
  const toggle = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    selection.onChange(next);
  };
  const allKeys = rows.map(rowKey);
  const selectedCount = selection ? allKeys.filter((k) => selection.selected.has(k)).length : 0;
  const toggleAll = () => selection?.onChange(selectedCount === allKeys.length ? new Set() : new Set(allKeys));
  const actionsFor = (row: T) => {
    const items = rowActions?.(row) ?? [];
    return [...items.filter((i) => i.variant !== 'danger'), ...items.filter((i) => i.variant === 'danger')];
  };
  const cellContent = (col: DataTableColumn<T>, row: T) => {
    const content = col.cell(row);
    if (rowHref && col === primary) return <Link to={rowHref(row)} className={styles.primaryLink}>{content}</Link>;
    return content;
  };

  if (error && rows.length === 0) return <InlineError message={error.message} onRetry={error.onRetry} />;

  if (isPhone) {
    return (
      <ul aria-label={caption} className={styles.list}>
        {loading && rows.length === 0 && [...Array(SKELETON_ROWS)].map((_, i) => <li key={i} data-testid="skeleton-row" className={styles.skeletonItem} />)}
        {!loading && rows.length === 0 && empty && <li className={styles.emptyItem}>{empty}</li>}
        {rows.map((row) => {
          const key = rowKey(row);
          const metas = columns.filter((c) => c.mobile === 'meta');
          return (
            <li key={key} className={`${styles.item} ${key === highlightKey ? styles.highlight : ''}`.trim()}>
              {selection && (
                <input type="checkbox" aria-label={`Select ${labelOf(row)}`} checked={selection.selected.has(key)} onChange={() => toggle(key)} className={styles.checkbox} />
              )}
              {(() => {
                const text = (
                  <>
                    <span className={styles.itemPrimary}>
                      {columns.filter((c) => c.mobile === 'primary').map((c) => <span key={c.key}>{rowHref ? c.cell(row) : cellContent(c, row)}</span>)}
                    </span>
                    {metas.length > 0 && (
                      <span className={styles.itemMeta}>
                        {metas.map((c, i) => <span key={c.key}>{i > 0 && ' · '}{c.cell(row)}</span>)}
                      </span>
                    )}
                  </>
                );
                // On phones the whole text block is the control: a link for rowHref, a button for onRowClick.
                if (rowHref) return <Link to={rowHref(row)} className={styles.itemText}>{text}</Link>;
                if (onRowClick) return <button type="button" className={styles.itemText} onClick={() => onRowClick(row)}>{text}</button>;
                return <div className={styles.itemText}>{text}</div>;
              })()}
              {rowActions && <ActionMenu label={`Actions for ${key}`} items={actionsFor(row)} />}
            </li>
          );
        })}
      </ul>
    );
  }

  const colSpan = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  return (
    <div className={styles.wrap}>
      {error && <InlineError message={error.message} onRetry={error.onRetry} />}
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {selection && (
              <th className={styles.selectCell}>
                <SelectAll checked={rows.length > 0 && selectedCount === rows.length} indeterminate={selectedCount > 0 && selectedCount < rows.length} onChange={toggleAll} />
              </th>
            )}
            {columns.map((col) => {
              const sorted = sort?.key === col.key;
              const ariaSort = sorted ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined;
              return (
                <th key={col.key} data-align={col.align ?? 'left'} style={col.width ? { width: col.width } : undefined} aria-sort={ariaSort}>
                  {col.sortable && sort ? (
                    <button type="button" className={styles.sortButton} onClick={() => sort.onChange(col.key)}>
                      {col.header}
                      {sorted && (sort.direction === 'asc' ? <CaretUp size={12} aria-hidden="true" /> : <CaretDown size={12} aria-hidden="true" />)}
                    </button>
                  ) : col.header}
                </th>
              );
            })}
            {rowActions && <th className={styles.actionsCell}><span className={styles.caption}>Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && [...Array(SKELETON_ROWS)].map((_, i) => (
            <tr key={i} data-testid="skeleton-row" aria-hidden="true"><td colSpan={colSpan}><span className={styles.skeleton} /></td></tr>
          ))}
          {!loading && rows.length === 0 && empty && (
            <tr><td colSpan={colSpan} className={styles.emptyCell}>{empty}</td></tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={`${activatable ? styles.activatable : ''} ${key === highlightKey ? styles.highlight : ''}`.trim() || undefined}
                tabIndex={activatable ? 0 : undefined}
                onClick={activatable ? onRowMouse(row) : undefined}
                onKeyDown={activatable ? onRowKey(row) : undefined}
              >
                {selection && (
                  <td className={styles.selectCell}>
                    <input type="checkbox" aria-label={`Select ${labelOf(row)}`} checked={selection.selected.has(key)} onChange={() => toggle(key)} className={styles.checkbox} />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} data-align={col.align ?? 'left'}>{cellContent(col, row)}</td>
                ))}
                {rowActions && (
                  <td className={styles.actionsCell}><ActionMenu label={`Actions for ${key}`} items={actionsFor(row)} /></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
