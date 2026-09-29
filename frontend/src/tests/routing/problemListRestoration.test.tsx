import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Link,
  Outlet,
  Route,
  RouterProvider,
  ScrollRestoration,
  useLoaderData,
  useNavigate,
} from 'react-router-dom';

interface RestoredRows {
  rows: string[];
}

const ListRoute = () => {
  const { rows } = useLoaderData() as RestoredRows;
  return (
    <main>
      <h1>Problem list</h1>
      {rows.map(row => <p key={row}>{row}</p>)}
      <Link to="/problems/detail-1">Open problem</Link>
    </main>
  );
};

const DetailRoute = () => {
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>Back</button><Link to="/problems/detail-2">Open another problem</Link></>;
};

const RootRoute = () => <><Outlet /><ScrollRestoration /></>;

describe('history-entry scroll restoration after list route data loads', () => {
  const originalScrollTo = window.scrollTo;
  const originalUrl = window.location.href;

  beforeEach(() => {
    window.history.replaceState({}, '', '/problems?search=state&pages=2');
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    window.scrollTo = jest.fn();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    window.history.replaceState({}, '', originalUrl);
    window.sessionStorage.clear();
  });

  it('waits for the saved list span before applying the history entry scroll position', async () => {
    const loader = jest.fn<Promise<RestoredRows>, []>()
      .mockResolvedValueOnce({ rows: ['first batch', 'restored batch'] })
      .mockResolvedValueOnce({ rows: ['first batch', 'restored batch'] });
    const router = createBrowserRouter(createRoutesFromElements(
      <Route element={<RootRoute />} hydrateFallbackElement={<p>Loading list data…</p>}>
        <Route path="/problems" loader={loader} element={<ListRoute />} />
        <Route path="/problems/:problemId" element={<DetailRoute />} />
      </Route>,
    ));
    const view = render(<RouterProvider router={router} fallbackElement={<p>Loading list data…</p>} />);

    try {
      expect(await screen.findByText('restored batch')).toBeInTheDocument();
      Object.defineProperty(window, 'scrollY', { value: 840, writable: true, configurable: true });
      fireEvent.click(screen.getByRole('link', { name: 'Open problem' }));
      expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('link', { name: 'Open another problem' }));
      expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('link', { name: 'Open another problem' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('restored batch')).toBeInTheDocument();
      await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 840));
    } finally {
      view.unmount();
      router.dispose();
    }
  });
});
