import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AUTHOR_PROFILE_IMAGE, PROBLEM_UPLOAD_LIMITS, STATEMENT_ASSET } from '../constants';

export class AppError extends Error {
    statusCode: number;
    details?: unknown;

    constructor(message: string, statusCode = 500, details?: unknown) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

export const asyncHandler = <
    TReq extends Request = Request,
    TRes extends Response = Response,
>(
    handler: (req: TReq, res: TRes, next: NextFunction) => Promise<unknown>,
) => {
    return (req: TReq, res: TRes, next: NextFunction): void => {
        handler(req, res, next).catch(next);
    };
};

/** 413 messages for the staff problem routes' in-memory upload caps, by field. */
const PROBLEM_UPLOAD_SIZE_MESSAGES: ReadonlyMap<string, string> = new Map([
    [PROBLEM_UPLOAD_LIMITS.FILES_ZIP_FIELD_NAME,
        `Header problem file ZIP must not exceed ${PROBLEM_UPLOAD_LIMITS.FILES_ZIP_MAX_MIB} MiB`],
    [PROBLEM_UPLOAD_LIMITS.PDF_FIELD_NAME,
        `Problem PDF must not exceed ${PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_MIB} MiB`],
    [PROBLEM_UPLOAD_LIMITS.TESTCASES_ZIP_FIELD_NAME,
        `Testcase ZIP must not exceed ${PROBLEM_UPLOAD_LIMITS.SINGLE_REQUEST_MAX_MIB} MiB in one request; larger ZIPs use the chunked upload`],
]);

/** body-parser's client errors (malformed JSON, unsupported encoding, ...). */
const isBodyParserClientError = (err: unknown): err is { type: string; status: number; message: string } => {
    if (typeof err !== 'object' || err === null) return false;
    const { type, status, expose } = err as { type?: unknown; status?: unknown; expose?: unknown };
    return typeof type === 'string' && expose === true
        && typeof status === 'number' && status >= 400 && status < 500;
};

export const notFoundHandler = (req: Request, res: Response): void => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
    if (
        typeof err === 'object'
        && err !== null
        && 'type' in err
        && err.type === 'entity.too.large'
    ) {
        res.status(413).json({ message: 'JSON request body is too large' });
        return;
    }

    if (isBodyParserClientError(err)) {
        res.status(err.status).json({
            message: err.type === 'entity.parse.failed' ? 'Malformed JSON request body' : err.message,
        });
        return;
    }

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE' && err.field === AUTHOR_PROFILE_IMAGE.FIELD_NAME) {
            res.status(413).json({
                message: `Author profile image must not exceed ${AUTHOR_PROFILE_IMAGE.MAX_UPLOAD_MIB} MiB`,
            });
            return;
        }
        if (err.code === 'LIMIT_FILE_SIZE' && err.field === STATEMENT_ASSET.FIELD_NAME) {
            res.status(413).json({
                message: `Statement asset must not exceed ${STATEMENT_ASSET.MAX_FILE_MIB} MiB`,
            });
            return;
        }
        const problemUploadMessage = err.field === undefined ? undefined : PROBLEM_UPLOAD_SIZE_MESSAGES.get(err.field);
        if (err.code === 'LIMIT_FILE_SIZE' && problemUploadMessage !== undefined) {
            res.status(413).json({ message: problemUploadMessage });
            return;
        }
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Uploaded file is too large. Maximum allowed size is 2GB.'
            : err.message;
        res.status(400).json({ message });
        return;
    }

    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof AppError ? err.message : 'Internal server error';

    if (statusCode >= 500) {
        console.error('Unhandled error:', err);
    }

    if (err instanceof AppError && err.details !== undefined) {
        res.status(statusCode).json({ message, details: err.details });
        return;
    }

    res.status(statusCode).json({ message });
};
