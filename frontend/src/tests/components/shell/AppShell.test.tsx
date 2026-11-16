import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from '../../../components/shell/AppShell';
import { useAuth } from '../../../context/AuthContext';
import { useSettings } from '../../../context/SettingsContext';

jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../context/SettingsContext', () => ({ useSettings: jest.fn() }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: jest.fn() }) }));
jest.mock('../../../components/shell/useLiveContest', () => ({ useLiveContest: () => null }));

const setMobile = (mobile: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell><input aria-label="Notes" /></AppShell>
    </MemoryRouter>,
  );

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear();
    setMobile(false);
    jest.mocked(useAuth).mockReturnValue({ user: { id: 1, username: 'n', role: 'staff', hasAvatar: false }, isLoading: false } as ReturnType<typeof useAuth>);
    jest.mocked(useSettings).mockReturnValue({ isPrivateMode: false, registrationEnabled: true, passwordChangeEnabled: true } as ReturnType<typeof useSettings>);
  });

  it('collapses, remembers it, and expands again', () => {
    const { unmount } = renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBe('true');
    unmount();
    renderAt('/');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('toggles with [ but not while typing', () => {
    renderAt('/');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '[' });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Notes' });
    input.focus();
    const typed = fireEvent.keyDown(input, { key: '[' });
    expect(typed).toBe(true); // not prevented
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('does not auto-collapse on problem pages (the left rail is gone)', () => {
    renderAt('/problems/abc');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBeNull();
  });

  it('starts collapsed in the authoring workspace but not the editor or the draft list', () => {
    const { unmount } = renderAt('/admin/authoring/d1/statement');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    unmount();
    renderAt('/admin/authoring');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('uses a bottom tab bar on phones', () => {
    setMobile(true);
    renderAt('/');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    const tabs = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(4);
    fireEvent.click(within(tabs).getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('link', { name: /ranking/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /authoring/i })).toBeInTheDocument();
  });
});
