import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { createLogger, format, transports } from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logsDir = join(__dirname, '../../data/logs');

fs.mkdir(logsDir, { recursive: true }).catch(err => console.error(`Error creating logs directory: ${err}`));

const logLevel = Bun.env.DEBUG?.toLowerCase() === 'true' ? 'debug' : 'info';
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

/**
 * Returns a configured logger instance for application use
 * @returns Logger instance with "app" label
 */
export function getLogger() {
    return logger.child({ label: "app" });
}
