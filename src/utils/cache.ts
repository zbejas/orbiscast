import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { getLogger } from './logger';

const logger = getLogger();
let cacheDir = join(process.cwd(), 'data', 'cache');

/**
 * Points the cache at a data directory after boot.
 *
 * @param dataDir - Directory that owns the database, logs, and cache
 */
export function configureCache(dataDir: string): void {
    cacheDir = join(dataDir, 'cache');
    fs.mkdir(cacheDir, { recursive: true })
        .then(() => logger.debug(`Cache directory set to: ${cacheDir}`))
        .catch(err => logger.error(`Error creating cache directory: ${err}`));
}

/**
 * Returns the active cache directory.
 *
 * @returns Absolute cache path
 */
export function getCacheDir(): string {
    return cacheDir;
}

/**
 * Saves a file to the cache directory.
 *
 * @param filePath - Relative path within the cache directory
 * @param content - File content
 */
export async function cacheFile(filePath: string, content: Buffer): Promise<void> {
    const cachePath = join(cacheDir, filePath);
    logger.debug(`Caching file at: ${cachePath}`);
    try {
        await fs.mkdir(dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, content);
        logger.debug(`File cached successfully: ${cachePath}`);
    } catch (err) {
        logger.error(`Error caching file: ${err}`);
    }
}

/**
 * Retrieves a file from cache as a Buffer.
 *
 * @param filePath - Relative path within the cache directory
 * @returns File content or null
 */
export async function getCachedFile(filePath: string): Promise<Buffer | null> {
    const cachePath = join(cacheDir, filePath);
    try {
        return await fs.readFile(cachePath);
    } catch {
        logger.debug(`File not found: ${cachePath}`);
        return null;
    }
}

/**
 * Gets the absolute path to a cached file.
 *
 * @param filePath - Relative path within the cache directory
 * @returns Absolute path or null
 */
export async function getCachedFilePath(filePath: string): Promise<string | null> {
    const cachePath = join(cacheDir, filePath);
    try {
        await fs.access(cachePath);
        return cachePath;
    } catch {
        logger.debug(`File not found: ${cachePath}`);
        return null;
    }
}

/**
 * Clears every cached file.
 */
export async function clearCache(): Promise<void> {
    logger.debug(`Clearing cache directory: ${cacheDir}`);
    try {
        await fs.rm(cacheDir, { recursive: true, force: true });
        await fs.mkdir(cacheDir, { recursive: true });
        logger.debug('Cache directory cleared.');
    } catch (err) {
        logger.error(`Error clearing cache directory: ${err}`);
    }
}
