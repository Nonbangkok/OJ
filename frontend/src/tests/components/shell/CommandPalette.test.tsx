import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CommandPaletteProvider } from '../../../components/shell/CommandPaletteContext';
import submissionService from '../../../services/submissionService';
import contestService from '../../../services/contestService';
import { useAuth } from '../../../context/AuthContext';

jest.mock('../../../services/submissionService', () => ({ __esModule: true, default: { searchProblems: jest.fn(), searchUsers: jest.fn() } }));
jest.mock('../../../services/contestService', () => ({ __esModule: true, default: { getAll: jest.fn() } }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ isPrivateMode: false }) }));
const mockToggleTheme = jest.fn();
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: mockToggleTheme }) }));

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const asRole = (role: 'user' | 'staff') =>
  jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'n', role, hasAvatar: false } } as ReturnType<typeof useAuth>);

const renderApp = () => {
  const router = createMemoryRouter(
    [{ path: '*', element: <CommandPaletteProvider><input aria-label="Notes" /><p>page</p></CommandPaletteProvider> }],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe('CommandPalette', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    asRole('user');
    jest.mocked(contestService.getAll).mockResolvedValue([]);
    jest.mocked(submissionService.searchProblems).mockResolvedValue([{ id: 'hp_vec04_erase', title: 'vector::erase' }]);
    jest.mocked(submissionService.searchUsers).mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  it('opens with Ctrl+K', () => {
    renderApp();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
  });

  it('does not open on / while typing', () => {
    renderApp();
    const input = screen.getByRole('textbox', { name: 'Notes' });
    input.focus();
    expect(fireEvent.keyDown(input, { key: '/' })).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });

  it('searches problems after a pause and opens the chosen one', async () => {
    const router = renderApp();
    fireEvent.keyDown(document.body, { key: '/' });
    const box = within(screen.getByRole('dialog', { name: 'Search' })).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'vec' } });
    expect(submissionService.searchProblems).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(submissionService.searchProblems).toHaveBeenCalledTimes(1);
    expect(submissionService.searchProblems).toHaveBeenCalledWith('vec');
    const option = await screen.findByRole('option', { name: /vector::erase/ });
    expect(option).toHaveTextContent('hp_vec04_erase');
    fireEvent.click(option);
    expect(router.state.location.pathname).toBe('/problems/hp_vec04_erase');
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });

  it('shows the Users group only to staff', async () => {
    renderApp();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'na' } });
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(submissionService.searchUsers).not.toHaveBeenCalled();
  });

  it('searches users for staff', async () => {
    asRole('staff');
    jest.mocked(submissionService.searchUsers).mockResolvedValue([{ id: 2, username: 'nattapat' }] as never);
    const router = renderApp();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nat' } });
    await act(async () => { jest.advanceTimersByTime(200); });
    fireEvent.click(await screen.findByRole('option', { name: /nattapat/ }));
    expect(router.state.location.pathname).toBe('/profile/nattapat');
  });

  it('toggles the theme', () => {
    renderApp();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByRole('option', { name: /toggle theme/i }));
    expect(mockToggleTheme).toHaveBeenCalled();
  });
});
