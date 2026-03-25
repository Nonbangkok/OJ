interface ApiErrorData {
  message?: string;
  [key: string]: unknown;
}

interface ApiLikeError {
  message?: string;
  response?: {
    status?: number;
    data?: ApiErrorData;
  };
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

export const toApiLikeError = (error: unknown): ApiLikeError => {
  if (isObjectRecord(error)) {
    return error as ApiLikeError;
  }

  return { message: String(error) };
};

export const getErrorStatus = (error: unknown): number | undefined => {
  return toApiLikeError(error).response?.status;
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  const apiError = toApiLikeError(error);

  if (typeof apiError.response?.data?.message === 'string' && apiError.response.data.message) {
    return apiError.response.data.message;
  }

  if (typeof apiError.message === 'string' && apiError.message) {
    return apiError.message;
  }

  return fallback;
};
