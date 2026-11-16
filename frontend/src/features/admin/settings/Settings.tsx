import { useEffect, useState } from 'react';
import { Check, DownloadSimple } from '@phosphor-icons/react';
import {
  Button, ConfirmDialog, Dialog, FileDrop, InlineError, InlineNotice, PageHeader, SegmentedControl, SettingsRow,
} from '../../../components/ui';
import useAdminSettings from '../../../hooks/admin/useAdminSettings';
import contestService from '../../../services/contestService';
import styles from './Settings.module.css';

const IMPORT_PHRASE = 'IMPORT';

/** Settings (§7.8): two flat lists of rows — Access and Data — with a Danger zone. */
const Settings = () => {
  const s = useAdminSettings();
  const [runningContest, setRunningContest] = useState<string | null>(null);
  const [confirmPrivate, setConfirmPrivate] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    let cancelled = false;
    contestService.getAll()
      .then((contests) => { if (!cancelled) setRunningContest(contests.find((c) => c.status === 'running')?.title ?? null); })
      .catch(() => { /* the warning is a courtesy */ });
    return () => { cancelled = true; };
  }, []);

  const saved = Boolean(s.registrationSuccess || s.passwordChangeSuccess || s.accessModeSuccess);
  const error = s.registrationError || s.passwordChangeError || s.accessModeError;

  const switchControl = (label: string, checked: boolean, onToggle: () => void) => (
    <label className={styles.toggleSwitch}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={onToggle} />
      <span className={styles.toggleTrack} aria-hidden="true" />
    </label>
  );

  const closeReplace = () => { setReplaceOpen(false); setPhrase(''); };

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Settings"
        actions={saved ? <span role="status" className={styles.saved}><Check size={14} weight="bold" aria-hidden="true" />Saved</span> : null}
      />
      {error && <InlineError message={error} />}

      <section aria-labelledby="settings-access">
        <h2 id="settings-access" className={styles.group}>Access</h2>
        <SettingsRow
          label="Site visibility"
          help="Private: only signed-in users see anything. Public: guests can browse problems and scoreboards."
          control={(
            <SegmentedControl
              aria-label="Site visibility"
              options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }] as const}
              value={s.siteAccessMode === 'private' ? 'private' : 'public'}
              onChange={(mode) => { if (mode === 'private') setConfirmPrivate(true); else void s.handleSiteAccessModeChange('public'); }}
            />
          )}
        />
        <SettingsRow label="Registration" help="Let people create their own accounts." control={switchControl('Registration', Boolean(s.isRegistrationEnabled), s.handleRegistrationToggle)} />
        <SettingsRow label="Password changes" help="Let students and staff change their own password. Admins always can." control={switchControl('Password changes', Boolean(s.isPasswordChangeEnabled), s.handlePasswordChangeToggle)} />
      </section>

      <section aria-labelledby="settings-data">
        <h2 id="settings-data" className={styles.group}>Data</h2>
        <SettingsRow
          label="Export database"
          help="A full dump to keep or move to another server."
          control={<Button variant="secondary" onClick={s.handleExportDatabase} loading={s.isExporting} loadingLabel="Exporting…"><DownloadSimple size={14} aria-hidden="true" />Export</Button>}
        />
        {s.exportError && <InlineError message={s.exportError} />}
      </section>

      <section aria-labelledby="settings-danger" className={styles.danger}>
        <h2 id="settings-danger" className={styles.group}>Danger zone</h2>
        <SettingsRow
          danger
          label="Replace database"
          help="Overwrites every user, problem and submission with an uploaded dump. The site is offline while it runs."
          control={<Button variant="secondary" className={styles.dangerButton} onClick={() => setReplaceOpen(true)}>Replace database…</Button>}
        />
      </section>

      <ConfirmDialog
        open={confirmPrivate}
        tier="plain"
        title="Make the site private?"
        body={runningContest
          ? `${runningContest} is running — guests following it lose access. Signed-out visitors will only see the login page.`
          : 'Signed-out visitors will only see the login page.'}
        confirmLabel="Make private"
        onConfirm={() => { setConfirmPrivate(false); void s.handleSiteAccessModeChange('private'); }}
        onCancel={() => setConfirmPrivate(false)}
      />

      <Dialog open={replaceOpen} title="Replace database" onClose={closeReplace}>
        <p className={styles.help}>Every user, problem and submission is replaced by the uploaded dump. This cannot be undone.</p>
        <FileDrop
          label="Drop a database dump"
          hint=".sql, .dump or .tar"
          accept={['.sql', '.dump', '.tar']}
          onFiles={(files) => s.selectDatabaseFile(files[0] ?? null)}
        />
        {s.databaseFile && <p className={styles.help}>Selected: <strong>{s.databaseFile.name}</strong></p>}
        {s.databaseError && <InlineError message={s.databaseError} />}
        {s.databaseSuccess && <InlineNotice tone="success" title={s.databaseSuccess} />}
        <label className={styles.phrase}>
          {`Type ${IMPORT_PHRASE} to confirm`}
          <input type="text" className={styles.input} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        </label>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={closeReplace}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!s.databaseFile || phrase !== IMPORT_PHRASE || s.isImporting}
            loading={s.isImporting}
            loadingLabel="Replacing…"
            onClick={() => { void s.handleImportDatabase(); }}
          >
            Replace database
          </Button>
        </div>
      </Dialog>
    </div>
  );
};

export default Settings;
