import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger, format, transports, type Logger } from 'winston';
import Transport from 'winston-transport';
import { pushLog } from './log-bus';

class MemoryTransport extends Transport {
    log(info: { level: string; message: unknown }, callback: () => void): void {
        pushLog(info.level, String(info.message));
        callback();
    }
}

const memoryTransport = new MemoryTransport();

const initialLogsDir = join(process.cwd(), 'data', 'logs');
mkdirSync(initialLogsDir, { recursive: true });

const logger: Logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new transports.Console(),
        new transports.File({
            filename: join(initialLogsDir, 'app.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        }),
        memoryTransport,
    ],
});

/**
 * Applies the persisted log level and log directory after settings load.
 *
 * @param options - Log level and data directory
 */
export function configureLogger(options: { level?: string; dataDir: string }): void {
    if (options.level) {
        logger.level = options.level;
    }

    const logsDir = join(options.dataDir, 'logs');
    mkdirSync(logsDir, { recursive: true });

    logger.clear();
    logger.add(new transports.Console());
    logger.add(
        new transports.File({
            filename: join(logsDir, 'app.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        })
    );
    logger.add(memoryTransport);
}

const appLogger = logger.child({ label: 'app' });

/**
 * Returns the shared application logger.
 *
 * @returns Winston logger
 */
export function getLogger(): Logger {
    return appLogger;
}
