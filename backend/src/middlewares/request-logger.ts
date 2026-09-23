import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

/** Solo se acepta un X-Request-Id entrante con formato seguro; si no, se genera uno nuevo. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Asigna un identificador a cada petición (header X-Request-Id) y registra la respuesta.
 * Solo se registran método, ruta y estado: nunca headers, cookies ni cuerpos.
 */
export function createRequestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    // Los health checks (UptimeRobot cada 5 min) no llenan los logs.
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
