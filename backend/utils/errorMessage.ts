export const getErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return fallback;
};
