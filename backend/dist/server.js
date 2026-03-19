"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const connect_pg_simple_1 = __importDefault(require("connect-pg-simple"));
const db_1 = require("./db");
// import cors from 'cors';
// Import routes (Assuming they will be converted or handled by TS)
const adminController_1 = __importDefault(require("./controllers/adminController"));
const authController_1 = __importDefault(require("./controllers/authController"));
const problemController_1 = __importDefault(require("./controllers/problemController"));
const submissionController_1 = __importDefault(require("./controllers/submissionController"));
const contestController_1 = __importDefault(require("./controllers/contestController"));
const contestScheduler = require('./services/contestScheduler');
const app = (0, express_1.default)();
const PgStore = (0, connect_pg_simple_1.default)(express_session_1.default);
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;
app.use(express_1.default.json());
// app.use(cors({
//   origin: 'https://www.woi-grader.com',
//   // credentials: false,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
// }));
// PostgreSQL session store setup
app.use((0, express_session_1.default)({
    store: new PgStore({
        pool: db_1.pool, // Use the existing pg pool from db.ts
        tableName: 'user_sessions', // Name of the table to store sessions
    }),
    secret: process.env.SECRET_KEY || 'secret', // Use environment variable
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true for production
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use('/', authController_1.default);
app.use('/', adminController_1.default);
app.use('/', problemController_1.default);
app.use('/', submissionController_1.default);
app.use('/', contestController_1.default);
app.get('/', (req, res) => {
    res.send('Grader System API is running!');
});
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    // Start Contest Scheduler
    try {
        if (contestScheduler && typeof contestScheduler.start === 'function') {
            contestScheduler.start();
            console.log('✅ Contest Scheduler initialized successfully');
        }
    }
    catch (error) {
        console.error('❌ Failed to start Contest Scheduler:', error);
    }
});
//# sourceMappingURL=server.js.map