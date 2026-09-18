import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import AdminLayout from '../../../layouts/admin/AdminLayout';

jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

test('the statement editor route removes the admin navbar and narrow main container', () => {
  jest.mocked(useAuth).mockReturnValue({ user: { role: 'admin' }, isLoading: false } as any);
  render(<MemoryRouter initialEntries={['/admin/authoring/d1/editor']}><Routes>
    <Route path="/admin" element={<AdminLayout />}>
      <Route path="authoring/:draftId/editor" element={<section aria-label="Editor surface">Editor</section>} />
    </Route>
  </Routes></MemoryRouter>);

  const editor = screen.getByRole('region', { name: 'Editor surface' });
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(editor.closest('main.container')).toBeNull();
});
