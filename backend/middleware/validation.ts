import { NextFunction, Request, Response } from 'express';
import { z, ZodSchema } from 'zod';

interface ValidateRequestSchemas {
    body?: ZodSchema;
    params?: ZodSchema;
    query?: ZodSchema;
}

/**
 * Runtime request validator that keeps runtime schema and static types
 * aligned. Parsed data is written back to req for downstream usage.
 */
export const validateRequest = (schemas: ValidateRequestSchemas) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            if (schemas.body) {
                req.body = schemas.body.parse(req.body);
            }

            if (schemas.params) {
                schemas.params.parse(req.params);
            }

            if (schemas.query) {
                // Express 5 exposes req.query through a getter that re-parses
                // on every access, so mutating it in place is a no-op. Redefine
                // it as a plain value property so Zod defaults and coercions
                // are visible to downstream handlers instead of every
                // controller re-declaring them.
                const parsed = schemas.query.parse(req.query);
                Object.defineProperty(req, 'query', {
                    value: parsed,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            }

            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    message: 'Validation failed',
                    errors: error.issues,
                });
                return;
            }

            next(error);
        }
    };
};
