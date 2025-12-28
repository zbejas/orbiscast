import axios from 'axios';
import { getLogger } from '../../utils/logger';
import { cacheFile, getCachedFile } from '../../utils/cache';

const logger = getLogger();

/**
 * Fetches data from a URL with retry logic and exponential backoff.
 * Implements automatic timeout handling and memory cleanup.
 * 
 * @param url - URL to fetch data from
 * @param cacheFileName - Name to use when caching the file
 * @returns Fetched content as Buffer or null if all retries failed
 */
export async function fetchWithRetry(url: string, cacheFileName: string): Promise<Buffer | null> {
    const maxRetries = 3;
    let retryDelay = 5;

    logger.info(`Downloading from ${url} to cache as ${cacheFileName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let abortController: AbortController | null = null;

        try {
            // Create abort controller for proper timeout handling
            abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                abortController?.abort();
            }, 30000);

            logger.info(`Download attempt ${attempt}/${maxRetries}...`);
            const response = await axios.get(url, {
                timeout: 30000,
                responseType: 'arraybuffer',  // Ensure binary data is handled correctly
                signal: abortController.signal,
                maxContentLength: 50 * 1024 * 1024, // 50MB limit
                maxBodyLength: 50 * 1024 * 1024
            });

            clearTimeout(timeoutId);

            if (response.data) {
                const content = Buffer.from(response.data);
                // Release response data from memory after conversion
                response.data = null;
                logger.info(`Downloaded ${content.length} bytes, caching as ${cacheFileName}`);
                try {
                    await cacheFile(cacheFileName, content);
                    logger.debug(`Successfully cached file ${cacheFileName}`);
                } catch (cacheError) {
                    logger.error(`Error caching file: ${cacheError}`);
                }
                return content;
            } else {
                logger.warn('Downloaded content was empty');
            }
        } catch (error) {
            // Check if request was aborted due to timeout
            if (axios.isCancel(error) || (error as any).name === 'AbortError') {
                logger.warn(`Request timeout on attempt ${attempt}`);
            } else if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || (error.response?.status ?? 0) >= 500)) {
                logger.warn(`Connection error on attempt ${attempt}: ${error.message}`);
            } else {
                logger.error(`Request error on attempt ${attempt}: ${(error as any).message}`);
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
            // Clean up abort controller
            if (abortController) {
                abortController = null;
            }
        }
    }
    return null;
}
