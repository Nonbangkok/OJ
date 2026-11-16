import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ConfirmDialog, DataTable, Drawer, InlineError, type DataTableColumn } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import { Profile, ProfileUpdateConfirmation } from './types';
import { profileCropToPng } from './profileImage';
import { useProfileImageCrop } from './useProfileImageCrop';
import ProfileSyncGateDialog, { PendingSync } from './ProfileSyncGateDialog';
import ProfileFieldsForm, { Fields } from './ProfileFieldsForm';
import ProfileSyncRuns from './ProfileSyncRuns';
import type { LinkedUser } from './UserLinkPicker';
import styles from './AuthorProfiles.module.css';

const emptyFields: Fields = {
  akaName: '',
  realName: '',
  defaultLanguage: 'Thai',
  countryCode: 'THA',
  userId: '',
};
const profileErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Unable to save or load author profiles. Please try again.');

const isConfirmation = (
  result: Profile | ProfileUpdateConfirmation
): result is ProfileUpdateConfirmation =>
  (result as ProfileUpdateConfirmation).confirmationRequired === true;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const errorCode = (error: unknown) => (error as { response?: { data?: { code?: string } } })?.response?.data?.code;

/**
 * Author profiles (§7.9): a table, edits in a right Drawer, an account picked
 * by username (B8), and the recent profile syncs. `wrap` lets the page put
 * the "New author profile" primary in the Authoring hub header.
 */
