import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

type SchemaTargets = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export const validate =
  (schemas: SchemaTargets) => (req: Request, res: Response, next: NextFunction) => {

    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        Object.assign(req.params, parsed);
      }

      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // req.query is a getter-only property on IncomingMessage, so mutate in-place
        Object.keys(req.query).forEach((k) => delete (req.query as any)[k]);
        Object.assign(req.query, parsed);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
