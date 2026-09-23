import { pino, type Logger, type LoggerOptions } from 'pino';
import type { Env } from './env';

/** Rutas que nunca deben aparecer en los logs (credenciales, cookies, tokens, PIN). */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-origin-verify"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'pin',
  'token',
  '*.password',
  '*.passwordHash',
  '*.pin',
  '*.pinHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  const options: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'panesypan-api' },
    redact: { paths: REDACTED_PATHS, censor: '[OCULTO]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
    };
  } else {
    options.formatters = { level: (label) => ({ level: label }) };
  }

  return pino(options);
}
