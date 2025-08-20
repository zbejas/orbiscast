import { config } from './utils/config';
import { downloadCacheAndFillDb, stopIPTVRefresh } from './modules/iptv';
import { getLogger } from './utils/logger';
import { client } from './utils/discord';
import { initializeStreamer } from './modules/streaming';

const logger = getLogger();

/**
 * Initialize and start the OrbisCast application
 * Performs database setup, initializes the streamer, and logs in the Discord bot
 */
async function startOrbisCast() {
    try {
        await initializeStreamer();
        await downloadCacheAndFillDb();
        logger.info('Attempting to log in OrbisCast...');
        await client.login(config.DISCORD_BOT_TOKEN);
        logger.info('OrbisCast logged in successfully');
    } catch (err) {
        logger.error(`Error: ${err}`);
    }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    try {
        stopIPTVRefresh();
        if (client.isReady()) {
            await client.destroy();
        }
        logger.info('Shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error(`Error during shutdown: ${error}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startOrbisCast();