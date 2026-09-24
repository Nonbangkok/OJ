export const siteAccessModeSql = `
-- Site-level access mode: 'public' (default, preserves the existing
-- open-browsing behavior) or 'private' (authentication required for all
-- OJ content). Stored alongside registration_enabled in system_settings
-- so it rides the same singleton-configuration conventions.
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('site_access_mode', 'public')
ON CONFLICT (setting_key) DO NOTHING;
`;
