"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const bcrypt_1 = __importDefault(require("bcrypt"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const constants_1 = require("../constants");
const upload_1 = require("../middleware/upload");
const router = express_1.default.Router();
const execPromise = (0, util_1.promisify)(child_process_1.exec);
// Admin API Endpoints
router.get('/admin/users', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, role, created_at FROM users ORDER BY id');
        res.json(result.rows);
    }
    catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Error fetching users' });
    }
});
router.post('/admin/users', auth_1.requireAuth, auth_1.requireAdmin, [
    (0, express_validator_1.body)('username').isLength({ min: constants_1.USER_VALIDATION.MIN_USERNAME_LENGTH }).trim().escape(),
    (0, express_validator_1.body)('password').isLength({ min: constants_1.USER_VALIDATION.MIN_PASSWORD_LENGTH }),
    (0, express_validator_1.body)('role').isIn([constants_1.USER_ROLES.USER, constants_1.USER_ROLES.STAFF])
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { username, password, role } = req.body;
    try {
        const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        const saltRounds = constants_1.SECURITY_CONFIG.SALT_ROUNDS;
        const hashedPassword = await bcrypt_1.default.hash(password, saltRounds);
        const result = await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role', [username, hashedPassword, role]);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Error creating user by admin:', error);
        res.status(500).json({ message: 'Error creating user' });
    }
});
router.put('/admin/users/:id', auth_1.requireAuth, auth_1.requireAdmin, [
    (0, express_validator_1.body)('username').isLength({ min: constants_1.USER_VALIDATION.MIN_USERNAME_LENGTH }).trim().escape(),
    (0, express_validator_1.body)('role').isIn([constants_1.USER_ROLES.USER, constants_1.USER_ROLES.STAFF, constants_1.USER_ROLES.ADMIN]) // <-- Allow 'admin' role
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { id } = req.params;
    const { username, role } = req.body;
    // Prevent admin from editing their own account
    if (req.session.userId == id) {
        return res.status(403).json({ message: 'Admins cannot edit their own account.' });
    }
    try {
        // Fetch the user being edited to check their username
        const userToEditRes = await db.query('SELECT username FROM users WHERE id = $1', [id]);
        if (userToEditRes.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (userToEditRes.rows[0].username === 'Nonbangkok') {
            return res.status(403).json({ message: 'The "Nonbangkok" account cannot be edited.' });
        }
        // Check if the new username is already taken by another user
        const existingUser = await db.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, id]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'Username is already taken.' });
        }
        const result = await db.query('UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role', [username, role, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error(`Error updating user ${id}:`, error);
        if (error.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'Username is already taken.' });
        }
        res.status(500).json({ message: 'Error updating user' });
    }
});
router.delete('/admin/users/:id', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    // Prevent admin from deleting their own account
    if (req.session.userId == id) {
        return res.status(403).json({ message: 'Admins cannot delete their own account.' });
    }
    try {
        // Fetch the user being deleted to check their username
        const userToDeleteRes = await db.query('SELECT username FROM users WHERE id = $1', [id]);
        if (userToDeleteRes.rows.length === 0) {
            // User already doesn't exist, so we can consider the delete successful.
            return res.status(200).json({ message: `User ${id} deleted successfully` });
        }
        if (userToDeleteRes.rows[0].username === 'Nonbangkok') {
            return res.status(403).json({ message: 'The "Nonbangkok" account cannot be deleted.' });
        }
        // We also need to handle submissions from this user.
        // For simplicity, we can just delete them. A better approach might be to anonymize them.
        await db.query('DELETE FROM submissions WHERE user_id = $1', [id]);
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: `User ${id} deleted successfully` });
    }
    catch (error) {
        console.error(`Error deleting user ${id}:`, error);
        res.status(500).json({ message: 'Error deleting user' });
    }
});
router.post('/admin/users/batch', auth_1.requireAuth, auth_1.requireAdmin, [
    (0, express_validator_1.body)('prefix').isLength({ min: 1 }).trim().escape(),
    (0, express_validator_1.body)('count').isInt({ min: 1, max: constants_1.USER_VALIDATION.BATCH_MAX_COUNT }) // Limit to 100 users at a time for performance
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { prefix, count } = req.body;
    const generatedUsers = [];
    const saltRounds = 10;
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (let i = 1; i <= count; i++) {
            const username = `${prefix}-${i.toString().padStart(2, '0')}`;
            const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
            let password = '';
            for (let j = 0; j < constants_1.USER_VALIDATION.RANDOM_PASSWORD_LENGTH; j++) {
                password += charset.charAt(Math.floor(Math.random() * charset.length));
            }
            const hashedPassword = await bcrypt_1.default.hash(password, saltRounds);
            const existingUser = await client.query('SELECT id FROM users WHERE username = $1', [username]);
            if (existingUser.rows.length > 0) {
                // This username already exists, we must abort the transaction.
                // We could also choose to skip, but aborting is safer to avoid partial creations.
                await client.query('ROLLBACK');
                return res.status(409).json({ message: `Username '${username}' already exists. Aborting operation.` });
            }
            await client.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [username, hashedPassword, 'user']);
            generatedUsers.push({ username, password });
        }
        await client.query('COMMIT');
        res.status(201).json({ message: `${count} users created successfully.`, users: generatedUsers });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error during batch user creation:', error);
        res.status(500).json({ message: 'An error occurred during batch user creation.' });
    }
    finally {
        client.release();
    }
});
router.get('/admin/authors', auth_1.requireAuth, auth_1.requireStaffOrAdmin, async (req, res) => {
    try {
        const result = await db.query("SELECT id, username FROM users WHERE role = 'admin' OR role = 'staff' ORDER BY username");
        res.json(result.rows);
    }
    catch (error) {
        console.error('Error fetching authors:', error);
        res.status(500).json({ message: 'Error fetching authors' });
    }
});
router.post('/admin/database/import', auth_1.requireAuth, auth_1.requireAdmin, upload_1.diskUpload.single('databaseDump'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No database dump file uploaded.' });
    }
    try {
        const dbName = process.env.PGDATABASE;
        const dbUser = process.env.PGUSER;
        const dbHost = process.env.PGHOST;
        const dbPort = process.env.PGPORT;
        const dumpFilePath = req.file.path; // Path to the uploaded file
        // Determine if it's a plain SQL file or a custom/tar dump
        const fileExtension = path_1.default.extname(req.file.originalname).toLowerCase();
        let importCommand = '';
        if (fileExtension === '.sql') {
            // For plain SQL files, use psql
            importCommand = `PGPASSWORD=${process.env.PGPASSWORD} psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f ${dumpFilePath} -v ON_ERROR_STOP=1`;
        }
        else if (fileExtension === '.dump' || fileExtension === '.tar') {
            // For custom/tar format dumps, use pg_restore
            importCommand = `PGPASSWORD=${process.env.PGPASSWORD} pg_restore -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v ${dumpFilePath}`;
        }
        else {
            fs_1.default.unlink(dumpFilePath, (unlinkErr) => {
                if (unlinkErr)
                    console.error('Error deleting unsupported dump file:', unlinkErr);
            });
            return res.status(400).json({ message: 'Unsupported file type. Only .sql, .dump, or .tar files are allowed.' });
        }
        // IMPORTANT: Drop all existing tables before importing to ensure a clean state.
        console.log('Dropping existing tables before import...');
        // Drop Contest tables first
        await db.query('DROP TABLE IF EXISTS contest_scoreboards CASCADE;');
        await db.query('DROP TABLE IF EXISTS contest_problems CASCADE;');
        await db.query('DROP TABLE IF EXISTS contest_submissions CASCADE;');
        await db.query('DROP TABLE IF EXISTS contest_participants CASCADE;');
        await db.query('DROP TABLE IF EXISTS contests CASCADE;');
        // Drop main tables
        await db.query('DROP TABLE IF EXISTS submissions CASCADE;');
        await db.query('DROP TABLE IF EXISTS testcases CASCADE;');
        await db.query('DROP TABLE IF EXISTS problems CASCADE;');
        await db.query('DROP TABLE IF EXISTS users CASCADE;');
        await db.query('DROP TABLE IF EXISTS user_sessions CASCADE;');
        await db.query('DROP TABLE IF EXISTS system_settings CASCADE;');
        console.log(`Executing database import command: ${importCommand}`);
        await execPromise(importCommand);
        res.status(200).json({ message: 'Database imported successfully.' });
    }
    catch (error) {
        console.error('Error during database import:', error);
        res.status(500).json({ message: 'Failed to import database.', error: error.message });
    }
    finally {
        // Clean up the temporary dump file in all cases
        if (req.file && fs_1.default.existsSync(req.file.path)) {
            fs_1.default.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr)
                    console.error('Error deleting temporary dump file:', unlinkErr);
            });
        }
    }
});
router.post('/admin/database/export', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
    try {
        const dbName = process.env.PGDATABASE;
        const dbUser = process.env.PGUSER;
        const dbHost = process.env.PGHOST;
        const dbPort = process.env.PGPORT;
        // Use a temporary file to store the dump
        const dumpFilePath = path_1.default.join('/tmp', `db_backup_${Date.now()}.sql`);
        const pgDumpCommand = `PGPASSWORD=${process.env.PGPASSWORD} pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -f ${dumpFilePath}`;
        console.log(`Executing pg_dump command: ${pgDumpCommand}`);
        await execPromise(pgDumpCommand);
        // Send the file as a download
        res.download(dumpFilePath, `oj_backup_${Date.now()}.sql`, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Error downloading backup file.' });
                }
            }
            // Clean up the temporary dump file
            fs_1.default.unlink(dumpFilePath, (unlinkErr) => {
                if (unlinkErr)
                    console.error('Error deleting temp dump file:', unlinkErr);
            });
        });
    }
    catch (error) {
        console.error('Error during database export:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Failed to export database.', error: error.message });
        }
    }
});
router.get('/admin/settings/registration', auth_1.requireAuth, auth_1.requireAdmin, async (req, res) => {
    try {
        const result = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'");
        if (result.rows.length === 0) {
            return res.json({ enabled: true });
        }
        res.json({ enabled: result.rows[0].setting_value === 'true' });
    }
    catch (error) {
        console.error('Error fetching registration setting:', error);
        res.status(500).json({ message: 'Error fetching settings' });
    }
});
router.put('/admin/settings/registration', auth_1.requireAuth, auth_1.requireAdmin, [
    (0, express_validator_1.body)('enabled').isBoolean()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { enabled } = req.body;
    try {
        await db.query("UPDATE system_settings SET setting_value = $1 WHERE setting_key = 'registration_enabled'", [enabled.toString()]);
        res.status(200).json({ message: 'Registration setting updated successfully.' });
    }
    catch (error) {
        console.error('Error updating registration setting:', error);
        res.status(500).json({ message: 'Error updating setting' });
    }
});
exports.default = router;
//# sourceMappingURL=adminController.js.map