import { pino } from 'pino';

/** Structured JSON logger with secret redaction. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'pramaan-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.refreshToken',
      '*.accessToken',
      '*.password_hash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});
