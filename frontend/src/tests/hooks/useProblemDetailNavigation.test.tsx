import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { useProblemDetail } from '../../hooks/useProblemDetail';
import problemService from '../../services/problemService';
import contestService from '../../services/contestService';
import type { ProblemDetail } from '../../types';

jest.mock('../../services/problemService');
jest.mock('../../services/contestService');

/**
 * A7-04: React Router keeps the same page instance when only :problemId
 * changes (ContestShell's sidebar, the problem links). The hook must start
 * each problem afresh — no error, problem or loading state carried over from
 * the previous one — and ignore a late answer for a problem already left.
 */
function Probe() {
  const { problem, loading, error } = useProblemDetail();
  const state = loading ? 'loading' : error ? `error: ${error}` : `problem: ${problem?.title}`;
  return (
    <>
      <p data-testid="state">{state}</p>
      <Link to="/problems/one">one</Link>
      <Link to="/problems/two">two</Link>
      <Link to="/contests/3/problems/two">contest two</Link>
    </>
  );
}

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/problems/:problemId" element={<Probe />} />
      <Route path="/contests/:contestId/problems/:problemId" element={<Probe />} />
    </Routes>
  </MemoryRouter>,
);
const state = () => screen.getByTestId('state').textContent;
const go = (name: string) => fireEvent.click(screen.getByRole('link', { name }));

const problem = (id: string, title: string) => ({ id, title, time_limit_ms: 1000, memory_limit_mb: 256 }) as ProblemDetail;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('useProblemDetail across problems (A7-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.mocked(console.error).mockRestore());

  it("a failed problem's error does not stick to the next one", async () => {
    jest.mocked(problemService.getDetails).mockImplementation(async (id: string) => {
      if (id === 'one') throw { response: { status: 500, data: { message: 'Contest is not active.' } } };
      return problem(id, 'Two');
    });
    renderAt('/problems/one');
    expect(await screen.findByText('error: Contest is not active.')).toBeInTheDocument();

    go('two');

    expect(await screen.findByText('problem: Two')).toBeInTheDocument();
  });

  it('shows loading, not the previous problem, while the next one loads', async () => {
    const two = deferred<ProblemDetail>();
    jest.mocked(problemService.getDetails).mockImplementation((id: string) =>
      (id === 'one' ? Promise.resolve(problem('one', 'One')) : two.promise));
    renderAt('/problems/one');
    expect(await screen.findByText('problem: One')).toBeInTheDocument();

    go('two');

    expect(state()).toBe('loading');
    await act(async () => { two.resolve(problem('two', 'Two')); });
    expect(state()).toBe('problem: Two');
  });

  it('ignores a late answer for a problem already left', async () => {
    const one = deferred<ProblemDetail>();
    jest.mocked(problemService.getDetails).mockImplementation((id: string) =>
      (id === 'one' ? one.promise : Promise.resolve(problem('two', 'Two'))));
    renderAt('/problems/one');
    expect(state()).toBe('loading');

    go('two');
    expect(await screen.findByText('problem: Two')).toBeInTheDocument();

    await act(async () => { one.resolve(problem('one', 'One')); });
    expect(state()).toBe('problem: Two');
  });

  it('ignores a late failure for a problem already left', async () => {
    const one = deferred<ProblemDetail>();
    jest.mocked(problemService.getDetails).mockImplementation((id: string) =>
      (id === 'one' ? one.promise : Promise.resolve(problem('two', 'Two'))));
    renderAt('/problems/one');

    go('two');
    expect(await screen.findByText('problem: Two')).toBeInTheDocument();

    await act(async () => { one.reject({ response: { status: 404 } }); });
    expect(state()).toBe('problem: Two');
  });

  it('starts afresh on a contest problem after a failed one', async () => {
    jest.mocked(problemService.getDetails).mockRejectedValue({ response: { status: 404 } });
    jest.mocked(problemService.getContestProblemDetails).mockResolvedValue(problem('two', 'Contest two'));
    jest.mocked(contestService.getById).mockResolvedValue({ id: 3, title: 'C' } as never);
    renderAt('/problems/one');
    expect(await screen.findByText('error: Problem one not found.')).toBeInTheDocument();

    go('contest two');

    expect(await screen.findByText('problem: Contest two')).toBeInTheDocument();
  });
});
