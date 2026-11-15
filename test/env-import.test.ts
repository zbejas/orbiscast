import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations, type DatabaseConnection } from '../src/modules/database/client';
import { loadOrCreateKeys } from '../src/utils/crypto';
import { SettingsService } from '../src/modules/settings';
import { importLegacyEnv } from '../src/modules/setup/import-env';
import { listSources } from '../src/modules/database/repo';

let dir: string;
let connection: DatabaseConnection;
let settings: SettingsService;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-env-'));
    connection = openDatabase(dir);
    runMigrations(connection.db);
    settings = new SettingsService(connection.db, loadOrCreateKeys(dir));
});

afterEach(() => {
    connection.close();
    rmSync(dir, { recursive: true, force: true });
});

describe('legacy env import', () => {
    it('imports a .env once and encrypts tokens', () => {
        writeFileSync(
            join(dir, '.env'),
            [
                'PLAYLIST="http://example.com/playlist.m3u"',
                'XMLTV="http://example.com/guide.xml"',
                'REFRESH_IPTV=60',
                'DEFAULT_STREAM_TIMEOUT=15',
                'BITRATE_VIDEO=6000',
                'BITRATE_VIDEO_MAX=9000',
                'MINIMIZE_LATENCY=false',
                'DISABLE_TRANSCODE=true',
                'DEBUG=true',
                'TZ="Europe/Ljubljana"',
                'DISCORD_BOT_TOKEN="bot-token-1234"',
                'DISCORD_USER_TOKEN="user-token-5678"',
                'GUILD=123456789012345678',
            ].join('\n')
        );

        const result = importLegacyEnv({ db: connection.db, sqlite: connection.sqlite, settings, cwd: dir });

        expect(result.imported).toBe(true);
        expect(result.sourceCreated).toBe(true);
        expect(settings.getDiscordTokens()).toEqual({
            botToken: 'bot-token-1234',
            userToken: 'user-token-5678',
        });
        expect(settings.getPublic().stream.bitrateVideo).toBe(6000);
        expect(settings.getPublic().stream.minimizeLatency).toBe(false);
        expect(settings.getPublic().stream.disableTranscode).toBe(true);
        expect(settings.getPublic().timezone).toBe('Europe/Ljubljana');
        expect(settings.getPublic().logLevel).toBe('debug');

        const sources = listSources(connection.db);
        expect(sources).toHaveLength(1);
        expect(sources[0]?.name).toBe('Imported IPTV');
        expect(sources[0]?.refreshMinutes).toBe(60);
        expect(sources[0]?.xmltvUrl).toBe('http://example.com/guide.xml');

        const second = importLegacyEnv({ db: connection.db, sqlite: connection.sqlite, settings, cwd: dir });
        expect(second.imported).toBe(false);
        expect(listSources(connection.db)).toHaveLength(1);
    });

    it('does nothing when no .env exists', () => {
        const result = importLegacyEnv({ db: connection.db, sqlite: connection.sqlite, settings, cwd: dir });
        expect(result.imported).toBe(false);
        expect(settings.isEnvImported()).toBe(false);
    });
});
