import { config as dotenvConfig } from 'dotenv';
import { getLogger } from './logger';
import { downloadCacheAndFillDb } from './database';

const logger = getLogger();

class Config {
    PLAYLIST: string;
    XMLTV: string;
    REFRESH_IPTV: number;
    DEFAULT_STREAM_TIMEOUT: number;
    RAM_CACHE: boolean;
    DISCORD_BOT_TOKEN: string;
    DISCORD_USER_TOKEN: string;
    GUILD: string;
    DEFAULT_TEXT_CHANNEL: string;
    DEBUG: boolean;
    CACHE_DIR: string;

    constructor() {
        logger.info("Loading environment variables");
        dotenvConfig();

        const env = process.env;
        this.PLAYLIST = env.PLAYLIST?.trim() || '';
        this.XMLTV = env.XMLTV?.trim() || '';
        this.REFRESH_IPTV = parseInt(env.REFRESH_IPTV?.trim() || '1440');
        this.DEFAULT_STREAM_TIMEOUT = parseInt(env.DEFAULT_STREAM_TIMEOUT?.trim() || '10');
        this.RAM_CACHE = env.RAM_CACHE?.trim().toLowerCase() === 'true';
        this.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN?.trim() || '';
        this.DISCORD_USER_TOKEN = env.DISCORD_USER_TOKEN?.trim() || '';
        this.GUILD = env.GUILD?.trim() || '0';
        this.DEFAULT_TEXT_CHANNEL = env.DEFAULT_TEXT_CHANNEL?.trim() || '0';
        this.DEBUG = env.DEBUG?.trim().toLowerCase() === 'true';
        this.CACHE_DIR = env.CACHE_DIR?.trim() || (this.RAM_CACHE ? '/dev/shm/orbiscast' : '../cache');

        // Log the loaded GUILD ID for debugging
        logger.info(`Loaded GUILD ID: ${this.GUILD}`);

        if (!this.validateEnvVars()) {
            logger.error("Failed to load environment variables");
            logger.debug(`Environment variables: ${env}`);
            return;
        }

        logger.info("Successfully loaded environment variables");

        // Log the configuration values for debugging
        logger.debug(`Configuration: ${JSON.stringify(this, null, 2)}`);
    }

    private validateEnvVars(): boolean {
        const requiredVars = ['PLAYLIST', 'XMLTV', 'DISCORD_BOT_TOKEN', 'DISCORD_USER_TOKEN', 'GUILD', 'DEFAULT_TEXT_CHANNEL'];
        let allVarsSet = true;

        requiredVars.forEach(varName => {
            if (!this[varName as keyof Config]) {
                logger.error(`${varName} environment variable not set`);
                allVarsSet = false;
            }
        });

        return allVarsSet;
    }
}

export const config = new Config();
