/**
 * Pino shim (admin)
 *
 * The reused worker file `services/worker/src/logger.ts` does
 * `import pino from 'pino'`. The admin tool is local-only and intentionally
 * does NOT depend on pino at runtime — admin code uses console.log/console.error
 * directly (see report.service.ts / report.controller.ts).
 *
 * To avoid pulling pino into admin's node_modules just to satisfy that one
 * worker import, this module is registered as the resolved target for `pino`
 * via `tsconfig.json` `paths` + `tsconfig-paths/register`. It exposes a
 * minimal no-op subset of the pino API surface that the worker logger touches
 * at module-eval time: a callable factory and `stdTimeFunctions.isoTime`.
 */

type Loggable = (...args: ReadonlyArray<unknown>) => void;

interface NoopLogger {
  level: string;
  fatal: Loggable;
  error: Loggable;
  warn: Loggable;
  info: Loggable;
  debug: Loggable;
  trace: Loggable;
  silent: Loggable;
  child: (...args: ReadonlyArray<unknown>) => NoopLogger;
}

function makeNoopLogger(): NoopLogger {
  const noop: Loggable = () => undefined;
  const logger: NoopLogger = {
    level: 'silent',
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
  };
  return logger;
}

interface PinoFactory {
  (...args: ReadonlyArray<unknown>): NoopLogger;
  stdTimeFunctions: {
    epochTime: () => string;
    unixTime: () => string;
    nullTime: () => string;
    isoTime: () => string;
  };
  destination: (...args: ReadonlyArray<unknown>) => Record<string, unknown>;
}

const factory = ((..._args: ReadonlyArray<unknown>): NoopLogger => makeNoopLogger()) as PinoFactory;

factory.stdTimeFunctions = {
  epochTime: () => '',
  unixTime: () => '',
  nullTime: () => '',
  isoTime: () => '',
};

factory.destination = () => ({});

export default factory;
export { factory as pino };
