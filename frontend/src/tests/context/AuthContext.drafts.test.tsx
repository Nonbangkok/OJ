import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';
import { APP_CONSTANTS } from '../../utils/constants';
import {
  bindSubmissionDraftsToUser,
  readSubmissionCache,
  SUBMISSION_CACHE_KEY,
  SUBMISSION_CACHE_OWNER_KEY,
} from '../../utils/submissionDrafts';

jest.mock('../../services/authService');

/**
 * The submit editor's code drafts live in localStorage. On a shared lab PC,
 * student A's session can end without a Logout click (cookie expiry, admin
 * password reset); student B then signs in on the same browser. None of A's
 * code may remain readable there, let alone be restored into B's editor.
 */
const STUDENT_A_CODE = 'int main(){ /* student A secret solution */ }';
const studentA = { id: 1, username: 'studentA', role: 'user', hasAvatar: false };
const studentB = { id: 2, username: 'studentB', role: 'user', hasAvatar: false };

const allStoredValues = (): string[] => {
  const values: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key) values.push(window.localStorage.getItem(key) ?? '');
  }
  return values;
};

const storeDraftOfA = () => window.localStorage.setItem(SUBMISSION_CACHE_KEY,
  JSON.stringify({ 'P:cpp': { code: STUDENT_A_CODE, timestamp: Date.now() } }));

const Probe = () => {
  const { user, login } = useAuth();
  return (
    <div>
      <span data-testid="who">{user?.username ?? 'guest'}</span>
      <button type="button" onClick={() => login(studentB as never)}>login-b</button>
    </div>
  );
};

const renderSignedInAs = async (who: typeof studentA) => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent(who.username));
};

describe('code drafts across users on one browser', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('a session that ended without Logout wipes the drafts before the next user signs in', async () => {
    (jest.mocked(authService.checkLogin) as jest.Mock)
      .mockResolvedValueOnce({ isAuthenticated: true, user: studentA })
      .mockResolvedValueOnce({ isAuthenticated: false });
    await renderSignedInAs(studentA);
    storeDraftOfA();

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('guest'));
    expect(allStoredValues().some((value) => value.includes(STUDENT_A_CODE))).toBe(false);

    await act(async () => { screen.getByRole('button', { name: 'login-b' }).click(); });
    expect(screen.getByTestId('who')).toHaveTextContent('studentB');
    expect(allStoredValues().some((value) => value.includes(STUDENT_A_CODE))).toBe(false);
    expect(window.localStorage.getItem(SUBMISSION_CACHE_OWNER_KEY)).toBe('2');
  });

  it("another user signing in over the previous user's session never sees that user's drafts", async () => {
    (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValue({ isAuthenticated: true, user: studentA });
    await renderSignedInAs(studentA);
    storeDraftOfA();

    await act(async () => { screen.getByRole('button', { name: 'login-b' }).click(); });

    expect(screen.getByTestId('who')).toHaveTextContent('studentB');
    expect(allStoredValues().some((value) => value.includes(STUDENT_A_CODE))).toBe(false);
  });

  it("the same user's re-check keeps their drafts and prunes the expired ones", async () => {
    (jest.mocked(authService.checkLogin) as jest.Mock).mockResolvedValue({ isAuthenticated: true, user: studentA });
    await renderSignedInAs(studentA);
    const now = Date.now();
    window.localStorage.setItem(SUBMISSION_CACHE_KEY, JSON.stringify({
      'P:cpp': { code: STUDENT_A_CODE, timestamp: now },
      'Q:python': { code: 'print(1)', timestamp: now - APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY - 1 },
    }));

    await act(async () => { window.dispatchEvent(new Event('focus')); });

    expect(screen.getByTestId('who')).toHaveTextContent('studentA');
    expect(JSON.parse(window.localStorage.getItem(SUBMISSION_CACHE_KEY) ?? '{}'))
      .toEqual({ 'P:cpp': { code: STUDENT_A_CODE, timestamp: now } });
  });
});

describe('bindSubmissionDraftsToUser', () => {
  beforeEach(() => window.localStorage.clear());

  it('wipes drafts that have no recorded owner when a user is bound', () => {
    storeDraftOfA();
    bindSubmissionDraftsToUser(7);
    expect(window.localStorage.getItem(SUBMISSION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SUBMISSION_CACHE_OWNER_KEY)).toBe('7');
  });

  it('wipes drafts and the owner when no user is signed in', () => {
    window.localStorage.setItem(SUBMISSION_CACHE_OWNER_KEY, '1');
    storeDraftOfA();
    bindSubmissionDraftsToUser(null);
    expect(window.localStorage.getItem(SUBMISSION_CACHE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SUBMISSION_CACHE_OWNER_KEY)).toBeNull();
  });

  it('readSubmissionCache never returns an expired draft', () => {
    window.localStorage.setItem(SUBMISSION_CACHE_KEY, JSON.stringify({
      'old:cpp': { code: 'x', timestamp: Date.now() - APP_CONSTANTS.SUBMISSION_CACHE_EXPIRY - 1 },
    }));
    expect(readSubmissionCache()).toEqual({});
  });
});
