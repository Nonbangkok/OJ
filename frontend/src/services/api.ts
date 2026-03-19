import axios, { AxiosInstance, AxiosResponse } from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

/**
 * Pre-configured Axios instance for all API requests.
 * Automatically attaches session cookies.
 */
const api: AxiosInstance = axios.create({
  baseURL: API_URL || '',
  withCredentials: true,
});

// Optional: Add response interceptor for type safety
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error) => {
    // Handle global error cases here
    return Promise.reject(error);
  }
);

export default api;