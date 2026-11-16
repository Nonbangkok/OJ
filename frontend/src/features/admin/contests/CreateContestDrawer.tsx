import { useId, useState } from 'react';
import { Button, Drawer, Field, InlineError, SegmentedControl } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import {
  BANGKOK_NOTE, QUARTER_HOURS, bangkokParts, bangkokToMs, formatBangkokEnd, isValidTime,
} from './bangkokTime';
import styles from './Contests.module.css';

interface CreateContestDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new contest's id once it exists (and is hidden, if asked). */
  onCreated: (id: number) => void;
}

type Preset = '1' | '2' | '3' | '5' | 'custom';
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: '1', label: '1 h' }, { value: '2', label: '2 h' }, { value: '3', label: '3 h' }, { value: '5', label: '5 h' }, { value: 'custom', label: 'Custom' },
];
const HOUR_MS = 3_600_000;

type Errors = Partial<Record<'title' | 'date' | 'time' | 'duration' | 'form', string>>;

const defaults = () => {
  // Tomorrow, 09:00 Bangkok.
  const { date } = bangkokParts(Date.now() + 24 * HOUR_MS);
  return { title: '', description: '', date, time: '09:00', preset: '2' as Preset, hours: '2', minutes: '0', visible: true };
};

export default function CreateContestDrawer({ open, onClose, onCreated }: CreateContestDrawerProps) {
  const [form, setForm] = useState(defaults);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const listId = useId();
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setForm(defaults()); setErrors({}); }
  }

  const set = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors({});
  };

  const durationMs = form.preset === 'custom'
    ? (Number(form.hours) || 0) * HOUR_MS + (Number(form.minutes) || 0) * 60_000
    : Number(form.preset) * HOUR_MS;
  const startMs = bangkokToMs(form.date, form.time);
  const endMs = startMs !== null && durationMs > 0 ? startMs + durationMs : null;

  const submit = async () => {
    const next: Errors = {};
    if (!form.title.trim()) next.title = 'Title is required.';
    if (!isValidTime(form.time)) next.time = 'Use 24-hour time, e.g. 19:00.';
    else if (startMs === null) next.date = 'Pick a start date.';
    else if (startMs <= Date.now()) next.date = 'Start must be in the future.';
    const customOk = form.preset !== 'custom'
      || (Number.isInteger(Number(form.hours)) && Number.isInteger(Number(form.minutes)) && Number(form.hours) >= 0 && Number(form.minutes) >= 0 && Number(form.minutes) < 60);
    if (!customOk || durationMs <= 0) next.duration = 'Duration must be at least one minute (whole hours and minutes).';
    if (Object.keys(next).length > 0 || startMs === null || endMs === null) { setErrors(next); return; }

    setBusy(true);
    try {
      const created = await adminService.createContest({
        title: form.title.trim(),
        description: form.description.trim(),
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      });
      // POST /admin/contests answers with the contest row itself.
      const id = (created as { id?: number; contest?: { id: number } }).id ?? (created as { contest?: { id: number } }).contest?.id;
      if (id === undefined) throw new Error('The contest was created but the server did not return its id.');
      if (!form.visible) await adminService.updateContestVisibility(id, false);
      onCreated(id);
    } catch (err) {
      setErrors({ form: getErrorMessage(err, 'Failed to create the contest.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} title="New contest" onClose={onClose}>
      <form
        className={styles.drawerForm}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        noValidate
      >
        <p className={styles.note}>{BANGKOK_NOTE}</p>
        <Field label="Title" error={errors.title} required>
          {(props) => <input {...props} className={styles.input} value={form.title} onChange={(e) => set({ title: e.target.value })} />}
        </Field>
        <Field label="Description" hint="Optional. Shown on the contest page.">
          {(props) => <textarea {...props} rows={3} className={styles.input} value={form.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        <div className={styles.pair}>
          <Field label="Start date" error={errors.date}>
            {(props) => <input {...props} type="date" className={`${styles.input} ${styles.mono}`} value={form.date} onChange={(e) => set({ date: e.target.value })} />}
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
                  onChange={(e) => set({ time: e.target.value })}
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
          <SegmentedControl aria-label="Duration" options={PRESETS} value={form.preset} onChange={(value) => set({ preset: value as Preset })} />
          {form.preset === 'custom' && (
            <div className={styles.pair}>
              <Field label="Hours">
                {(props) => <input {...props} type="number" min={0} className={`${styles.input} ${styles.mono}`} value={form.hours} onChange={(e) => set({ hours: e.target.value })} />}
              </Field>
              <Field label="Minutes">
                {(props) => <input {...props} type="number" min={0} max={59} className={`${styles.input} ${styles.mono}`} value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} />}
              </Field>
            </div>
          )}
          {errors.duration && <p className={styles.fieldError} role="alert">{errors.duration}</p>}
          <p className={styles.note} aria-live="polite">{endMs !== null ? `Ends ${formatBangkokEnd(endMs)}` : ' '}</p>
        </div>
        <label className={styles.switchRow}>
          <span className={styles.toggleSwitch}>
            <input type="checkbox" role="switch" aria-label="Visible to students" checked={form.visible} onChange={() => set({ visible: !form.visible })} />
            <span className={styles.toggleTrack} aria-hidden="true" />
          </span>
          <span>
            Visible to students
            <span className={styles.switchHelp}>{form.visible ? 'Listed as upcoming once created.' : 'Only staff see it until you show it.'}</span>
          </span>
        </label>
        {errors.form && <InlineError message={errors.form} />}
        <div className={styles.drawerFooter}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} loadingLabel="Creating…">Create contest</Button>
        </div>
      </form>
    </Drawer>
  );
}
