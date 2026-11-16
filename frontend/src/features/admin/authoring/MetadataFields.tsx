import { useState } from 'react';
import { Field } from '../../../components/ui';
import { DraftFields, Profile } from './types';
import { PROBLEM_CATEGORIES, PROBLEM_DIFFICULTY_OPTIONS } from '../../../utils/constants';
import { solveXp } from '../../../config/progression';
import styles from './Metadata.module.css';

type Key = keyof DraftFields;

/** Inline checks shown under a field once it has been edited (the server still validates). */
const fieldError = (key: Key, value: DraftFields): string | undefined => {
  switch (key) {
    case 'problemId': return value.problemId.trim() ? undefined : 'Problem ID is required.';
    case 'title': return value.title.trim() ? undefined : 'Title is required.';
    case 'authorAkaName': return value.authorAkaName.trim() ? undefined : 'AKA name is required.';
    case 'authorRealName': return value.authorRealName.trim() ? undefined : 'Real name is required.';
    case 'countryCode': return /^[A-Z]{3}$/.test(value.countryCode) ? undefined : 'Three letters, e.g. THA.';
    case 'timeLimitMs':
      if (!(value.timeLimitMs >= 1)) return 'At least 1 ms.';
      return value.timeLimitMs > 900000 ? 'At most 900000 ms.' : undefined;
    case 'memoryLimitMb':
      if (!(value.memoryLimitMb >= 1)) return 'At least 1 MB.';
      return value.memoryLimitMb > 736 ? 'At most 736 MB.' : undefined;
    default: return undefined;
  }
};

/** Problem metadata (§7.9): two columns, units on the limits, inline errors, categories as toggle chips. */
export default function MetadataFields({ value, profiles, onEdit, disabled = false, problemIdLocked = false }: {
  value: DraftFields; profiles: Profile[]; disabled?: boolean; problemIdLocked?: boolean;
  onEdit: <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => void;
}) {
  const [touched, setTouched] = useState<Set<Key>>(() => new Set());
  const edit = <K extends Key>(key: K, next: DraftFields[K]) => {
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    onEdit(key, next);
  };
  const error = (key: Key) => (touched.has(key) ? fieldError(key, value) : undefined);
  const text = (key: 'problemId' | 'title' | 'authorAkaName' | 'authorRealName' | 'language', label: string, max: number, extra: { hint?: string; locked?: boolean } = {}) => (
    <Field label={label} hint={extra.hint} error={error(key)}>
      {(props) => (
        <input {...props} className={styles.input} maxLength={max} disabled={disabled || extra.locked}
          value={value[key]} onChange={(e) => edit(key, e.target.value)} />
      )}
    </Field>
  );
  const limit = (key: 'timeLimitMs' | 'memoryLimitMb', label: string, unit: string, max: number) => (
    <Field label={label} error={error(key)}>
      {(props) => (
        <div className={styles.unit} data-invalid={props['aria-invalid'] ? 'true' : undefined}>
          <input {...props} type="number" min={1} max={max} className={`${styles.input} ${styles.mono}`} disabled={disabled}
            value={value[key] || ''} onChange={(e) => edit(key, Number(e.target.value))} />
          <em aria-hidden="true">{unit}</em>
        </div>
      )}
    </Field>
  );

  return (
    <fieldset className={styles.metadata} disabled={disabled}>
      <legend className={styles.legend}>Problem metadata</legend>
      <div className={styles.grid}>
        {text('problemId', 'Problem ID', 50, { hint: 'Locked after the first publish.', locked: problemIdLocked })}
        {text('title', 'Title', 255)}
        <Field label="Author profile">
          {(props) => (
            <select {...props} className={styles.input} value={value.authorProfileId || ''} onChange={(e) => {
              const profile = profiles.find((p) => p.id === e.target.value);
              edit('authorProfileId', profile?.id || null);
              if (profile) {
                onEdit('authorAkaName', profile.akaName); onEdit('authorRealName', profile.realName);
                onEdit('language', profile.defaultLanguage); onEdit('countryCode', profile.countryCode);
              }
            }}>
              <option value="">Manual author / fallback avatar</option>
              {value.authorProfileId && !profiles.some((p) => p.id === value.authorProfileId) && <option value={value.authorProfileId}>Linked profile</option>}
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.akaName} — {p.realName}</option>)}
            </select>
          )}
        </Field>
        <Field label="Difficulty" hint={`800–3500 · a first solve gives +${solveXp(value.difficulty)} XP`}>
          {(props) => (
            <select {...props} className={styles.input} value={value.difficulty ?? ''}
              onChange={(e) => edit('difficulty', e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Unrated</option>
              {PROBLEM_DIFFICULTY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
        </Field>
        {text('authorAkaName', 'AKA name', 100)}
        {text('authorRealName', 'Real name', 255)}
        {text('language', 'Language', 50)}
        <Field label="Country code" error={error('countryCode')}>
          {(props) => (
            <input {...props} className={`${styles.input} ${styles.mono}`} maxLength={3} disabled={disabled}
              value={value.countryCode} onChange={(e) => edit('countryCode', e.target.value.toUpperCase())} />
          )}
        </Field>
        {limit('timeLimitMs', 'Time limit', 'ms', 900000)}
        {limit('memoryLimitMb', 'Memory limit', 'MB', 736)}
      </div>
      <div className={styles.chipsField}>
        <span className={styles.groupLabel} id="draft-categories-label">Categories</span>
        <div className={styles.chips} role="group" aria-labelledby="draft-categories-label">
          {PROBLEM_CATEGORIES.map((category) => {
            const on = value.categories.includes(category);
            return (
              <button key={category} type="button" className={styles.chip} aria-pressed={on} disabled={disabled}
                onClick={() => edit('categories', on ? value.categories.filter((c) => c !== category) : [...value.categories, category].sort())}>
                {category}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
