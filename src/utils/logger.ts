import { join } from 'path';
import { promises as fs } from 'fs';
import { createLogger, format, transports } from 'winston';

// __dirname is available in CommonJS
const logsDir = join(__dirname, '../../data/logs');

fs.mkdir(logsDir, { recursive: true }).catch(err => console.error(`Error creating logs directory: ${err}`));

const logLevel = process.env.DEBUG?.toLowerCase() === 'true' ? 'debug' : 'info';
const logFile = join(logsDir, 'app.log');

const logger = createLogger({
    level: logLevel,
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new transports.File({ filename: logFile, maxsize: 10485760, maxFiles: 5 }),
        new transports.Console()
    ]
});

// Cache the logger instance
const appLogger = logger.child({ label: "app" });

/**
 * Returns a configured logger instance for application use
 * @returns Logger instance with "app" label
 */
export function getLogger() {
    return appLogger;
}
