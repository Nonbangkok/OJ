import { getFilenameFromDisposition } from './problemManagement.helpers';

interface TriggerDownloadArgs {
  data: unknown;
  contentType: string;
  contentDisposition?: string;
}

/** Pure blob-download helper: build a zip Blob, click a synthetic link, clean up. */
export const triggerZipDownload = ({ data, contentType, contentDisposition }: TriggerDownloadArgs): void => {
  const blob = new Blob([data as BlobPart], { type: contentType });
  const downloadUrl = window.URL.createObjectURL(blob);
  const filename = getFilenameFromDisposition(contentDisposition);

  const link = document.createElement('a');
  link.href = downloadUrl;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(downloadUrl);
};
