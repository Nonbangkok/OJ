import axios, { type AxiosResponse } from 'axios';

const API_URL = process.env.REACT_APP_API_URL;
const LARGE_UPLOAD_API_URL = process.env.REACT_APP_LARGE_UPLOAD_API_URL || API_URL;

/**
 * Pre-configured Axios instance for all API requests.
 * Automatically attaches session cookies.
 */
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

export const largeUploadApi = axios.create({
  baseURL: LARGE_UPLOAD_API_URL,
  withCredentials: true,
});

export const getLargeUploadBaseUrl = (): string => largeUploadApi.defaults.baseURL ?? '';

export const requestData = async <T>(request: Promise<AxiosResponse<T>>): Promise<T> => {
  const response = await request;
  return response.data;
};

export default api;
