import type { ApiErrorResponse, ErrorCode } from '@panesypan/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  unexpected: boolean;
}

/** Errores que genera express.json() (body-parser) al leer el cuerpo. */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error &&
    typeof (error as Partial<BodyParserError>).type === 'string' &&
    typeof (error as Partial<BodyParserError>).status === 'number'
  );
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      unexpected: false,
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      unexpected: false,
    };
  }
  if (isBodyParserError(error)) {
    if (error.type === 'entity.too.large') {
      return {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'La solicitud es demasiado grande',
        unexpected: false,
      };
    }
    if (error.type === 'entity.parse.failed') {
      return {
        status: 400,
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no es un JSON válido',
        unexpected: false,
      };
    }
    if (error.status >= 400 && error.status < 500) {
      return {
        status: error.status,
        code: 'BAD_REQUEST',
        message: 'Solicitud inválida',
        unexpected: false,
      };
    }
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Ocurrió un error inesperado. Intenta de nuevo.',
    unexpected: true,
  };
}

/**
 * Manejador central de errores. En producción nunca expone mensajes internos ni stack traces;
 * el cliente recibe el `requestId` para poder rastrear el error en los logs.
 */
export function createErrorHandler(
  nodeEnv: 'development' | 'test' | 'production',
): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const normalized = normalizeError(error);
    if (normalized.unexpected) {
      req.log.error({ err: error }, 'Error no controlado');
    }

    const body: ApiErrorResponse = {
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId: typeof req.id === 'string' ? req.id : undefined,
      },
    };
    if (normalized.details !== undefined) {
      body.error.details = normalized.details;
    } else if (normalized.unexpected && nodeEnv === 'development' && error instanceof Error) {
      // Solo en desarrollo local, para depurar más rápido.
      body.error.details = { message: error.message, stack: error.stack };
    }

    res.status(normalized.status).json(body);
  };
}
