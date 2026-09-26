import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionMenu, Button, Dialog } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import { Profile, ProfileUpdateConfirmation } from './types';
import { profileCropToPng } from './profileImage';
import { useProfileImageCrop } from './useProfileImageCrop';
import ProfileSyncGateDialog, { PendingSync } from './ProfileSyncGateDialog';
import ProfileFieldsForm, { Fields } from './ProfileFieldsForm';
import ConfirmationModal from '../shared/ConfirmationModal';
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

export default function AuthorProfiles({ onChanged }: { onChanged?: () => void }) {
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
  const listRequest = useRef(0);
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;
  const {
    image, imageLoading, removeImage, zoom, x, y, canvas,
    setZoom, setX, setY, reset: resetImage, choose: chooseImage, requestRemoval,
  } = useProfileImageCrop((message) => setErrorRef.current(message));

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
    resetImage();
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
      setError(profileErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  function applySavedProfile(data: Profile) {
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

  return (
    <section className={styles.root} aria-label="Author profiles">
      <div className={styles.heading}>
        <Button disabled={saving || imageLoading} onClick={() => edit('new')}>
          New author profile
        </Button>
      </div>
      {loading && <p role="status">Loading author profiles…</p>}
      {listError && (
        <div role="alert">
          {listError}{' '}
          <Button variant="secondary" onClick={() => void load()}>
            Retry profiles
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {/* Delete failures surface outside the edit dialog (the confirmation
          modal is closed by then), so page-level errors render here. */}
      {error && !editing && <p role="alert">{error}</p>}
      {!loading && !listError && profiles.length === 0 && (
        <p>No author profiles yet. Create a profile with or without an OJ user account.</p>
      )}
      {profiles.length > 0 && (
        <ul className={styles.profiles}>
          {profiles.map((profile) => (
            <li key={profile.id}>
              {profile.hasProfileImage ? (
                <img
                  className={styles.avatarImage}
                  src={`/api${authoringService.profileImageUrl(profile.id)}`}
                  alt=""
                />
              ) : (
                <span className={styles.avatar} aria-hidden="true">
                  {Array.from(profile.akaName.trim())[0] || '?'}
                </span>
              )}
              <div className={styles.identity} data-profile-identity>
                <strong>{profile.akaName}</strong>
                <span className={styles.hint}>
                  {profile.realName} · {profile.defaultLanguage} · {profile.countryCode}
                </span>
                <span className={styles.hint}>
                  {profile.hasProfileImage ? 'Profile image saved' : 'Fallback avatar'} ·{' '}
                  {profile.userId === null ? 'No linked user' : `User #${profile.userId}`}
                </span>
              </div>
              <ActionMenu
                label={`Row actions for ${profile.akaName}`}
                items={[
                  {
                    key: 'edit',
                    label: 'Edit',
                    disabled: saving || imageLoading,
                    onClick: () => edit(profile),
                  },
                  {
                    key: 'delete',
                    label: 'Delete',
                    variant: 'danger',
                    disabled: saving || imageLoading,
                    onClick: () => setDeleting(profile),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <form id="author-profile-form" onSubmit={save}>
          <Dialog
            open
            title={editing === 'new' ? 'New author profile' : `Edit profile: ${editing.akaName}`}
            onClose={() => {
              if (!saving && !imageLoading && !pendingSync) {
                setEditing(null);
                setPendingSync(null);
                resetImage();
              }
            }}
            footer={
              <>
                <Button
                  form="author-profile-form"
                  type="submit"
                  disabled={imageLoading}
                  loading={saving}
                  loadingLabel="Saving profile…"
                >
                  {editing === 'new' ? 'Create profile' : 'Save profile'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving || imageLoading}
                  onClick={() => {
                    setEditing(null);
                    setPendingSync(null);
                    resetImage();
                  }}
                >
                  Cancel
                </Button>
              </>
            }
          >
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
            />
        </Dialog>
        </form>
      )}
      {editing && editing !== 'new' && pendingSync && (
        <ProfileSyncGateDialog
          pendingSync={pendingSync}
          saving={saving}
          onConfirm={() => void save()}
          onKeepEditing={() => setPendingSync(null)}
        />
      )}
      <ConfirmationModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDeleteProfile}
        title={`Delete author profile "${deleting?.akaName}"?`}
        message={
          deleting
            ? `${deleting.realName}${deleting.userId === null ? '' : ` (AKA user #${deleting.userId})`}. This action cannot be undone.`
            : ''
        }
        confirmText="Delete Author Profile"
        confirmStyle="danger"
      />
    </section>
  );
}
