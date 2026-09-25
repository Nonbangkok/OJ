import axios, { type AxiosError, type AxiosInstance } from 'axios';

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

const SESSION_EXPIRY_KEY = 'oj:session-expiry-redirect';

/**
 * Re-arm the session-expiry redirect (AUTH-008).
 *
 * The interceptor sets a one-shot loop-guard flag before redirecting to
 * /login so several concurrently-failing requests don't trigger repeated
 * reloads. Without clearing it, a second session expiry later in the same
 * tab would be silently swallowed. Called on successful login (AuthContext)
 * and when the module loads on a non-/login page — both points where the
 * user is demonstrably past the expired-session state.
 */
export const clearSessionExpiryRedirect = (): void => {
  window.sessionStorage.removeItem(SESSION_EXPIRY_KEY);
};

/**
 * Send the user to the login page (with a way back) when any API call
 * returns a bare 401 — i.e. the session cookie expired mid-session.
 * A 401 from /login itself (wrong credentials) is not an expiry.
 *
 * Redirecting via history.replaceState + reload instead of react-router
 * navigation keeps this module free of React/context imports (avoiding a
 * circular dependency with AuthContext).
 */
export const installSessionExpiryInterceptor = (instance: AxiosInstance): void => {
  instance.interceptors.response.use(undefined, (error: AxiosError) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url ?? '';

    if (status !== 401 || requestUrl.includes('/login')) {
      throw error;
    }

    // A guest who never had a session hitting an auth-required endpoint is a
    // normal guest state — surface the error to the caller, never the
    // session-expiry redirect. "Expired" means a session previously existed.
    if (window.sessionStorage.getItem('oj:had-session') !== '1') {
      throw error;
    }

    // Guard against a redirect loop when several in-flight requests all
    // fail at once after the session died: only the first one navigates.
    if (window.sessionStorage.getItem(SESSION_EXPIRY_KEY) === '1') {
      throw error;
    }
    window.sessionStorage.setItem(SESSION_EXPIRY_KEY, '1');

    const returnTo = window.location.pathname + window.location.search;
    window.history.replaceState({}, '', `/login?expired=1&returnTo=${encodeURIComponent(returnTo)}`);
    window.location.reload();
    throw error;
  });
};

installSessionExpiryInterceptor(api);
installSessionExpiryInterceptor(largeUploadApi);

// Clear the loop-guard flag once the user has landed somewhere after login.
if (window.location.pathname !== '/login') {
  clearSessionExpiryRedirect();
}

export default api;
