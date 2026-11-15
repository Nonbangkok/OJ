import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import styles from './FileDrop.module.css';

export interface FileDropProps {
  label: string;
  hint?: string;
  /** Allowed extensions, e.g. ['.zip']. */
  accept?: string[];
  multiple?: boolean;
  maxBytes?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

/** Drop zone + picker that refuses wrong types, extra files and oversize files with a visible reason. */
export function FileDrop({ label, hint, accept, multiple = false, maxBytes, disabled = false, onFiles }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const take = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!multiple && files.length > 1) { setError('Choose one file'); return; }
    for (const f of files) {
      if (accept && accept.length > 0 && !accept.some((ext) => f.name.toLowerCase().endsWith(ext.toLowerCase()))) {
        setError(`${f.name} is not a ${accept.join(' or ')} file`);
        return;
      }
      if (maxBytes !== undefined && f.size > maxBytes) {
        setError(`${f.name} is larger than ${formatBytes(maxBytes)}`);
        return;
      }
    }
    setError('');
    onFiles(files);
  };

  const open = () => { if (!disabled) inputRef.current?.click(); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) take(e.dataTransfer.files);
  };

  return (
    <div className={styles.wrap}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        className={`${styles.zone} ${dragging ? styles.dragging : ''}`.trim()}
        onClick={open}
        onKeyDown={onKeyDown}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadSimple size={20} aria-hidden="true" />
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          <span className={styles.hint}>{hint ?? 'Drop a file here or choose one'}</span>
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept?.join(',')}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}

export default FileDrop;
