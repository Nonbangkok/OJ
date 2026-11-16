import { useState } from 'react';
import { Button, Drawer, InlineError } from '../../../components/ui';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import ContestFormFields from './ContestFormFields';
import { contestPayload, newContestForm, validateContestForm, type ContestFormErrors, type ContestFormState } from './contestForm';
import styles from './Contests.module.css';

interface CreateContestDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called once the contest exists; `notice` says what still needs doing (e.g. hiding it failed). */
  onCreated: (id: number, notice?: string) => void;
}

export default function CreateContestDrawer({ open, onClose, onCreated }: CreateContestDrawerProps) {
  const [form, setForm] = useState<ContestFormState>(newContestForm);
  const [errors, setErrors] = useState<ContestFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setForm(newContestForm()); setErrors({}); }
  }

  const change = (patch: Partial<ContestFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors({});
  };

  const submit = async () => {
    const next = validateContestForm(form, { requireFuture: true });
    if (Object.keys(next).length > 0) { setErrors(next); return; }
    setBusy(true);
    try {
      const created = await adminService.createContest(contestPayload(form));
      // POST /admin/contests answers with the contest row itself.
      const id = (created as { id?: number }).id ?? created.contest?.id;
      if (id === undefined) throw new Error('The contest was created but the server did not return its id.');
      // The contest exists now: never offer to create it again. A failed hide becomes a notice on its page.
      let notice: string | undefined;
      if (!form.visible) {
        try {
          await adminService.updateContestVisibility(id, false);
        } catch {
          notice = 'Created, but it is still visible to students — hiding it failed. Turn off "Visible to students" in Settings.';
        }
      }
      onCreated(id, notice);
    } catch (err) {
      setErrors({ form: getErrorMessage(err, 'Failed to create the contest.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} title="New contest" onClose={onClose}>
      <form className={styles.drawerForm} onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <ContestFormFields form={form} errors={errors} onChange={change} />
        {errors.form && <InlineError message={errors.form} />}
        <div className={styles.drawerFooter}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} loadingLabel="Creating…">Create contest</Button>
        </div>
      </form>
    </Drawer>
  );
}
