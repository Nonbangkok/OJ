import { Button } from '../../../components/ui';
import styles from './AuthorProfiles.module.css';

export interface Fields {
  akaName: string;
  realName: string;
  defaultLanguage: string;
  countryCode: string;
  userId: string;
}

interface ProfileFieldsFormProps {
  saving: boolean;
  gated: boolean;
  fields: Fields;
  update: (key: keyof Fields, value: string) => void;
  image: HTMLImageElement | null;
  imageLoading: boolean;
  existingImage: boolean;
  canvas: React.MutableRefObject<HTMLCanvasElement | null>;
  zoom: number;
  x: number;
  y: number;
  setZoom: (value: number) => void;
  setX: (value: number) => void;
  setY: (value: number) => void;
  chooseImage: (file: File) => void;
  requestRemoval: () => void;
}

/** Author-details fields + profile image crop UI (extracted from AuthorProfiles). */
export default function ProfileFieldsForm({
  saving, gated, fields, update, image, imageLoading, existingImage,
  canvas, zoom, x, y, setZoom, setX, setY, chooseImage, requestRemoval,
}: ProfileFieldsFormProps) {
  return (
            <fieldset disabled={saving || gated} className={`${styles.root} ${styles.dialogFields}`}>
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
                onClick={requestRemoval}
              >
                Remove image
              </Button>
            )}
          </fieldset>
  );
}
