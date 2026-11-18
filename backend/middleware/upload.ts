import multer from 'multer';
import path from 'path';
import { AUTHOR_PROFILE_IMAGE, FILE_CONFIG, STATEMENT_ASSET, USER_AVATAR } from '../constants';
import { AppError } from './errorHandler';
import { CHUNKED_BATCH_UPLOAD_MULTER_FILE_SIZE_BYTES } from '../services/chunkedBatchUploadService';
import { privateTempDir } from '../utils/privateTemp';

// Multer configuration for single file uploads (in memory)
export const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FILE_CONFIG.MAX_UPLOAD_SIZE_BYTES },
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

// Multer configuration for batch uploads (to disk). Uploads (batch ZIPs,
// chunk parts, DB dumps) are staged in one 0700 directory inside the private
// backend work root, never at a predictable path in the shared /tmp that
// judged programs can list or pre-create.
let diskUploadDirectory: Promise<string> | null = null;
const getDiskUploadDirectory = (): Promise<string> => {
    diskUploadDirectory ??= privateTempDir('uploads-').catch((error: unknown) => {
        diskUploadDirectory = null;
        throw error;
    });
    return diskUploadDirectory;
};

const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        getDiskUploadDirectory().then((uploadPath) => cb(null, uploadPath), (error: Error) => cb(error, ''));
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
