/**
 * Lightweight structured logger.
 *
 * Emits single-line JSON so Docker log drivers / log shippers can parse
 * fields without regex-ing emoji-prefixed console output. Falls back to
 * plain text when NODE_ENV !== 'production' to keep local `npm run dev`
 * output human-readable, and Jest keeps its console mocking intact
 * (logger wraps console underneath).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

const write = (level: LogLevel, message: string, fields?: LogFields): void => {
  const hasFields = fields !== undefined && Object.keys(fields).length > 0;

  if (isProduction()) {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...fields,
    });
    if (level === 'error') {
      console.error(entry);
    } else if (level === 'warn') {
      console.warn(entry);
    } else {
      console.log(entry);
    }
    return;
  }

  const suffix = hasFields
    ? ' ' + Object.entries(fields!)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(' ')
    : '';
    const line = `[${level}] ${message}${suffix}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

const formatValue = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export const logger = {
  debug: (message: string, fields?: LogFields): void => {
    if (isProduction()) {
      return; // debug noise is dev-only
    }
    write('debug', message, fields);
  },
  info: (message: string, fields?: LogFields): void => write('info', message, fields),
  warn: (message: string, fields?: LogFields): void => write('warn', message, fields),
  error: (message: string, fields?: LogFields): void => write('error', message, fields),
};
