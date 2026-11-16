import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  const nav = () => screen.getByRole('navigation', { name: 'Main' });
  const fire = (event: Event) => act(() => { window.dispatchEvent(event); });
  const rail = () => nav().closest('aside') as HTMLElement;

  it('collapses to an icon rail, remembers it, and expands again', () => {
    const { unmount } = renderAt('/');
    expect(rail()).not.toHaveAttribute('data-compact');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // The rail keeps every destination, as icons with their names.
    expect(rail()).toHaveAttribute('data-compact', 'true');
    expect(within(nav()).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(nav()).queryByText('Home')).toBeNull();
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBe('true');
    unmount();
    renderAt('/');
    expect(rail()).toHaveAttribute('data-compact', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(rail()).not.toHaveAttribute('data-compact');
    expect(within(nav()).getByText('Home')).toBeInTheDocument();
  });

  it('toggles with [ but not while typing', () => {
    renderAt('/');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(rail()).toHaveAttribute('data-compact', 'true');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(rail()).not.toHaveAttribute('data-compact');
    const input = screen.getByRole('textbox', { name: 'Notes' });
    input.focus();
    const typed = fireEvent.keyDown(input, { key: '[' });
    expect(typed).toBe(true); // not prevented
    expect(rail()).not.toHaveAttribute('data-compact');
  });

  it('the edge handle resizes the sidebar from the keyboard and remembers the width', () => {
    const { unmount } = renderAt('/');
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(handle).toHaveAttribute('aria-valuenow', '220');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '252');
    expect(localStorage.getItem('oj.sidebar.width')).toBe('252');
    unmount();
    renderAt('/');
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '252');
  });

  it('dragging the handle narrow enough turns the sidebar into the icon rail, and wider brings it back', () => {
    renderAt('/');
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    fireEvent.pointerDown(handle, { button: 0 });
    fire(new MouseEvent('pointermove', { clientX: 300 }));
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    fire(new MouseEvent('pointermove', { clientX: 90 }));
    expect(rail()).toHaveAttribute('data-compact', 'true');
    fire(new MouseEvent('pointerup'));
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBe('true');
    // Widths are clamped: never wider than 360.
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize sidebar' }), { button: 0 });
    fire(new MouseEvent('pointermove', { clientX: 900 }));
    fire(new MouseEvent('pointerup'));
    expect(rail()).not.toHaveAttribute('data-compact');
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '360');
  });

  it('a narrow drag from the keyboard collapses too', () => {
    localStorage.setItem('oj.sidebar.width', '180');
    renderAt('/');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sidebar' }), { key: 'ArrowLeft' });
    expect(rail()).toHaveAttribute('data-compact', 'true');
  });

  it('does not auto-collapse on problem pages (the left rail is gone)', () => {
    renderAt('/problems/abc');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBeNull();
  });

  it('does not auto-collapse in the authoring workspace (its left rail is gone, §10 interim rule retired)', () => {
    renderAt('/admin/authoring/d1/statement');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(localStorage.getItem('oj.sidebar.collapsed')).toBeNull();
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
