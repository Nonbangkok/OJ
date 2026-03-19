import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

/**
 * Pre-configured Axios instance for all API requests.
 * Automatically attaches session cookies.
 */
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

export default api;
