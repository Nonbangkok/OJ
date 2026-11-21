import multer from 'multer';
import path from 'path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
    AUTHOR_PROFILE_IMAGE,
    FILE_CONFIG,
    PROBLEM_UPLOAD_LIMITS,
    STATEMENT_ASSET,
    SUBMISSION_FORM_LIMITS,
    SUBMISSION_VALIDATION,
    USER_AVATAR,
} from '../constants';
import { AppError } from './errorHandler';
import { LESSON_LIMITS } from '../constants/lessons';
import { CHUNKED_BATCH_UPLOAD_MULTER_FILE_SIZE_BYTES } from '../services/chunkedBatchUploadService';
import { privateTempDir } from '../utils/privateTemp';

type MulterErrorMessages = Partial<Record<multer.ErrorCode, (error: multer.MulterError) => AppError>>;

/**
 * Runs a multer middleware and turns the multer errors listed in `messages`
 * into AppErrors that say what the route accepts. Any other error, including
 * the LIMIT_FILE_SIZE ones errorHandler maps to a 413 by field, passes through.
 */
const withMulterMessages = (middleware: RequestHandler, messages: MulterErrorMessages): RequestHandler =>
    (req: Request, res: Response, next: NextFunction): void => {
        middleware(req, res, (error?: unknown) => {
            const toAppError = error instanceof multer.MulterError ? messages[error.code] : undefined;
            next(toAppError ? toAppError(error as multer.MulterError) : error);
        });
    };

// POST /submit takes JSON or a multipart form of submitSchema's text fields.
// Any logged-in account reaches it, and busboy keeps every field in RAM until
// zod runs, so the form is capped to those fields, no files and a per-field
// byte cap that still holds the longest code the schema accepts. Multer stops
// at the first part past a limit and discards the rest of the body.
export const submissionFormUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 0,
        fields: SUBMISSION_FORM_LIMITS.MAX_FIELDS,
        parts: SUBMISSION_FORM_LIMITS.MAX_FIELDS,
        fieldSize: SUBMISSION_FORM_LIMITS.MAX_FIELD_BYTES,
    },
});

const tooManySubmissionFields = (): AppError => new AppError(
    `A submission form takes at most ${SUBMISSION_FORM_LIMITS.MAX_FIELDS} fields: `
    + SUBMISSION_FORM_LIMITS.FIELD_NAMES.join(', '),
    400,
);
const noSubmissionFiles = (): AppError => new AppError(
    'A submission takes no file uploads; send the code as the "code" text field',
    400,
);

export const parseSubmissionForm: RequestHandler = withMulterMessages(submissionFormUpload.none(), {
    LIMIT_FIELD_VALUE: (error) => new AppError(
        `Submission field "${error.field ?? ''}" is larger than ${SUBMISSION_FORM_LIMITS.MAX_FIELD_BYTES} bytes `
        + `(code is limited to ${SUBMISSION_VALIDATION.MAX_CODE_LENGTH} characters)`,
        413,
    ),
    LIMIT_FIELD_COUNT: tooManySubmissionFields,
    LIMIT_PART_COUNT: tooManySubmissionFields,
    LIMIT_FILE_COUNT: noSubmissionFiles,
    LIMIT_UNEXPECTED_FILE: noSubmissionFiles,
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

// PUT /profile/avatar (any logged-in account): one image file and nothing
// else, so no text field is ever buffered.
export const userAvatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: USER_AVATAR.MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, callback) => {
        if (!(USER_AVATAR.ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
            callback(new AppError('Unsupported user avatar type', 400));
            return;
        }
        callback(null, true);
    },
});

const avatarOnly = (): AppError => new AppError(
    `The avatar upload takes only the "${USER_AVATAR.FIELD_NAME}" image file`,
    400,
);

export const parseUserAvatarUpload: RequestHandler = withMulterMessages(
    userAvatarUpload.single(USER_AVATAR.FIELD_NAME),
    {
        LIMIT_FIELD_COUNT: avatarOnly,
        LIMIT_PART_COUNT: avatarOnly,
        LIMIT_FILE_COUNT: avatarOnly,
        LIMIT_UNEXPECTED_FILE: avatarOnly,
    },
);

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

// Staff lesson bundle import (POST /admin/lessons/import): one ZIP held in
// memory, no text fields (flags travel in the query string).
const lessonBundleUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LESSON_LIMITS.BUNDLE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
});
const lessonBundleOnly = (): AppError => new AppError(
    `The import takes only the "${LESSON_LIMITS.BUNDLE_FIELD_NAME}" ZIP file`,
    400,
);
export const parseLessonBundleUpload: RequestHandler = withMulterMessages(
    lessonBundleUpload.single(LESSON_LIMITS.BUNDLE_FIELD_NAME),
    {
        LIMIT_FILE_SIZE: () => new AppError(
            `The lessons bundle must not exceed ${LESSON_LIMITS.BUNDLE_MAX_BYTES / (1024 * 1024)} MiB`,
            413,
        ),
        LIMIT_FIELD_COUNT: lessonBundleOnly,
        LIMIT_PART_COUNT: lessonBundleOnly,
        LIMIT_FILE_COUNT: lessonBundleOnly,
        LIMIT_UNEXPECTED_FILE: lessonBundleOnly,
    },
);
