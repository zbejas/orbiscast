import { promises as fs } from 'fs';
import { join } from 'path';
import { getLogger } from './logger';
import { config } from './config';

const logger = getLogger();
const cacheDir = config.CACHE_DIR;

// Initialize cache directory on module load
fs.mkdir(cacheDir, { recursive: true })
    .then(() => logger.debug(`Cache directory set to: ${cacheDir}`))
    .catch(err => logger.error(`Error creating cache directory: ${err}`));

/**
 * Saves a file to the cache directory
 * @param filePath - Relative path within cache directory
 * @param content - File content as Buffer
 */
export async function cacheFile(filePath: string, content: Buffer): Promise<void> {
    const cachePath = join(cacheDir, filePath);
    logger.debug(`Caching file at: ${cachePath}`);
    try {
        await fs.writeFile(cachePath, content);
        logger.debug(`File cached successfully: ${cachePath}`);
    } catch (err) {
        logger.error(`Error caching file: ${err}`);
    }
}

/**
 * Retrieves a file from cache as Buffer
 * @param filePath - Relative path within cache directory
 * @returns File content as Buffer or null if not found
 */
export async function getCachedFile(filePath: string): Promise<Buffer | null> {
    const cachePath = join(cacheDir, filePath);
    logger.debug(`Retrieving cached file from: ${cachePath}`);
    try {
        return await fs.readFile(cachePath);
    } catch {
        logger.debug(`File not found: ${cachePath}`);
        return null;
    }
}

/**
 * Gets the absolute path to a cached file
 * @param filePath - Relative path within cache directory
 * @returns Absolute path to file or null if not found
 */
export async function getCachedFilePath(filePath: string): Promise<string | null> {
    const cachePath = join(cacheDir, filePath);
    logger.debug(`Retrieving cached file from: ${cachePath}`);
    try {
        await fs.access(cachePath);
        return cachePath;
    } catch {
        logger.debug(`File not found: ${cachePath}`);
        return null;
    }
}

/**
 * Clears all cached files
 */
export async function clearCache(): Promise<void> {
    logger.debug(`Clearing cache directory: ${cacheDir}`);
    try {
        await fs.rm(cacheDir, { recursive: true, force: true });
        await fs.mkdir(cacheDir, { recursive: true });
        logger.debug("Cache directory cleared.");
    } catch (err) {
        logger.error(`Error clearing cache directory: ${err}`);
    }
}
