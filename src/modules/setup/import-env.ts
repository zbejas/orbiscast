import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import type Database from 'better-sqlite3';
import type { Db } from '../database/client';
import { isDatabasePristine } from '../database/client';
import { createSource } from '../database/repo';
import type { SettingsService, SettingsUpdateInput } from '../settings';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

export interface EnvImportResult {
    imported: boolean;
    keys: string[];
    sourceCreated: boolean;
    envPath: string | null;
}

/**
 * Imports a legacy .env file once, then leaves the file untouched.
 *
 * The import only runs when the database is pristine. Values are written
 * through the settings service, so Discord tokens are encrypted at rest.
 *
 * @param options - Database, settings, sqlite handle, and working directory
 * @returns Summary of what was imported
 */
export function importLegacyEnv(options: {
    db: Db;
    sqlite: Database.Database;
    settings: SettingsService;
    cwd?: string;
    dataDir?: string;
}): EnvImportResult {
    const cwd = options.cwd ?? process.cwd();
    const candidates = [join(cwd, '.env')];
    if (options.dataDir) {
        candidates.push(join(options.dataDir, '.env'));
    }
    const envPath = candidates.find(candidate => existsSync(candidate)) ?? null;

    if (!options.settings.isEnvImported() && !isDatabasePristine(options.sqlite)) {
        return { imported: false, keys: [], sourceCreated: false, envPath: null };
    }
    if (options.settings.isEnvImported() || !envPath) {
        return { imported: false, keys: [], sourceCreated: false, envPath: null };
    }

    const env = parse(readFileSync(envPath, 'utf8'));
    const keys = Object.keys(env).filter(key => env[key] !== undefined && env[key] !== '');
    if (keys.length === 0) {
        return { imported: false, keys: [], sourceCreated: false, envPath };
    }

    const update: SettingsUpdateInput = {};
    const stream: NonNullable<SettingsUpdateInput['stream']> = {};

    const timeout = parseInteger(env.DEFAULT_STREAM_TIMEOUT);
    if (timeout !== undefined) stream.defaultStreamTimeout = timeout;
    const bitrate = parseInteger(env.BITRATE_VIDEO);
    if (bitrate !== undefined) stream.bitrateVideo = bitrate;
    const bitrateMax = parseInteger(env.BITRATE_VIDEO_MAX);
    if (bitrateMax !== undefined) stream.bitrateVideoMax = bitrateMax;
    if (env.MINIMIZE_LATENCY !== undefined) stream.minimizeLatency = env.MINIMIZE_LATENCY.toLowerCase() !== 'false';
    if (env.DISABLE_TRANSCODE !== undefined) stream.disableTranscode = env.DISABLE_TRANSCODE.toLowerCase() === 'true';
    if (Object.keys(stream).length > 0) update.stream = stream;

    const ui: NonNullable<SettingsUpdateInput['ui']> = {};
    if (env.DEBUG !== undefined) ui.logLevel = env.DEBUG.toLowerCase() === 'true' ? 'debug' : 'info';
    if (env.TZ && isValidTimezone(env.TZ)) ui.timezone = env.TZ;
    if (Object.keys(ui).length > 0) update.ui = ui;

    const discord: NonNullable<SettingsUpdateInput['discord']> = {};
    if (env.DISCORD_BOT_TOKEN) discord.botToken = env.DISCORD_BOT_TOKEN;
    if (env.DISCORD_USER_TOKEN) discord.userToken = env.DISCORD_USER_TOKEN;
    if (Object.keys(discord).length > 0) update.discord = discord;

    options.settings.update(update);

    let sourceCreated = false;
    if (env.PLAYLIST) {
        const refreshMinutes = parseInteger(env.REFRESH_IPTV) ?? 1440;
        createSource(options.db, {
            name: 'Imported IPTV',
            playlistUrl: env.PLAYLIST,
            xmltvUrl: env.XMLTV || null,
            refreshMinutes,
            enabled: true,
        });
        sourceCreated = true;
    }

    options.settings.markEnvImported();

    if (env.GUILD) {
        logger.info('Legacy GUILD is ignored: Discord commands are registered in every guild the bot joins');
    }
    if (env.RAM_CACHE !== undefined || env.CACHE_DIR !== undefined) {
        logger.info('Legacy RAM_CACHE and CACHE_DIR are ignored: cache files live under data/cache');
    }
    if (env.OPENVPN_USER || env.OPENVPN_PASSWORD) {
        logger.info('Legacy OPENVPN credentials are ignored: OrbisCast does not use a VPN');
    }

    logger.info(`Imported ${keys.length} legacy environment variable(s) from .env; the file is no longer read`);
    return { imported: true, keys, sourceCreated, envPath };
}

function parseInteger(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidTimezone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
    } catch {
        logger.warn(`Ignoring invalid legacy TZ value: ${value}`);
        return false;
    }
}
