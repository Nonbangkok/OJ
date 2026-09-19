import styles from './SortableHeader.module.css';

interface SortableHeaderProps {
  label: string;
  column: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (column: string) => void;
}

/** Table header cell that toggles sort direction when clicked. */
const SortableHeader = ({ label, column, sortBy, sortDir, onSort }: SortableHeaderProps) => {
  const active = sortBy === column;
  const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <th
      className={active ? styles.active : styles.header}
      onClick={() => onSort(column)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.button}>
        {label}{arrow}
      </button>
    </th>
  );
};

export default SortableHeader;
