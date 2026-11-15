import { act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { render } from '@testing-library/react';
import { useUrlFilters } from '../../hooks/useUrlFilters';

describe('useUrlFilters', () => {
  it('reads, writes and clears URL params, dropping empty values', () => {
    let api = null as unknown as ReturnType<typeof useUrlFilters<'status' | 'q'>>;
    let search = '';
    const Probe = () => {
      api = useUrlFilters(['status', 'q'] as const);
      search = useLocation().search;
      return null;
    };
    const router = createMemoryRouter([{ path: '/', element: <Probe /> }], { initialEntries: ['/?status=solved&other=1'] });
    render(<RouterProvider router={router} />);
    expect(api.values).toEqual({ status: 'solved', q: '' });
    act(() => api.set('q', 'vec'));
    expect(new URLSearchParams(search).get('q')).toBe('vec');
    act(() => api.set('status', ''));
    expect(new URLSearchParams(search).has('status')).toBe(false);
    expect(new URLSearchParams(search).get('other')).toBe('1');
    act(() => api.clear());
    expect(search).toBe('?other=1');
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
