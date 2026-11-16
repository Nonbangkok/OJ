import { useId } from 'react';
import { Field, SegmentedControl } from '../../../components/ui';
import { BANGKOK_NOTE, QUARTER_HOURS, formatBangkokEnd } from './bangkokTime';
import { DURATION_PRESETS, windowOf, type ContestFormErrors, type ContestFormState, type DurationPreset } from './contestForm';
import styles from './Contests.module.css';

interface ContestFormFieldsProps {
  form: ContestFormState;
  errors: ContestFormErrors;
  onChange: (patch: Partial<ContestFormState>) => void;
}

/** Title, description, Bangkok start, duration and visibility — shared by the create drawer and Settings. */
export default function ContestFormFields({ form, errors, onChange }: ContestFormFieldsProps) {
  const listId = useId();
  const { endMs } = windowOf(form);
  return (
    <>
      <p className={styles.note}>{BANGKOK_NOTE}</p>
      <Field label="Title" error={errors.title} required>
        {(props) => <input {...props} className={styles.input} value={form.title} onChange={(e) => onChange({ title: e.target.value })} />}
      </Field>
      <Field label="Description" hint="Optional. Shown on the contest page.">
        {(props) => <textarea {...props} rows={3} className={styles.input} value={form.description} onChange={(e) => onChange({ description: e.target.value })} />}
      </Field>
      <div className={styles.pair}>
        <Field label="Start date" error={errors.date}>
          {(props) => <input {...props} type="date" className={`${styles.input} ${styles.mono}`} value={form.date} onChange={(e) => onChange({ date: e.target.value })} />}
        </Field>
        <Field label="Start time" error={errors.time} hint="24-hour">
          {(props) => (
            <>
              <input
                {...props}
                className={`${styles.input} ${styles.mono}`}
                list={listId}
                inputMode="numeric"
                placeholder="19:00"
                value={form.time}
                onChange={(e) => onChange({ time: e.target.value })}
              />
              <datalist id={listId}>
                {QUARTER_HOURS.map((t) => <option key={t} value={t} />)}
              </datalist>
            </>
          )}
        </Field>
      </div>
      <div className={styles.fieldLike}>
        <span className={styles.groupLabel}>Duration</span>
        <SegmentedControl aria-label="Duration" options={DURATION_PRESETS} value={form.preset} onChange={(value) => onChange({ preset: value as DurationPreset })} />
        {form.preset === 'custom' && (
          <div className={styles.pair}>
            <Field label="Hours">
              {(props) => <input {...props} type="number" min={0} className={`${styles.input} ${styles.mono}`} value={form.hours} onChange={(e) => onChange({ hours: e.target.value })} />}
            </Field>
            <Field label="Minutes">
              {(props) => <input {...props} type="number" min={0} max={59} className={`${styles.input} ${styles.mono}`} value={form.minutes} onChange={(e) => onChange({ minutes: e.target.value })} />}
            </Field>
          </div>
        )}
        {errors.duration && <p className={styles.fieldError} role="alert">{errors.duration}</p>}
        <p className={styles.note} aria-live="polite">{endMs !== null ? `Ends ${formatBangkokEnd(endMs)}` : ' '}</p>
      </div>
      <label className={styles.switchRow}>
        <span className={styles.toggleSwitch}>
          <input type="checkbox" role="switch" aria-label="Visible to students" checked={form.visible} onChange={() => onChange({ visible: !form.visible })} />
          <span className={styles.toggleTrack} aria-hidden="true" />
        </span>
        <span>
          Visible to students
          <span className={styles.switchHelp}>{form.visible ? 'Listed for students.' : 'Only staff see it until you show it.'}</span>
        </span>
      </label>
    </>
  );
}
