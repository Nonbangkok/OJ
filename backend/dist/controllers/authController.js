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
const db = __importStar(require("../db"));
const constants_1 = require("../constants");
const router = express_1.default.Router();
router.post('/register', [
    (0, express_validator_1.body)('username').isLength({ min: constants_1.USER_VALIDATION.MIN_USERNAME_LENGTH }).trim().escape(),
    (0, express_validator_1.body)('password').isLength({ min: constants_1.USER_VALIDATION.MIN_PASSWORD_LENGTH })
], async (req, res) => {
    try {
        // Check if registration is enabled
        const regSettings = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'");
        const isRegistrationEnabled = regSettings.rows.length === 0 || regSettings.rows[0].setting_value === 'true';
        if (!isRegistrationEnabled) {
            return res.status(403).json({ message: 'Registration is currently disabled.' });
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { username, password } = req.body;
        // Check if username already exists
        const existingUser = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        // Hash password
        const saltRounds = constants_1.SECURITY_CONFIG.SALT_ROUNDS;
        const hashedPassword = await bcrypt_1.default.hash(password, saltRounds);
        // Insert new user
        const result = await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, hashedPassword]);
        res.status(201).json({
            message: 'User registered successfully',
            user: result.rows[0]
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// PUBLIC facing endpoint to check registration status
router.get('/settings/registration', async (req, res) => {
    try {
        const result = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'");
        if (result.rows.length === 0) {
            return res.json({ enabled: true });
        }
        res.json({ enabled: result.rows[0].setting_value === 'true' });
    }
    catch (error) {
        // On error, default to disabled for security.
        console.error('Error fetching public registration setting:', error);
        res.json({ enabled: false });
    }
});
router.post('/login', [
    (0, express_validator_1.body)('username').trim().escape(),
    (0, express_validator_1.body)('password').notEmpty()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    try {
        // Find user by username
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }
        const user = result.rows[0];
        // Check password
        const isValidPassword = await bcrypt_1.default.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Wrong Password' });
        }
        // Create session
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role; // Use role instead of isAdmin
        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                role: user.role, // Send role to frontend
            }
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Error logging out' });
        }
        res.json({ message: 'Logout successful' });
    });
});
router.get('/me', (req, res) => {
    if (req.session.userId) {
        res.json({
            isAuthenticated: true,
            user: {
                id: req.session.userId,
                username: req.session.username,
                role: req.session.role, // Use role
            }
        });
    }
    else {
        res.json({ isAuthenticated: false });
    }
});
exports.default = router;
//# sourceMappingURL=authController.js.map