import axios, { type AxiosInstance } from 'axios';
import { clearSessionExpiryRedirect, installSessionExpiryInterceptor } from '../../services/api';

const replaceStateSpy = jest.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);

describe('session expiry interceptor', () => {
  beforeEach(() => {
    replaceStateSpy.mockClear();
    window.sessionStorage.clear();
  });

  const makeInstance = (): AxiosInstance => {
    const instance = axios.create();
    installSessionExpiryInterceptor(instance);
    return instance;
  };

  // The interceptor re-throws so axios rejects the request promise normally;
  // swallow that rejection while asserting on its side effects.
  const reject = (api: AxiosInstance, error: unknown): void => {
    expect(() => api.interceptors.response.handlers[0].rejected(error)).toThrow();
  };

  it('redirects to /login with a return path on a bare 401 when a session existed', () => {
    window.sessionStorage.setItem('oj:had-session', '1');
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/login?expired=1&returnTo=%2F');
  });

  it('does NOT redirect a guest who never had a session', () => {
    // A first-visit guest hitting an auth-required endpoint is a normal
    // guest state, not a session expiry.
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('does not redirect when the 401 came from the login endpoint itself', () => {
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/login' },
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('does not redirect on other status codes', () => {
    const api = makeInstance();

    reject(api, {
      response: { status: 500 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('does not redirect on network errors (no response object)', () => {
    const api = makeInstance();

    reject(api, new Error('Network Error'));

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('marks the redirect once per expiry to avoid a loop between mounts', () => {
    window.sessionStorage.setItem('oj:had-session', '1');
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/me' },
    });
    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });

  // AUTH-008: the one-shot loop-guard must re-arm after a successful login,
  // or a second session expiry in the same tab never redirects.
  it('re-arms the redirect after clearSessionExpiryRedirect (successful login)', () => {
    window.sessionStorage.setItem('oj:had-session', '1');
    const api = makeInstance();

    // First expiry: sets the guard and navigates once.
    reject(api, {
      response: { status: 401 }, config: { url: '/me' },
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);

    // While the guard is set, further 401s are swallowed...
    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);

    // ...the user logs in (AuthContext.login clears the flag)...
    clearSessionExpiryRedirect();

    // ...and a second expiry later in the same tab redirects again.
    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
  });
});