export default function AuthorProfiles({ onChanged, wrap }: {
  onChanged?: () => void;
  wrap?: (actions: ReactNode, body: ReactNode) => ReactNode;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingSync, setPendingSync] = useState<PendingSync | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [linked, setLinked] = useState<LinkedUser | null>(null);
  const [linkError, setLinkError] = useState('');
  const listRequest = useRef(0);
  const {
    image, imageLoading, removeImage, zoom, x, y, canvas,
    setZoom, setX, setY, reset: resetImage, choose: chooseImage, requestRemoval,
  } = useProfileImageCrop((message) => setError(message));

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setListError('');
    try {
      const data = await authoringService.listProfiles();
      if (request === listRequest.current) setProfiles(data);
    } catch (failure) {
      if (request === listRequest.current) setListError(profileErrorMessage(failure));
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch; load()'s leading setLoading(true)/setListError('') are no-ops against the initial state
    void load();
    return () => {
      listRequest.current += 1;
    };
  }, [load]);
  function edit(profile: Profile | 'new') {
    setEditing(profile);
    setError('');
    setNotice('');
    setPendingSync(null);
    setLinkError('');
    resetImage();
    setLinked(profile === 'new' || profile.userId === null ? null : { id: profile.userId, username: profile.linkedUsername ?? `User #${profile.userId}` });
    setFields(
      profile === 'new'
        ? emptyFields
        : {
            akaName: profile.akaName,
            realName: profile.realName,
            defaultLanguage: profile.defaultLanguage,
            countryCode: profile.countryCode,
            userId: profile.userId === null ? '' : String(profile.userId),
          }
    );
  }
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (!editing || saving || imageLoading) return;
    setError('');
    if (!fields.akaName.trim() || !fields.realName.trim() || !fields.defaultLanguage.trim()) {
      setError('AKA name, real name, and default language are required.');
      return;
    }
    if (
      fields.userId &&
      (!/^\d+$/.test(fields.userId) ||
        !Number.isSafeInteger(Number(fields.userId)) ||
        Number(fields.userId) <= 0)
    ) {
      setError('User account ID must be a positive whole number.');
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      Object.entries(fields).forEach(([key, value]) => body.append(key, value.trim()));
      if (image)
        body.append('profileImage', await profileCropToPng(image, zoom, x, y), 'profile.png');
      else if (editing !== 'new' && removeImage) body.append('removeProfileImage', 'true');
      // New profiles have nothing to cascade; existing ones go through the
      // confirmation gate — the first submit reports impact, the confirmed
      // resubmit saves and starts the cascade.
      if (editing === 'new') {
        applySavedProfile(await authoringService.createProfile(body));
      } else if (pendingSync) {
        const confirmedResult = await authoringService.updateProfileWithGate(editing.id, body, true);
        if (isConfirmation(confirmedResult)) {
          // The server re-reported impact (e.g. drafts appeared since the gate
          // probe); show the fresh counts instead of saving.
          setPendingSync({
            affectedDrafts: confirmedResult.affectedDrafts,
            affectedPublishedProblems: confirmedResult.affectedPublishedProblems,
          });
          setSaving(false);
          return;
        }
        applySavedProfile(confirmedResult);
        setPendingSync(null);
        setNotice('Author profile saved. Linked drafts are syncing their PDFs — see the Jobs tab.');
      } else {
        const result = await authoringService.updateProfileWithGate(editing.id, body, false);
        if (isConfirmation(result)) {
          setPendingSync({
            affectedDrafts: result.affectedDrafts,
            affectedPublishedProblems: result.affectedPublishedProblems,
          });
          setSaving(false);
          return;
        }
        applySavedProfile(result);
      }
    } catch (failure) {
      if (errorCode(failure) === 'author_profile_user_conflict') setLinkError(profileErrorMessage(failure));
      else setError(profileErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  function applySavedProfile(saved: Profile) {
    // Saves answer without the list-only facts; keep the count and show the picked account.
    const previous = profiles.find((profile) => profile.id === saved.id);
    const data: Profile = {
      ...saved,
      draftCount: saved.draftCount ?? previous?.draftCount ?? 0,
      linkedUsername: saved.linkedUsername ?? (saved.userId === null ? null : linked?.username ?? previous?.linkedUsername ?? null),
    };
    setProfiles((current) =>
      current.some((profile) => profile.id === data.id)
        ? current.map((profile) => (profile.id === data.id ? data : profile))
        : [...current, data]
    );
    setEditing(null);
    resetImage();
    setNotice('Author profile saved.');
    onChanged?.();
  }
  function update(key: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  function link(next: LinkedUser | null) {
    setLinked(next);
    setLinkError('');
    update('userId', next ? String(next.id) : '');
  }
  async function confirmDeleteProfile() {
    if (!deleting) return;
    setError('');
    try {
      await authoringService.deleteProfile(deleting.id);
      setProfiles((current) => current.filter((profile) => profile.id !== deleting.id));
      setNotice('Author profile deleted.');
      setDeleting(null);
      onChanged?.();
    } catch (failure) {
      // 409 blocked-state: the server message says how many active drafts
      // still reference the profile and what to do about them.
      setError(getErrorMessage(failure,
        'Unable to delete the author profile. Please try again.'));
      setDeleting(null);
    }
  }
  const existingImage = editing && editing !== 'new' && editing.hasProfileImage && !removeImage;

  const closeEditor = () => {
    if (!saving && !imageLoading && !pendingSync) {
      setEditing(null);
      setPendingSync(null);
      resetImage();
    }
  };
  const busy = saving || imageLoading;

  const columns: DataTableColumn<Profile>[] = [
    {
      key: 'aka', header: 'Author', mobile: 'primary',
      cell: (profile) => (
        <span className={styles.akaCell}>
          {profile.hasProfileImage
            ? <img className={styles.avatarImage} src={`/api${authoringService.profileImageUrl(profile.id)}`} alt="" />
            : <span className={styles.avatar} aria-hidden="true">{Array.from(profile.akaName.trim())[0] || '?'}</span>}
          {profile.akaName}
        </span>
      ),
    },
    { key: 'real', header: 'Real name', mobile: 'meta', cell: (profile) => <span className={styles.hint}>{profile.realName}</span> },
    { key: 'language', header: 'Language', mobile: 'hidden', cell: (profile) => profile.defaultLanguage },
    { key: 'country', header: 'Country', mobile: 'hidden', cell: (profile) => <span className={styles.mono}>{profile.countryCode}</span> },
    {
      key: 'user', header: 'Linked user', mobile: 'hidden',
      cell: (profile) => (profile.userId === null ? <span className={styles.hint}>—</span> : (profile.linkedUsername ?? `User #${profile.userId}`)),
    },
    { key: 'drafts', header: 'Drafts', align: 'right', mobile: 'meta', cell: (profile) => <span className={styles.mono}>{profile.draftCount ?? 0}</span> },
  ];

  const actions = <Button disabled={busy} onClick={() => edit('new')}>New author profile</Button>;
  const body = (
    <section className={styles.page} aria-label="Author profiles">
      {listError && <InlineError message={listError} />}
      {listError && <Button variant="secondary" onClick={() => void load()}>Retry profiles</Button>}
      {notice && <p role="status" className={styles.hint}>{notice}</p>}
      {/* Delete failures surface here (the confirm is closed by then). */}
      {error && !editing && <p role="alert">{error}</p>}
      <DataTable<Profile>
        caption="Author profiles"
        columns={columns}
        rows={profiles}
        rowKey={(profile) => profile.id}
        rowLabel={(profile) => profile.akaName}
        onRowClick={(profile) => { if (!busy) edit(profile); }}
        rowActions={(profile) => [
          { key: 'edit', label: 'Edit', disabled: busy, onClick: () => edit(profile) },
          { key: 'delete', label: 'Delete', variant: 'danger' as const, disabled: busy, onClick: () => setDeleting(profile) },
        ]}
        loading={loading && !listError}
        empty={<p className={styles.hint}>No author profiles yet. Create one with or without an OJ account.</p>}
      />
      <ProfileSyncRuns onError={(err) => setError(profileErrorMessage(err))} />
      <Drawer open={editing !== null} title={editing === 'new' ? 'New author profile' : `Edit ${editing?.akaName ?? ''}`} onClose={closeEditor}>
        {editing !== null && (
          <form id="author-profile-form" onSubmit={save}>
            {editing !== 'new' && <p className={styles.drawerMeta}>{`Used by ${plural(editing.draftCount ?? 0, 'draft')}`}</p>}
            {error && <p role="alert">{error}</p>}
            <ProfileFieldsForm
              saving={saving}
              gated={!!pendingSync}
              fields={fields}
              update={update}
              image={image}
              imageLoading={imageLoading}
              existingImage={Boolean(existingImage)}
              canvas={canvas}
              zoom={zoom}
              x={x}
              y={y}
              setZoom={setZoom}
              setX={setX}
              setY={setY}
              chooseImage={(file) => void chooseImage(file)}
              requestRemoval={requestRemoval}
              linked={linked}
              onLink={link}
              currentProfileId={editing === 'new' ? undefined : editing.id}
              linkError={linkError}
            />
            <div className={styles.drawerFoot}>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => { setEditing(null); setPendingSync(null); resetImage(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={imageLoading} loading={saving} loadingLabel="Saving profile…">
                {editing === 'new' ? 'Create profile' : 'Save profile'}
              </Button>
            </div>
          </form>
        )}
      </Drawer>
      {editing && editing !== 'new' && pendingSync && (
        <ProfileSyncGateDialog
          pendingSync={pendingSync}
          saving={saving}
          onConfirm={() => void save()}
          onKeepEditing={() => setPendingSync(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        tier="destructive"
        title={`Delete ${deleting?.akaName ?? ''}?`}
        body={deleting ? `${deleting.realName} · used by ${plural(deleting.draftCount ?? 0, 'draft')}. This can't be undone.` : ''}
        confirmLabel="Delete profile"
        onConfirm={() => { void confirmDeleteProfile(); }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );

  return <>{wrap ? wrap(actions, body) : <>{<div className={styles.toolbar}>{actions}</div>}{body}</>}</>;
}
