import adminService from '../../services/adminService';
import problemService from '../../services/problemService';
import type { AdminProblem, ProblemSummary } from '../../types';
import {
  adminProblemListQueryFromUrl,
  loadAdminProblemListSpan,
  loadPublicProblemListSpan,
  publicProblemListQueryFromUrl,
  revalidateProblemListOnPathChange,
} from '../../routing/problemListLoaders';

jest.mock('../../services/adminService');
jest.mock('../../services/problemService');

describe('problem list route loaders', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preloads the public list span needed by a history entry using filter query and cursor', async () => {
    const makeProblem = (index: number): ProblemSummary => ({
      id: `p-${index}`, title: `Problem ${index}`, author: null, categories: [], best_score: null,
    });
    const first = Array.from({ length: 100 }, (_, index) => makeProblem(index));
    const second = Array.from({ length: 20 }, (_, index) => makeProblem(100 + index));
    jest.mocked(problemService.getProblemsPage)
      .mockResolvedValueOnce({ problems: first, nextCursor: 'next-100', hasMore: true })
      .mockResolvedValueOnce({ problems: second, nextCursor: 'next-120', hasMore: true });

    const span = await loadPublicProblemListSpan(new URL(
      'http://localhost/problems?search=needle&sort=difficulty-desc&category=Graph%2CTree&pages=6',
    ));

    expect(span?.problems).toHaveLength(120);
    expect(span?.hasMore).toBe(true);
    expect(span?.nextCursor).toBe('next-120');
    expect(problemService.getProblemsPage).toHaveBeenNthCalledWith(1, {
      search: 'needle', category: 'Graph,Tree', sort: 'difficulty', order: 'desc', limit: 100,
    });
    expect(problemService.getProblemsPage).toHaveBeenNthCalledWith(2, {
      search: 'needle', category: 'Graph,Tree', sort: 'difficulty', order: 'desc', limit: 20, cursor: 'next-100',
    });
  });

  it('preloads the admin list span with all active filters and independent page count', async () => {
    const makeProblem = (index: number): AdminProblem => ({
      id: `a-${index}`, title: `Admin ${index}`, author: 'Alice', categories: [], difficulty: null,
      collection_id: null, collection_name: null, is_visible: false, contest_id: null, contest_status: null,
    });
    const first = Array.from({ length: 100 }, (_, index) => makeProblem(index));
    const second = Array.from({ length: 25 }, (_, index) => makeProblem(100 + index));
    const makePage = (problems: AdminProblem[], nextCursor: string | null, hasMore: boolean) => ({
      problems, nextCursor, hasMore, authors: [{ name: 'Alice' }],
      hasUnauthoredProblems: true, bulkEligibleCount: 314,
    });
    jest.mocked(adminService.getProblems)
      .mockResolvedValueOnce(makePage(first, 'admin-cursor', true))
      .mockResolvedValueOnce(makePage(second, 'admin-next', true));

    const span = await loadAdminProblemListSpan(new URL(
      'http://localhost/admin/problems?search=needle&collection=7&visibility=hidden&author=Alice&pages=5',
    ));

    expect(span?.problems).toHaveLength(125);
    expect(span?.queryKey).toBe(JSON.stringify({ search: 'needle', collection: 7, visibility: 'hidden', author: 'Alice' }));
    expect(span?.nextCursor).toBe('admin-next');
    expect(span?.pageMetadata).toEqual({
      authors: [{ name: 'Alice' }], hasUnauthoredProblems: true, bulkEligibleCount: 314,
    });
    expect(adminService.getProblems).toHaveBeenNthCalledWith(1, {
      search: 'needle', collection: 7, visibility: 'hidden', author: 'Alice', limit: 100,
    });
    expect(adminService.getProblems).toHaveBeenNthCalledWith(2, {
      search: 'needle', collection: 7, visibility: 'hidden', author: 'Alice', limit: 25, cursor: 'admin-cursor',
    });
  });

  it('treats a fresh visit without a saved page count as page one on each list', async () => {
    jest.mocked(problemService.getProblemsPage).mockResolvedValue({ problems: [], nextCursor: null, hasMore: false });
    jest.mocked(adminService.getProblems).mockResolvedValue({
      problems: [], nextCursor: null, hasMore: false, authors: [], hasUnauthoredProblems: false, bulkEligibleCount: 0,
    });

    await loadPublicProblemListSpan(new URL('http://localhost/problems'));
    await loadAdminProblemListSpan(new URL('http://localhost/admin/problems'));

    expect(problemService.getProblemsPage).toHaveBeenCalledWith({ sort: 'difficulty', order: 'asc', limit: 20 });
    expect(adminService.getProblems).toHaveBeenCalledWith({ limit: 25 });
  });

  it('keeps public and admin list URL filters independent, and revalidates only across paths', () => {
    const publicUrl = new URL('http://localhost/problems?search=graph&category=Tree&pages=4');
    const adminUrl = new URL('http://localhost/admin/problems?search=staff&visibility=hidden&pages=2');
    expect(publicProblemListQueryFromUrl(publicUrl)).toEqual({
      search: 'graph', category: 'Tree', sort: 'difficulty', order: 'asc',
    });
    expect(adminProblemListQueryFromUrl(adminUrl)).toEqual({ search: 'staff', visibility: 'hidden' });
    expect(revalidateProblemListOnPathChange({
      currentUrl: new URL('http://localhost/problems?pages=2'),
      nextUrl: new URL('http://localhost/problems?pages=4'),
      defaultShouldRevalidate: true,
    })).toBe(false);
    expect(revalidateProblemListOnPathChange({
      currentUrl: new URL('http://localhost/problems?pages=4'),
      nextUrl: new URL('http://localhost/problems/p-1'),
      defaultShouldRevalidate: true,
    })).toBe(true);
  });

  it('does not replace a page with a route error when its loader request fails', async () => {
    jest.mocked(problemService.getProblemsPage).mockRejectedValue(new Error('offline'));
    await expect(loadPublicProblemListSpan(new URL('http://localhost/problems?pages=3'))).resolves.toBeNull();
  });
});
