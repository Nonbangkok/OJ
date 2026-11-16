import adminService from '../../../services/adminService';
import { CHUNKED_UPLOAD_CONFIG } from '../../../config/upload';

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 300;

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Replace a problem's testcases with a ZIP, the same two routes the old
 * modal used: one request (then poll the processing job) up to 50 MB,
 * chunked init/chunk/complete above. Resolves once the server has finished;
 * rejects with the server's message when processing fails.
 */
export async function uploadTestcasesZip(problemId: string, file: File, onProgress: (message: string) => void): Promise<void> {
  if (file.size > CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes) {
    const totalChunks = Math.ceil(file.size / CHUNKED_UPLOAD_CONFIG.chunkSizeBytes);
    const { uploadId } = await adminService.initProblemTestcaseUpload(problemId, { fileName: file.name, fileSize: file.size, totalChunks });
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * CHUNKED_UPLOAD_CONFIG.chunkSizeBytes;
      await adminService.uploadProblemTestcaseChunk(problemId, uploadId, index, file.slice(start, Math.min(start + CHUNKED_UPLOAD_CONFIG.chunkSizeBytes, file.size)));
      onProgress(`Uploading… ${Math.round(((index + 1) / totalChunks) * 100)}%`);
    }
    onProgress('Processing testcases…');
    await adminService.completeProblemTestcaseUpload(problemId, uploadId);
    return;
  }

  const formData = new FormData();
  formData.append('testcasesZip', file);
  onProgress('Uploading…');
  const { jobId } = await adminService.uploadFiles(problemId, formData);
  if (!jobId) return;
  onProgress('Processing testcases…');
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const progress = await adminService.getUploadProgress(jobId);
    if (progress.status === 'completed') return;
    if (progress.status === 'failed') throw new Error(progress.message || 'Processing the testcases failed.');
    if (progress.message) onProgress(progress.message);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Processing did not finish in time. Reload to see the current testcases.');
}
