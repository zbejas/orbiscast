import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, runMigrations } from './modules/database/client';
import { loadOrCreateKeys } from './utils/crypto';
import { SettingsService } from './modules/settings';
import { importLegacyEnv } from './modules/setup/import-env';
import { IptvService } from './modules/iptv/service';
import { PlaybackEngine } from './modules/playback/engine';
import { DiscordService } from './modules/discord/service';
import { PlexService } from './modules/plex/service';
import { resetPlayingQueueItems } from './modules/database/repo';
import { createApp } from './web/app';
import { createAuthAdapter } from './web/auth';
import { configureLogger, getLogger } from './utils/logger';
import { configureCache } from './utils/cache';
import { setRuntime } from './runtime';

const logger = getLogger();

interface CliOptions {
    port: number;
    dataDir: string;
    testMode: boolean;
}

function readOptions(): CliOptions {
    const { values } = parseArgs({
        options: {
            port: { type: 'string' },
            'data-dir': { type: 'string' },
            'test-mode': { type: 'boolean', default: false },
        },
        allowPositionals: true,
    });

    const port = Number.parseInt(values.port ?? process.env.PORT ?? '3000', 10);
    return {
        port: Number.isFinite(port) ? port : 3000,
        dataDir: values['data-dir'] ? resolve(values['data-dir']) : join(process.cwd(), 'data'),
        testMode: Boolean(values['test-mode']),
    };
}

/**
 * Boots the WebUI, SQLite, Discord clients, and IPTV scheduler.
 */
async function main(): Promise<void> {
    const options = readOptions();
    configureLogger({ dataDir: options.dataDir, level: 'info' });
    configureCache(options.dataDir);

    const connection = openDatabase(options.dataDir);
    runMigrations(connection.db);

    const keys = loadOrCreateKeys(options.dataDir);
    const events = new EventEmitter();
    events.setMaxListeners(100);

    const settings = new SettingsService(connection.db, keys, events);
    if (!options.testMode) {
        importLegacyEnv({ db: connection.db, sqlite: connection.sqlite, settings, cwd: process.cwd(), dataDir: options.dataDir });
    }
    settings.init();
    process.env.TZ = settings.getUi().timezone;
    configureLogger({ dataDir: options.dataDir, level: settings.getUi().logLevel });

    const iptv = new IptvService(connection.db, settings, events);
    const playback = new PlaybackEngine(connection.db, settings, events);
    const plex = new PlexService(connection.db, settings, playback, events, options.dataDir);
    playback.setPlexProvider(plex);
    resetPlayingQueueItems(connection.db);
    const discord = new DiscordService(connection.db, settings, playback, iptv, events);
    const auth = createAuthAdapter({ db: connection.db, settings });

    const app = createApp({
        dataDir: options.dataDir,
        db: connection.db,
        settings,
        iptv,
        playback,
        plex,
        discord,
        events,
        auth,
    });

    setRuntime({
        dataDir: options.dataDir,
        sqlite: connection.sqlite,
        db: connection.db,
        keys,
        settings,
        events,
        iptv,
        playback,
        discord,
    });

    const server = app.listen(options.port, '0.0.0.0', () => {
        logger.info(`WebUI listening on http://0.0.0.0:${options.port}`);
        logger.info(`Data directory: ${options.dataDir}`);
    });

    if (!options.testMode) {
        void discord.start();
        void plex.initialize();
        iptv.start();
    } else {
        logger.info('Test mode: Discord clients and IPTV refresh are disabled');
    }

    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        try {
            iptv.stop();
            await playback.stop();
            await plex.shutdown();
            await discord.stop();
            await new Promise<void>(resolveClose => server.close(() => resolveClose()));
            connection.close();
            logger.info('Shutdown complete');
            process.exit(0);
        } catch (error) {
            logger.error(`Error during shutdown: ${error}`);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', reason => {
    logger.error(`Unhandled rejection: ${reason}`);
});

void main().catch(error => {
    logger.error(`Boot failed: ${error}`);
    process.exit(1);
});
