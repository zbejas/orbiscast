import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { syncPlaylistChannels, populateDatabaseFromXMLTV } from './index';
import { clearCache } from '../../utils/cache';

const logger = getLogger();

let refreshIntervalId: NodeJS.Timeout | null = null;

/**
 * Schedules periodic IPTV data refresh based on configuration.
 * Ensures only one scheduler runs at a time by clearing any existing intervals.
 */
export function scheduleIPTVRefresh(): void {
    if (refreshIntervalId) {
        logger.debug('Clearing existing IPTV refresh scheduler');
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }

    const refreshIntervalMs = config.REFRESH_IPTV * 60 * 1000;
    logger.info(`Scheduling IPTV refresh every ${config.REFRESH_IPTV} minutes`);

    refreshIntervalId = setInterval(async () => {
        logger.info('Refreshing IPTV data...');

        try {
            await syncPlaylistChannels(true);
            await populateDatabaseFromXMLTV(true);
            await clearCache();
            logger.info('IPTV data refreshed successfully');
        } catch (error) {
            logger.error(`Error refreshing IPTV data: ${error}`);
        }
    }, refreshIntervalMs);
}

/**
 * Stops the IPTV refresh scheduler if running.
 * Safe to call even if no scheduler is active.
 */
export function stopIPTVRefresh(): void {
    if (refreshIntervalId) {
        logger.info('Stopping IPTV refresh scheduler');
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    } else {
        logger.debug('No active IPTV refresh scheduler to stop');
    }
}
