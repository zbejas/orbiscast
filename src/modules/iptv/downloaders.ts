import axios from 'axios';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import { cacheFile, getCachedFile } from '../../utils/cache';

const logger = getLogger();

/**
 * Returns a log-safe label for a remote URL. Credentials, query strings, and
 * path tokens are omitted.
 *
 * @param url - Remote URL
 * @returns Host-only label
 */
export function safeUrlLabel(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return 'invalid-url';
    }
}

/**
 * Fetches data with retries, exponential backoff, a 30s timeout, and a 50 MB
 * cap. On total failure it returns the last cached copy if one exists.
 *
 * @param url - URL to fetch
 * @param cacheFileName - Relative cache path
 * @returns Fetched content or null
 */
export async function fetchWithRetry(url: string, cacheFileName: string): Promise<Buffer | null> {
    const maxRetries = 3;
    let retryDelay = 5;

    logger.info(`Downloading from ${safeUrlLabel(url)} to cache as ${cacheFileName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let abortController: AbortController | null = null;

        try {
            abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                abortController?.abort();
            }, 30000);

            logger.info(`Download attempt ${attempt}/${maxRetries}...`);
            const response = await axios.get(url, {
                timeout: 30000,
                responseType: 'arraybuffer',
                signal: abortController.signal,
                maxContentLength: 50 * 1024 * 1024,
                maxBodyLength: 50 * 1024 * 1024,
            });

            clearTimeout(timeoutId);

            if (response.data) {
                const content = Buffer.from(response.data);
                response.data = null;
                logger.info(`Downloaded ${content.length} bytes, caching as ${cacheFileName}`);
                try {
                    await cacheFile(cacheFileName, content);
                } catch (cacheError) {
                    logger.error(`Error caching file: ${cacheError}`);
                }
                return content;
            }

            logger.warn('Downloaded content was empty');
        } catch (error) {
            if (axios.isCancel(error) || (error as { name?: string }).name === 'AbortError') {
                logger.warn(`Request timeout on attempt ${attempt}`);
            } else if (
                axios.isAxiosError(error) &&
                (error.code === 'ECONNABORTED' || (error.response?.status ?? 0) >= 500)
            ) {
                logger.warn(`Connection error on attempt ${attempt}: ${redactSecrets(error.message)}`);
            } else {
                logger.error(`Request error on attempt ${attempt}: ${redactSecrets((error as Error).message)}`);
            }

            if (attempt < maxRetries) {
                logger.info(`Retrying in ${retryDelay} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
                retryDelay *= 2;
            } else {
                logger.error('Maximum retries reached. Could not download content.');
                return await getCachedFile(cacheFileName);
            }
        } finally {
            abortController = null;
        }
    }
    return null;
}
