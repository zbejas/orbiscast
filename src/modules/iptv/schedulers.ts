import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { fillDbChannels, fillDbProgrammes } from './index';
import { clearCache } from '../../utils/cache';

const logger = getLogger();

let refreshIntervalId: NodeJS.Timeout | null = null;

/**
 * Schedules periodic IPTV data refresh based on configuration.
 * Ensures only one scheduler runs at a time.
 */
export function scheduleIPTVRefresh() {
    // Clear any existing interval to prevent memory leaks
    if (refreshIntervalId) {
        logger.debug('Clearing existing IPTV refresh scheduler');
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }

    const refreshInterval = config.REFRESH_IPTV * 60 * 1000; // Convert minutes to milliseconds
    logger.info(`Scheduling IPTV refresh every ${config.REFRESH_IPTV} minutes`);

    refreshIntervalId = setInterval(async () => {
        logger.info('Refreshing IPTV data...');
        try {
            // Only refresh data, don't call downloadCacheAndFillDb which would create another scheduler
            await fillDbChannels(true);
            await fillDbProgrammes(true);
            await clearCache();
            logger.info('IPTV data refreshed successfully');
        } catch (error) {
            logger.error(`Error refreshing IPTV data: ${error}`);
        }
    }, refreshInterval);
}

/**
 * Stops the IPTV refresh scheduler if running
 */
export function stopIPTVRefresh() {
    if (refreshIntervalId) {
        logger.info('Stopping IPTV refresh scheduler');
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }
}
