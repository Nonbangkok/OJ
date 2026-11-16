import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AdminLayout from '../../layouts/admin/AdminLayout';
import Admin from '../../pages/admin/Admin';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const Where = () => <p>{`at ${useLocation().pathname}`}</p>;
const renderAt = (path: string, role: 'admin' | 'staff') => {
  jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'k', role }, isLoading: false } as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Admin />} />
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

describe('/admin', () => {
  beforeEach(() => localStorage.clear());

  it('sends staff to /admin/problems', () => {
    renderAt('/admin', 'staff');
    expect(screen.getByText('at /admin/problems')).toBeInTheDocument();
  });

  it('returns an admin to the last Manage page they opened', () => {
    const first = renderAt('/admin/contests/4/problems', 'admin');
    expect(screen.getByText('at /admin/contests/4/problems')).toBeInTheDocument();
    first.unmount();
    renderAt('/admin', 'admin');
    expect(screen.getByText('at /admin/contests/4/problems')).toBeInTheDocument();
  });

  it('ignores a remembered admin-only page for staff', () => {
    localStorage.setItem('oj:last-manage-page', '/admin/users');
    renderAt('/admin', 'staff');
    expect(screen.getByText('at /admin/problems')).toBeInTheDocument();
  });
});
