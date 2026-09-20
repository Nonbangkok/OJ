// The general API limiter skips read-heavy authoring workspace routes.
// These guards pin the skip list so new authoring endpoints don't regress
// into 429s during normal admin sessions (as happened with profile-syncs).

type SkipRequest = Parameters<typeof import('../../middleware/rateLimit').skipGeneralLimit>[0];

describe('general API limiter skip paths', () => {
  const OLD_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
    jest.resetModules();
  });

  const skipped = (path: string): boolean => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { skipGeneralLimit } = require('../../middleware/rateLimit') as {
      skipGeneralLimit: (req: SkipRequest) => boolean;
    };
    return skipGeneralLimit({ path } as SkipRequest);
  };

  it('skips draft, job, profile, and profile-sync workspace traffic', () => {
    expect(skipped('/admin/authoring/drafts/abc')).toBe(true);
    expect(skipped('/admin/authoring/jobs/abc')).toBe(true);
    expect(skipped('/admin/authoring/profile-syncs')).toBe(true);
    expect(skipped('/admin/authoring/profile-syncs/abc')).toBe(true);
    expect(skipped('/admin/author-profiles')).toBe(true);
    expect(skipped('/admin/author-profiles/abc/image')).toBe(true);
  });

  it('skips SSE realtime streams', () => {
    expect(skipped('/realtime/submissions')).toBe(true);
    expect(skipped('/realtime/contests/5')).toBe(true);
  });

  it('does not skip unrelated routes', () => {
    expect(skipped('/problems')).toBe(false);
    expect(skipped('/submit')).toBe(false);
    expect(skipped('/admin/authoring')).toBe(false); // exact mount, no trailing path
    expect(skipped('/realtime')).toBe(false); // exact mount, no trailing path
    expect(skipped('/realtime-thing/other')).toBe(false); // prefix must match a path segment
  });
});
