import axios, { type AxiosInstance } from 'axios';
import { installSessionExpiryInterceptor } from '../../services/api';

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

  it('redirects to /login with a return path on a bare 401', () => {
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/login?expired=1&returnTo=%2F');
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
    const api = makeInstance();

    reject(api, {
      response: { status: 401 }, config: { url: '/me' },
    });
    reject(api, {
      response: { status: 401 }, config: { url: '/problems' },
    });

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });
});
