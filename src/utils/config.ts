import { getLogger } from './logger';

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
    DEBUG: boolean;
    CACHE_DIR: string;
    MINIMIZE_LATENCY: boolean;
    BITRATE_VIDEO: number;
    BITRATE_VIDEO_MAX: number;

    constructor() {
        logger.info('Loading environment variables');

        const env = Bun.env;

        // IPTV configuration
        this.PLAYLIST = env.PLAYLIST?.trim() || '';
        this.XMLTV = env.XMLTV?.trim() || '';
        this.REFRESH_IPTV = parseInt(env.REFRESH_IPTV?.trim() || '1440');
        this.DEFAULT_STREAM_TIMEOUT = parseInt(env.DEFAULT_STREAM_TIMEOUT?.trim() || '10');

        // Cache configuration
        this.RAM_CACHE = env.RAM_CACHE?.trim().toLowerCase() !== 'false' || false;
        this.CACHE_DIR = (this.RAM_CACHE ? '/dev/shm/orbiscast' : env.CACHE_DIR?.trim()) || '../cache';

        // Discord configuration
        this.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN?.trim() || '';
        this.DISCORD_USER_TOKEN = env.DISCORD_USER_TOKEN?.trim() || '';
        this.GUILD = env.GUILD?.trim() || '0';

        // Streaming configuration
        this.MINIMIZE_LATENCY = env.MINIMIZE_LATENCY?.trim().toLowerCase() !== 'false';
        this.BITRATE_VIDEO = parseInt(env.BITRATE_VIDEO?.trim() || '5000');
        this.BITRATE_VIDEO_MAX = parseInt(env.BITRATE_VIDEO_MAX?.trim() || '7500');

        // Debug configuration
        this.DEBUG = env.DEBUG?.trim().toLowerCase() === 'true';

        logger.info(`Loaded GUILD ID: ${this.GUILD}`);

        if (!this.validateEnvVars()) {
            logger.error('Failed to load environment variables');
            logger.debug(`Environment variables: ${env}`);
            return;
        }

        logger.info('Successfully loaded environment variables');
        logger.info(`Debug mode is set to: ${this.DEBUG}`);
        logger.debug(`Configuration: ${JSON.stringify(this.getSanitizedConfig(), null, 2)}`);
    }

    /**
     * Validates that all required environment variables are set
     * @returns True if all required variables are set, false otherwise
     */
    private validateEnvVars(): boolean {
        // Either PLAYLIST or (XMLTV + STREAM_BASE_URL) must be set
        const requiredVars = ['DISCORD_BOT_TOKEN', 'DISCORD_USER_TOKEN', 'GUILD'];
        let allVarsSet = true;

        requiredVars.forEach(varName => {
            if (!this[varName as keyof Config]) {
                logger.error(`${varName} environment variable not set`);
                allVarsSet = false;
            }
        });

        return allVarsSet;
    }

    /**
     * Creates a sanitized version of the config for logging, with sensitive values hidden
     * @returns Sanitized configuration object
     */
    private getSanitizedConfig(): Record<string, any> {
        const sanitized = { ...this };

        if (sanitized.PLAYLIST) {
            sanitized.PLAYLIST = this.obfuscateString(sanitized.PLAYLIST, true);
        }
        if (sanitized.XMLTV) {
            sanitized.XMLTV = this.obfuscateString(sanitized.XMLTV, true);
        }

        if (sanitized.DISCORD_BOT_TOKEN) {
            sanitized.DISCORD_BOT_TOKEN = this.obfuscateString(sanitized.DISCORD_BOT_TOKEN);
        }
        if (sanitized.DISCORD_USER_TOKEN) {
            sanitized.DISCORD_USER_TOKEN = this.obfuscateString(sanitized.DISCORD_USER_TOKEN);
        }

        return sanitized;
    }

    /**
     * Obfuscates a string for display in logs
     * @param input - The string to obfuscate
     * @param full_obfuscation - Whether to obfuscate the entire string or leave the last 4 characters visible
     * @returns Obfuscated string
     */
    private obfuscateString(input: string, full_obfuscation: boolean = false): string {
        const obfuscationLength = full_obfuscation ? input.length : input.length - 4;
        return '*'.repeat(obfuscationLength) + input.slice(obfuscationLength);
    }
}

export const config = new Config();
