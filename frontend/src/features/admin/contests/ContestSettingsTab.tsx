import { useEffect, useState } from 'react';
import { Button, InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import type { Contest } from '../../../types';
import ContestFormFields from './ContestFormFields';
import { contestPayload, formFromContest, validateContestForm, windowOf, type ContestFormErrors, type ContestFormState } from './contestForm';
import formStyles from './Contests.module.css';
import styles from './ContestEditor.module.css';

const SAVED_MS = 3000;

/** Settings tab: the create drawer's fields for an existing contest. */
export default function ContestSettingsTab({ contest, onSaved }: { contest: Contest; onSaved: (next: Partial<Contest>) => void }) {
  const [form, setForm] = useState<ContestFormState>(() => formFromContest(contest));
  const [errors, setErrors] = useState<ContestFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (savedAt === null) return undefined;
    const timer = setTimeout(() => setSavedAt(null), SAVED_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const change = (patch: Partial<ContestFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors({});
  };

  const save = async () => {
    // A new start for a scheduled contest must be in the future; an unchanged start (or a running round's) may be past.
    const startChanged = windowOf(form).startMs !== Date.parse(contest.start_time);
    const next = validateContestForm(form, { requireFuture: contest.status === 'scheduled' && startChanged });
    if (Object.keys(next).length > 0) { setErrors(next); return; }
    setBusy(true);
    try {
      const body = contestPayload(form);
      await adminService.updateContest(contest.id, body);
      if (form.visible !== Boolean(contest.is_visible)) await adminService.updateContestVisibility(contest.id, form.visible);
      onSaved({ title: body.title, description: body.description || null, start_time: body.startTime, end_time: body.endTime, is_visible: form.visible });
      setSavedAt(Date.now());
    } catch (err) {
      setErrors({ form: getErrorMessage(err, 'Failed to save the contest.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`${styles.panel} ${formStyles.drawerForm}`} onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <ContestFormFields form={form} errors={errors} onChange={change} />
      {errors.form && <InlineError message={errors.form} />}
      <div className={formStyles.drawerFooter}>
        {savedAt !== null && <span className={styles.saved} role="status">Saved</span>}
        <Button type="submit" loading={busy} loadingLabel="Saving…">Save</Button>
      </div>
    </form>
  );
}
