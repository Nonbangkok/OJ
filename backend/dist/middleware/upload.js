"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.diskUpload = exports.memoryUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Multer configuration for single file uploads (in memory)
exports.memoryUpload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Multer configuration for batch uploads (to disk)
const diskStorage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        // We'll use a temporary directory provided by the OS
        const uploadPath = path_1.default.join('/tmp', 'oj_uploads');
        // Ensure the directory exists
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid conflicts
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
exports.diskUpload = (0, multer_1.default)({ storage: diskStorage });
//# sourceMappingURL=upload.js.map