import { NextFunction, Request, Response } from 'express';

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

export const notFoundHandler = (req: Request, res: Response): void => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
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
