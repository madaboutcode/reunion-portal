const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

/**
 * Parse a raw env string into a valid LogLevel, falling back to the default.
 */
export function parseLogLevel(raw: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (raw && raw in LEVELS) return raw as LogLevel;
  return fallback;
}

export function createLogger(tag: string, level: LogLevel = 'info') {
  const threshold = LEVELS[level];

  function emit(lvl: LogLevel, consoleMethod: (...args: unknown[]) => void, msg: string, extra?: Record<string, unknown>) {
    if (LEVELS[lvl] < threshold) return;
    consoleMethod(JSON.stringify({ level: lvl, tag, msg, ...extra }));
  }

  return {
    debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', console.debug, msg, extra),
    info:  (msg: string, extra?: Record<string, unknown>) => emit('info', console.log, msg, extra),
    warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn', console.warn, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit('error', console.error, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
