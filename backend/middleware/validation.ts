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
                schemas.query.parse(req.query);
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
