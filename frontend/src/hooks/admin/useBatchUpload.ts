import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import adminService from '../../services/adminService';
import { CHUNKED_UPLOAD_CONFIG } from '../../config/upload';
import type {
  BatchUploadFeedback,
  BatchUploadProgressState,
} from '../../types';
import { getErrorMessage } from '../../utils/error';

import {
  buildBatchUploadSuccessMessage,
  EMPTY_BATCH_PROGRESS,
  parseProgressEventData,
} from './problemManagement.helpers';

const DEFAULT_BATCH_FEEDBACK: BatchUploadFeedback = { visible: false, message: '', type: 'info' };
interface UseBatchUploadArgs {
  onCompleted: () => Promise<void> | void;
  setLoading: (loading: boolean) => void;
}

/** Batch problem ZIP upload + SSE progress feedback. */
const useBatchUpload = ({ onCompleted, setLoading }: UseBatchUploadArgs) => {
  const [batchUploadFeedback, setBatchUploadFeedback] = useState<BatchUploadFeedback>(DEFAULT_BATCH_FEEDBACK);
  const [batchUploadProgress, setBatchUploadProgress] = useState<BatchUploadProgressState>(EMPTY_BATCH_PROGRESS);

  const batchUploadInputRef = useRef<HTMLInputElement | null>(null);

  const handleTriggerBatchUpload = () => {
    setBatchUploadFeedback(DEFAULT_BATCH_FEEDBACK);
    batchUploadInputRef.current?.click();
  };

  const handleBatchUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > CHUNKED_UPLOAD_CONFIG.maxFileBytes) {
      setBatchUploadFeedback({
        visible: true,
        message: 'ZIP files must be 2 GiB or smaller.',
        type: 'error',
      });
      if (batchUploadInputRef.current) {
        batchUploadInputRef.current.value = '';
      }
      return;
    }

    setLoading(true);
    setBatchUploadFeedback({ visible: true, message: 'Initiating batch upload...', type: 'info' });
    setBatchUploadProgress({
      visible: true,
      processed: 0,
      total: 0,
      message: 'Starting upload...',
      status: 'pending',
      currentProblem: '',
    });

    let chunkProgressMessage = '';
    try {
      let response;
      if (file.size <= CHUNKED_UPLOAD_CONFIG.singleRequestLimitBytes) {
        const formData = new FormData();
        formData.append('problemsZip', file);
        response = await adminService.batchUploadProblems(formData);
      } else {
        const totalChunks = Math.ceil(file.size / CHUNKED_UPLOAD_CONFIG.chunkSizeBytes);
        const { uploadId } = await adminService.initBatchUpload({
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
        });

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * CHUNKED_UPLOAD_CONFIG.chunkSizeBytes;
          const end = Math.min(start + CHUNKED_UPLOAD_CONFIG.chunkSizeBytes, file.size);
          await adminService.uploadBatchUploadChunk(uploadId, chunkIndex, file.slice(start, end));

          const uploadedChunks = chunkIndex + 1;
          const percent = Math.round((uploadedChunks / totalChunks) * 100);
          const progressMessage = `Uploaded part ${uploadedChunks}/${totalChunks} (${percent}%).`;
          chunkProgressMessage = progressMessage;
          setBatchUploadFeedback({ visible: true, message: progressMessage, type: 'info' });
          setBatchUploadProgress({
            visible: true,
            processed: uploadedChunks,
            total: totalChunks,
            message: progressMessage,
            status: 'pending',
            currentProblem: '',
          });
        }

        response = await adminService.completeBatchUpload(uploadId);
      }
      const { progressId } = response;

      if (progressId) {
        setBatchUploadFeedback({
          visible: true,
          message: chunkProgressMessage
            ? `${chunkProgressMessage} File uploaded. Waiting for processing to start...`
            : 'File uploaded. Waiting for processing to start...',
          type: 'info',
        });

        const eventSource = adminService.getBatchUploadProgressEventSource(progressId);
        let terminalEventReceived = false;

        eventSource.addEventListener('progress', (progressEvent: MessageEvent<string>) => {
          if (terminalEventReceived) return;
          const progressState = parseProgressEventData(progressEvent.data);
          if (!progressState) {
            console.warn('Received malformed progress data (progress event):', progressEvent.data);
            setBatchUploadFeedback({ visible: true, message: 'Received malformed progress update.', type: 'info' });
            return;
          }

          setBatchUploadProgress(progressState);
          setBatchUploadFeedback({ visible: true, message: 'Batch processing problems...', type: 'info' });
        });

        eventSource.addEventListener('complete', (completeEvent: MessageEvent<string>) => {
          if (terminalEventReceived) return;
          terminalEventReceived = true;
          const data = JSON.parse(completeEvent.data) as Partial<BatchUploadProgressState>;
          setBatchUploadProgress({
            ...EMPTY_BATCH_PROGRESS,
            ...data,
            visible: false,
            status: 'completed',
            currentProblem: data.currentProblem ?? '',
          });

          setBatchUploadFeedback({
            visible: true,
            message: buildBatchUploadSuccessMessage(data.added, data.skipped, data.message),
            type: 'success',
          });

          eventSource.close();
          void onCompleted();
          setLoading(false);
        });

        eventSource.addEventListener('error', (errorEvent: MessageEvent<string>) => {
          if (terminalEventReceived) return;
          terminalEventReceived = true;
          let errorMsg = 'An unknown error occurred during processing.';
          if (errorEvent.data) {
            try {
              const data = JSON.parse(errorEvent.data) as { message?: string };
              errorMsg = data.message || errorMsg;
            } catch {
              errorMsg = errorEvent.data;
            }
          }

          setBatchUploadProgress({
            ...EMPTY_BATCH_PROGRESS,
            visible: false,
            message: errorMsg,
            status: 'error',
          });
          setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
          eventSource.close();
          setLoading(false);
        });
      } else {
        const { added = [], skipped = [], errors = [] } = response;
        let feedbackMessage = `Batch upload complete. Added: ${added.length}. Skipped: ${skipped.length}.`;

        if (errors.length > 0) {
          const errorDetails = errors.map((item) => `${item.directory}: ${item.message}`).join('; ');
          feedbackMessage += ` Errors: ${errors.length} (${errorDetails})`;
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'error' });
        } else {
          setBatchUploadFeedback({ visible: true, message: feedbackMessage, type: 'success' });
        }

        await onCompleted();
        setLoading(false);
      }
    } catch (errorValue) {
      const errorMsg = getErrorMessage(errorValue, 'Failed to batch upload problems.');
      setBatchUploadFeedback({ visible: true, message: errorMsg, type: 'error' });
      setBatchUploadProgress({
        ...EMPTY_BATCH_PROGRESS,
        visible: false,
        message: errorMsg,
        status: 'error',
      });
      setLoading(false);
    } finally {
      if (batchUploadInputRef.current) {
        batchUploadInputRef.current.value = '';
      }
    }
  };

  return {
    batchUploadFeedback,
    setBatchUploadFeedback,
    batchUploadProgress,
    setBatchUploadProgress,
    batchUploadInputRef,
    handleTriggerBatchUpload,
    handleBatchUploadFileChange,
  };
};

export default useBatchUpload;
