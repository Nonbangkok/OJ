import { useId, useState } from 'react';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import type { ProblemFileRole, ProblemFilesResponse } from '../../../types';
import formStyles from '../../../components/styles/Form.module.css';
import styles from './ProblemFilesSection.module.css';

interface ProblemFilesSectionProps {
  problemId: string;
  files: ProblemFilesResponse['files'];
  /** Re-fetches the file listing after a successful replace. */
  onChanged: () => Promise<unknown>;
  disabled?: boolean;
}

const ROLES: Array<{ role: ProblemFileRole; label: string }> = [
  { role: 'grader', label: 'Grader files (ZIP)' },
  { role: 'starter', label: 'Starter files (ZIP)' },
];

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Grader (secret, compiled with the submission) and starter (student
 * download) file sets of a saved header problem. Picking a ZIP replaces the
 * role's whole set immediately.
 */
const ProblemFilesSection = ({ problemId, files, onChanged, disabled = false }: ProblemFilesSectionProps) => {
  const idPrefix = useId();
  const [busyRole, setBusyRole] = useState<ProblemFileRole | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProblemFileRole, string>>>({});

  const setError = (role: ProblemFileRole, message: string | undefined) =>
    setErrors(prev => ({ ...prev, [role]: message }));

  const handleUpload = async (role: ProblemFileRole, input: HTMLInputElement) => {
    const zip = input.files?.[0];
    if (!zip) return;
    setBusyRole(role);
    setError(role, undefined);
    try {
      await adminService.replaceProblemFiles(problemId, role, zip);
      await onChanged();
    } catch (err) {
      setError(role, getErrorMessage(err, 'Failed to upload files.'));
    } finally {
      setBusyRole(null);
      input.value = '';
    }
  };

  const handleDownload = async (role: ProblemFileRole, filename: string) => {
    setError(role, undefined);
    try {
      saveBlob(await adminService.downloadProblemFile(problemId, role, filename), filename);
    } catch (err) {
      setError(role, getErrorMessage(err, 'Failed to download file.'));
    }
  };

  return (
    <div className={styles.section}>
      {ROLES.map(({ role, label }) => {
        const roleFiles = files.filter(file => file.role === role);
        const inputId = `${idPrefix}-${role}`;
        return (
          <div key={role} className={`${formStyles['form-group']} ${styles.role}`}>
            <label htmlFor={inputId}>{label}</label>
            {roleFiles.length === 0 ? (
              <span className={styles.empty}>No files uploaded.</span>
            ) : (
              <ul className={styles.fileList} aria-label={`${label} contents`}>
                {roleFiles.map(file => (
                  <li key={file.filename} className={styles.fileItem}>
                    <button
                      type="button"
                      className={styles.fileName}
                      onClick={() => handleDownload(role, file.filename)}
                    >
                      {file.filename}
                    </button>
                    <span className={styles.fileSize}>{formatBytes(file.bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
            <input
              type="file"
              id={inputId}
              accept=".zip"
              disabled={disabled || busyRole !== null}
              onChange={event => handleUpload(role, event.target)}
            />
            <span className={styles.hint}>
              Replaces all {role} files. Flat ZIP, up to 20 files, 1 MiB each.
              {role === 'grader' ? ' Needs at least one .cpp.' : ''}
            </span>
            {busyRole === role && <span className={styles.hint}>Uploading…</span>}
            {errors[role] && <span className={styles.error} role="alert">{errors[role]}</span>}
          </div>
        );
      })}
    </div>
  );
};

export default ProblemFilesSection;
