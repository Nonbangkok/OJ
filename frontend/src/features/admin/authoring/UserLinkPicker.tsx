import { useEffect, useId, useState } from 'react';
import { Button } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import type { UserCandidate } from './types';
import styles from './AuthorProfiles.module.css';

const DEBOUNCE_MS = 250;
const ROLE = { user: 'Student', staff: 'Staff', admin: 'Admin' } as const;

export interface LinkedUser { id: number; username: string }

/** B8: link an author profile to an account by searching usernames. */
export default function UserLinkPicker({ value, onChange, currentProfileId, error, disabled = false }: {
  value: LinkedUser | null;
  onChange: (next: LinkedUser | null) => void;
  currentProfileId?: string;
  error?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserCandidate[]>([]);
  const inputId = useId();
  const listId = useId();
  const term = query.trim();

  useEffect(() => {
    if (!term || value) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      authoringService.searchUserCandidates(term)
        .then((list) => { if (!cancelled) setResults(list); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, value]);

  const takenBy = (c: UserCandidate) => (c.linkedProfile && c.linkedProfile.id !== currentProfileId ? c.linkedProfile.akaName : null);
  const visible = term ? results : [];
  const pick = (c: UserCandidate) => { onChange({ id: c.id, username: c.username }); setQuery(''); setResults([]); };

  return (
    <div className={styles.picker} data-field="linked-user">
      <label htmlFor={inputId} className={styles.pickerLabel}>Linked user</label>
      {value ? (
        <div className={styles.linked}>
          <span className={styles.linkedName}>{value.username}</span>
          <Button size="compact" variant="secondary" disabled={disabled} onClick={() => { onChange(null); setQuery(''); }}>Unlink</Button>
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="search"
            role="combobox"
            aria-expanded={visible.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            className={styles.pickerInput}
            placeholder="Search usernames"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // The picker sits inside the profile form: Enter picks the first free match, never submits.
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const first = visible.find((c) => !takenBy(c));
              if (first) pick(first);
            }}
          />
          {visible.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Matching accounts" className={styles.options}>
              {visible.map((c) => {
                const taken = takenBy(c);
                return (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected={false}
                    aria-disabled={taken ? true : undefined}
                    tabIndex={taken ? -1 : 0}
                    className={taken ? styles.optionTaken : styles.option}
                    onClick={() => { if (!taken) pick(c); }}
                    onKeyDown={(e) => { if (!taken && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(c); } }}
                  >
                    <span className={styles.linkedName}>{c.username}</span>
                    <span className={styles.hint}>{ROLE[c.role] ?? c.role}{taken ? ` · already linked to ${taken}` : ''}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : <small className={styles.hint}>Optional. One profile per account.</small>}
    </div>
  );
}
