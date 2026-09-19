import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import { getErrorMessage } from '../../../utils/error';
import { Profile, ProfileUpdateConfirmation } from './types';
import { drawProfileCrop, loadProfileImage, profileCropToPng } from './profileImage';
import styles from './AuthorProfiles.module.css';

interface Fields {
  akaName: string;
  realName: string;
  defaultLanguage: string;
  countryCode: string;
  userId: string;
}
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

/** Pending cascade impact from the server's confirmation gate. */
interface PendingSync {
  affectedDrafts: number;
  affectedPublishedProblems: number;
}

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
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [removeImage, setRemoveImage] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRequest = useRef(0);
  const listRequest = useRef(0);

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
      imageRequest.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    try {
      drawProfileCrop(canvas.current, image, zoom, x, y);
    } catch (failure) {
      setError(profileErrorMessage(failure));
    }
  }, [image, zoom, x, y]);

  function resetImage() {
    imageRequest.current += 1;
    setImage(null);
    setImageLoading(false);
    setRemoveImage(false);
    setZoom(1);
    setX(50);
    setY(50);
  }
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
  async function chooseImage(file: File) {
    const request = ++imageRequest.current;
    setImageLoading(true);
    setError('');
    setImage(null);
    try {
      const source = await loadProfileImage(file);
      if (request !== imageRequest.current) return;
      setImage(source);
      setRemoveImage(false);
      setZoom(1);
      setX(50);
      setY(50);
    } catch (failure) {
      if (request === imageRequest.current) setError(profileErrorMessage(failure));
    } finally {
      if (request === imageRequest.current) setImageLoading(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
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
  const existingImage = editing && editing !== 'new' && editing.hasProfileImage && !removeImage;

  return (
    <section className={styles.root} aria-label="Author profiles">
      <div className={styles.heading}>
        <h3>Author profiles</h3>
        <Button disabled={saving || imageLoading} onClick={() => edit('new')}>
          New author profile
        </Button>
      </div>
      <p className={styles.hint}>
        Author-relevant changes ask for confirmation, then cascade to every linked draft and
        republish its published problems.
      </p>
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
              <Button
                variant="secondary"
                size="compact"
                disabled={saving || imageLoading}
                aria-label={`Edit ${profile.akaName}`}
                onClick={() => edit(profile)}
              >
                Edit
              </Button>
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
              if (!saving && !imageLoading) {
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
                  {editing === 'new'
                    ? 'Create profile'
                    : pendingSync
                      ? 'Save and sync linked problems'
                      : 'Save profile'}
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
            {pendingSync && (
              <div role="alertdialog" aria-label="Confirm profile sync" className={styles.syncConfirm}>
                <strong>Saving will update linked problems.</strong>
                <p>
                  This change will update {pendingSync.affectedDrafts}{' '}
                  {pendingSync.affectedDrafts === 1 ? 'draft' : 'drafts'}
                  {pendingSync.affectedPublishedProblems > 0 &&
                    ` — including ${pendingSync.affectedPublishedProblems} published ${
                      pendingSync.affectedPublishedProblems === 1 ? 'problem' : 'problems'
                    }`}{' '}
                  with the new author metadata and PDF.
                </p>
                <p>Save and sync now?</p>
              </div>
            )}
            <fieldset disabled={saving} className={`${styles.root} ${styles.dialogFields}`}>
              <legend className={styles.legend}>Author details</legend>
            <div className={styles.fields}>
              <label>
                AKA name
                <input
                  required
                  maxLength={100}
                  value={fields.akaName}
                  onChange={(e) => update('akaName', e.target.value)}
                />
              </label>
              <label>
                Real name
                <input
                  required
                  maxLength={255}
                  value={fields.realName}
                  onChange={(e) => update('realName', e.target.value)}
                />
              </label>
              <label>
                Default language
                <input
                  required
                  maxLength={50}
                  value={fields.defaultLanguage}
                  onChange={(e) => update('defaultLanguage', e.target.value)}
                />
              </label>
              <div>
                <label>
                  Country code
                  <input
                    required
                    maxLength={3}
                    minLength={3}
                    pattern="[A-Z]{3}"
                    aria-describedby="profile-country-help"
                    value={fields.countryCode}
                    onChange={(e) => update('countryCode', e.target.value.toUpperCase())}
                  />
                </label>
                <small id="profile-country-help">Three letters, for example THA or USA.</small>
              </div>
              <div>
                <label>
                  User account ID (optional)
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-describedby="profile-user-help"
                    value={fields.userId}
                    onChange={(e) => update('userId', e.target.value)}
                  />
                </label>
                <small id="profile-user-help">
                  Leave blank for an author without a linked account.
                </small>
              </div>
            </div>
            <label>
              Profile image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void chooseImage(file);
                }}
              />
            </label>
            <p className={styles.hint}>
              JPEG, PNG, or WebP, up to 10 MiB and 25 million pixels. Saved as a square 512 × 512
              PNG.
            </p>
            {imageLoading && <p role="status">Loading image…</p>}
            {image && (
              <div className={styles.crop}>
                <canvas
                  ref={canvas}
                  width={512}
                  height={512}
                  role="img"
                  aria-label="Square profile image crop preview"
                />
                <div>
                  <label>
                    Crop zoom
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={0.05}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Horizontal position
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={x}
                      onChange={(e) => setX(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Vertical position
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={y}
                      onChange={(e) => setY(Number(e.target.value))}
                    />
                  </label>
                  <p className={styles.hint}>
                    Adjust the square crop, then save the profile to apply it.
                  </p>
                </div>
              </div>
            )}
            {!image &&
              (existingImage ? (
                <p>Profile image saved. Choose a file to replace it.</p>
              ) : (
                <p>
                  Fallback avatar:{' '}
                  <span className={styles.avatar}>
                    {Array.from(fields.akaName.trim())[0] || '?'}
                  </span>{' '}
                  (first character of the AKA name).
                </p>
              ))}
            {(image || existingImage) && (
              <Button
                variant="destructive"
                disabled={imageLoading}
                onClick={() => {
                  resetImage();
                  setRemoveImage(true);
                }}
              >
                Remove image
              </Button>
            )}
          </fieldset>
        </Dialog>
        </form>
      )}
    </section>
  );
}
