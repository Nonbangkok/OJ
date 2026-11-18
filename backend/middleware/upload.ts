import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AUTHOR_PROFILE_IMAGE, FILE_CONFIG, STATEMENT_ASSET, USER_AVATAR } from '../constants';
import { AppError } from './errorHandler';
import { PROBLEM_UPLOAD_LIMITS } from '../constants';
import { CHUNKED_BATCH_UPLOAD_MULTER_FILE_SIZE_BYTES } from '../services/chunkedBatchUploadService';

// Multer configuration for single file uploads (in memory)
export const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FILE_CONFIG.MAX_UPLOAD_SIZE_BYTES },
});

// The staff problem routes buffer uploads in RAM, so each gets its own cap
// instead of the 2 GiB disk-upload ceiling (errorHandler maps the multer
// LIMIT_FILE_SIZE error to a 413 naming the cap). No text fields are expected.
export const problemFilesZipUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PROBLEM_UPLOAD_LIMITS.FILES_ZIP_MAX_BYTES, files: 1, fields: 0 },
});

export const problemSingleRequestUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_BYTES, files: 2, fields: 0 },
});

export const authorProfileImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AUTHOR_PROFILE_IMAGE.MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, callback) => {
        if (!(AUTHOR_PROFILE_IMAGE.ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
            callback(new AppError('Unsupported author profile image type', 400));
            return;
        }
        callback(null, true);
    },
});

export const userAvatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: USER_AVATAR.MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, callback) => {
        if (!(USER_AVATAR.ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
            callback(new AppError('Unsupported user avatar type', 400));
            return;
        }
        callback(null, true);
    },
});

export const statementAssetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: STATEMENT_ASSET.MAX_FILE_BYTES },
    fileFilter: (_req, file, callback) => {
        if (!(STATEMENT_ASSET.ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
            callback(new AppError('Unsupported statement asset type', 400));
            return;
        }
        callback(null, true);
    },
});

// Multer configuration for batch uploads (to disk)
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // We'll use a temporary directory provided by the OS
        const uploadPath = path.join('/tmp', 'oj_uploads');

        // Ensure the directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid conflicts
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

export const diskUpload = multer({
    storage: diskStorage,
    limits: { fileSize: FILE_CONFIG.MAX_UPLOAD_SIZE_BYTES },
});

/** Chunk parts are disk-backed and capped below Cloudflare's request limit. */
export const chunkDiskUpload = multer({
    storage: diskStorage,
    limits: { fileSize: CHUNKED_BATCH_UPLOAD_MULTER_FILE_SIZE_BYTES },
});
