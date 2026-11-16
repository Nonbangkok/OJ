import { Button, Field, InlineNotice, SegmentedControl, StatusDot } from '../../../components/ui';
import { PROBLEM_CATEGORIES, PROBLEM_DIFFICULTY_OPTIONS } from '../../../utils/constants';
import { solveXp } from '../../../config/progression';
import type { FieldErrors, ProblemEditorForm } from './problemEditorForm';
import { DEFAULT_SUBMISSION_FILENAME } from './problemEditorForm';
import styles from './ProblemEditor.module.css';

interface ProblemGeneralTabProps {
  form: ProblemEditorForm;
  errors: FieldErrors;
  onChange: (patch: Partial<ProblemEditorForm>) => void;
  authors: Array<{ id: number; username: string }>;
  collections: Array<{ id: number; name: string }>;
  typeLocked: boolean;
  submissionCount: number;
  visibility: 'visible' | 'hidden' | 'contest';
  onToggleVisibility: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ProblemGeneralTab({
  form, errors, onChange, authors, collections, typeLocked, submissionCount, visibility, onToggleVisibility,
}: ProblemGeneralTabProps) {
  const isHeader = form.problem_type === 'header';
  // The saved author may not be in the authors list (e.g. a deleted account); keep it selectable.
  const authorNames = authors.map((a) => a.username);
  const authorOptions = form.author && !authorNames.includes(form.author) ? [form.author, ...authorNames] : authorNames;

  const toggleCategory = (category: string) => {
    const next = form.categories.includes(category)
      ? form.categories.filter((c) => c !== category)
      : [...form.categories, category].sort();
    onChange({ categories: next });
  };

  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="problem-general-basics">
        <h2 id="problem-general-basics" className={styles.sectionTitle}>Basics</h2>
        <div className={styles.grid}>
          <Field label="Problem ID" error={errors.id} hint="Renaming moves its submissions and contest links with it.">
            {(props) => (
              <input {...props} className={styles.input} value={form.id} onChange={(e) => onChange({ id: e.target.value })} />
            )}
          </Field>
          <Field label="Title" error={errors.title}>
            {(props) => (
              <input {...props} className={styles.input} value={form.title} onChange={(e) => onChange({ title: e.target.value })} />
            )}
          </Field>
          <Field label="Author" error={errors.author}>
            {(props) => (
              <select {...props} className={styles.input} value={form.author} onChange={(e) => onChange({ author: e.target.value })}>
                <option value="">Select an author</option>
                {authorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Collection" error={errors.collection_id}>
            {(props) => (
              <select
                {...props}
                className={styles.input}
                value={form.collection_id ?? ''}
                onChange={(e) => onChange({ collection_id: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">No collection</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Time limit (ms)" error={errors.time_limit_ms}>
            {(props) => (
              <input {...props} type="number" min={100} className={`${styles.input} ${styles.mono}`} value={form.time_limit_ms} onChange={(e) => onChange({ time_limit_ms: e.target.value })} />
            )}
          </Field>
          <Field label="Memory limit (MB)" error={errors.memory_limit_mb}>
            {(props) => (
              <input {...props} type="number" min={1} className={`${styles.input} ${styles.mono}`} value={form.memory_limit_mb} onChange={(e) => onChange({ memory_limit_mb: e.target.value })} />
            )}
          </Field>
          <Field
            label="Difficulty"
            error={errors.difficulty}
            hint={`800–3500 · sets the XP for a first solve (+${solveXp(form.difficulty)} XP)`}
          >
            {(props) => (
              <select
                {...props}
                className={styles.input}
                value={form.difficulty ?? ''}
                onChange={(e) => onChange({ difficulty: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Unrated</option>
                {PROBLEM_DIFFICULTY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </Field>
        </div>
        <div className={styles.chipsField}>
          <span className={styles.groupLabel} id="problem-categories-label">Categories</span>
          <div className={styles.chips} role="group" aria-labelledby="problem-categories-label">
            {PROBLEM_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={styles.chip}
                aria-pressed={form.categories.includes(category)}
                onClick={() => toggleCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="problem-general-judging">
        <h2 id="problem-general-judging" className={styles.sectionTitle}>Judging</h2>
        {typeLocked && (
          <InlineNotice tone="warning" title={submissionCount > 0 ? `Type locked · ${plural(submissionCount, 'submission')}.` : 'Type locked.'}>
            The problem type and submission filename can&apos;t change once anyone has submitted.
          </InlineNotice>
        )}
        <div className={styles.grid}>
          <div className={styles.fieldLike}>
            <span className={styles.groupLabel}>Problem type</span>
            <SegmentedControl
              aria-label="Problem type"
              options={[{ value: 'standard', label: 'Standard' }, { value: 'header', label: 'Header' }]}
              value={form.problem_type}
              onChange={(value) => onChange({
                problem_type: value as ProblemEditorForm['problem_type'],
                ...(value === 'header' && !form.submission_filename.trim() ? { submission_filename: DEFAULT_SUBMISSION_FILENAME } : {}),
              })}
              disabled={typeLocked}
            />
          </div>
          {isHeader && (
            <Field label="Submission filename" error={errors.submission_filename} hint="Students submit one header with this name.">
              {(props) => (
                <input
                  {...props}
                  className={`${styles.input} ${styles.mono}`}
                  value={form.submission_filename}
                  disabled={typeLocked}
                  onChange={(e) => onChange({ submission_filename: e.target.value })}
                />
              )}
            </Field>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="problem-general-visibility">
        <h2 id="problem-general-visibility" className={styles.sectionTitle}>Visibility</h2>
        <div className={styles.visibilityRow}>
          {visibility === 'contest' ? (
            <>
              <StatusDot tone="neutral" label="In contest" />
              <span className={styles.muted}>Hidden from the problem list until the contest ends.</span>
            </>
          ) : (
            <>
              <StatusDot tone={visibility === 'visible' ? 'pass' : 'warn'} label={visibility === 'visible' ? 'Visible' : 'Hidden'} />
              <Button size="compact" variant="secondary" onClick={onToggleVisibility}>
                {visibility === 'visible' ? 'Hide' : 'Show'}
              </Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
