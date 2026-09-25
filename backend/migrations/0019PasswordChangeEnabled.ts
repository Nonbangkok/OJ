export const passwordChangeEnabledSql = `
-- Self-service password changes (user menu / profile "Change Password").
-- 'true' (default) preserves the existing behavior for every role; 'false'
-- restricts self-service changes to admins only (admin reset of other
-- users' passwords is unaffected). Stored in system_settings alongside
-- registration_enabled and site_access_mode so it rides the same
-- singleton-configuration conventions.
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('password_change_enabled', 'true')
ON CONFLICT (setting_key) DO NOTHING;
`;
