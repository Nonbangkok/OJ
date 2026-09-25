import { query } from '../db';

/**
 * Site-level settings service.
 *
 * `site_access_mode` gates the whole OJ behind authentication when set to
 * 'private'. It is completely independent from per-problem visibility:
 * flipping the mode never touches problems.is_visible, and hidden-problem
 * permission logic still applies on top of it for authenticated users.
 *
 * The value is read on every public-content request, so a small in-process
 * cache keeps the DB load bounded. Mode changes propagate within
 * CACHE_TTL_MS without a server restart.
 */

export type SiteAccessMode = 'public' | 'private';

const SITE_ACCESS_MODE_KEY = 'site_access_mode';

/** How long a cached mode stays authoritative. Short enough that admin
 *  changes apply almost immediately; long enough to absorb hot paths. */
const CACHE_TTL_MS = 5000;

let cachedMode: SiteAccessMode | null = null;
let cachedAt = 0;

const parseMode = (value: string | undefined): SiteAccessMode =>
    value === 'private' ? 'private' : 'public';

/** Current site access mode. Defaults to 'public' (the historical behavior)
 *  when no row exists yet — a fresh or pre-migration install stays open. */
export const getSiteAccessMode = async (): Promise<SiteAccessMode> => {
    if (cachedMode !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedMode;
    }

    const result = await query<{ setting_value: string }>(
        'SELECT setting_value FROM system_settings WHERE setting_key = $1',
        [SITE_ACCESS_MODE_KEY],
    );
    const mode = parseMode(result.rows[0]?.setting_value);

    cachedMode = mode;
    cachedAt = Date.now();
    return mode;
};

/** Update the site access mode and refresh the cache immediately so the
 *  change takes effect on the very next request. */
export const updateSiteAccessMode = async (mode: SiteAccessMode): Promise<void> => {
    await query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2`,
        [SITE_ACCESS_MODE_KEY, mode],
    );

    cachedMode = mode;
    cachedAt = Date.now();
};

/** Test hook: drop the cache so the next read hits the DB. */
export const resetSiteAccessModeCache = (): void => {
    cachedMode = null;
    cachedAt = 0;
};

/**
 * Self-service password changes (PUT /profile/password). When 'false',
 * only admins may change their own password; user/staff must ask an
 * admin for a reset. The admin reset route is NOT gated by this setting.
 * Default 'true' preserves the historical behavior.
 */
const PASSWORD_CHANGE_ENABLED_KEY = 'password_change_enabled';

let cachedPasswordChangeEnabled: boolean | null = null;
let cachedPasswordChangeAt = 0;

/** Whether users/staff may change their own password. Defaults to true
 *  (the historical behavior) when no row exists yet. */
export const getPasswordChangeEnabled = async (): Promise<boolean> => {
    if (
        cachedPasswordChangeEnabled !== null &&
        Date.now() - cachedPasswordChangeAt < CACHE_TTL_MS
    ) {
        return cachedPasswordChangeEnabled;
    }

    const result = await query<{ setting_value: string }>(
        'SELECT setting_value FROM system_settings WHERE setting_key = $1',
        [PASSWORD_CHANGE_ENABLED_KEY],
    );
    const enabled =
        result.rows.length === 0 || result.rows[0].setting_value === 'true';

    cachedPasswordChangeEnabled = enabled;
    cachedPasswordChangeAt = Date.now();
    return enabled;
};

/** Update the setting and refresh the cache immediately so the change
 *  takes effect on the very next request. */
export const updatePasswordChangeEnabled = async (enabled: boolean): Promise<void> => {
    await query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2`,
        [PASSWORD_CHANGE_ENABLED_KEY, enabled.toString()],
    );

    cachedPasswordChangeEnabled = enabled;
    cachedPasswordChangeAt = Date.now();
};

/** Test hook: drop the cache so the next read hits the DB. */
export const resetPasswordChangeEnabledCache = (): void => {
    cachedPasswordChangeEnabled = null;
    cachedPasswordChangeAt = 0;
};
