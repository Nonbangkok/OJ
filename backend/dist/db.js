"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = exports.query = void 0;
const pg_1 = __importDefault(require("pg"));
const { Pool } = pg_1.default;
// When running in Docker, Docker Compose injects the DATABASE_URL directly.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // When connecting container-to-container on a private Docker network like in this
    // docker-compose setup, SSL is not necessary as the network is isolated.
    // The official Postgres image doesn't enable SSL by default.
    ssl: false,
});
exports.pool = pool;
const query = (text, params) => pool.query(text, params);
exports.query = query;
//# sourceMappingURL=db.js.map