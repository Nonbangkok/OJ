import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import adminService from '../../services/adminService';
import type {
  BatchUploadFeedback,
  BatchUploadProgressState,
} from '../../types';
import { getErrorMessage } from '../../utils/error';
import { APP_CONSTANTS } from '../../utils/constants';

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

    if (file.size > APP_CONSTANTS.LARGE_UPLOAD_WARNING_BYTES && !process.env.REACT_APP_LARGE_UPLOAD_API_URL) {
      setBatchUploadFeedback({
        visible: true,
        message: 'This ZIP is over 100MB. Through proxied Cloudflare it will usually fail before reaching the server. Set REACT_APP_LARGE_UPLOAD_API_URL to a DNS-only/origin upload endpoint first.',
        type: 'warning',
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

    const formData = new FormData();
    formData.append('problemsZip', file);

    try {
      const response = await adminService.batchUploadProblems(formData);
      const { progressId } = response;

      if (progressId) {
        setBatchUploadFeedback({
          visible: true,
          message: 'File uploaded. Waiting for processing to start...',
          type: 'info',
        });

        const eventSource = adminService.getBatchUploadProgressEventSource(progressId);

        eventSource.addEventListener('progress', (progressEvent: MessageEvent<string>) => {
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
