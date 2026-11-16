import { USER_ROLES } from '../../utils/constants';

const KEY = 'oj:last-manage-page';
const FALLBACK = '/admin/problems';
/** Pages staff can't open (their routes are admin-only on the server). */
const ADMIN_ONLY = ['/admin/users', '/admin/settings'];

const isAdminOnly = (path: string) => ADMIN_ONLY.some((p) => path === p || path.startsWith(`${p}/`));

/** Remember the Manage page the viewer is on, so `/admin` can return to it. */
export function rememberManagePage(path: string): void {
  if (!path.startsWith('/admin/')) return;
  try { localStorage.setItem(KEY, path); } catch { /* storage may be unavailable */ }
}

/** Where `/admin` should go: the last Manage page this role may open, else Problems. */
export function lastManagePage(role: string | undefined): string {
  try {
    const path = localStorage.getItem(KEY);
    if (path && path.startsWith('/admin/') && (role === USER_ROLES.ADMIN || !isAdminOnly(path))) return path;
  } catch { /* storage may be unavailable */ }
  return FALLBACK;
}
