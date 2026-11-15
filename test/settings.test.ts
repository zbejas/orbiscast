import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations, type DatabaseConnection } from '../src/modules/database/client';
import { loadOrCreateKeys } from '../src/utils/crypto';
import { SettingsService } from '../src/modules/settings';

let dir: string;
let connection: DatabaseConnection;
let settings: SettingsService;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-settings-'));
    connection = openDatabase(dir);
    runMigrations(connection.db);
    const keys = loadOrCreateKeys(dir);
    settings = new SettingsService(connection.db, keys);
    settings.init();
});

afterEach(() => {
    connection.close();
    rmSync(dir, { recursive: true, force: true });
});

describe('settings service', () => {
    it('writes defaults and generates a Plex client identifier', () => {
        const publicSettings = settings.getPublic();

        expect(publicSettings.auth.enabled).toBe(false);
        expect(publicSettings.plex.channelName).toBe('Plex');
        expect(publicSettings.plex.defaultQuality).toBe('1080p-8');
        expect(publicSettings.stream.bitrateVideo).toBe(5000);
        expect(publicSettings.logLevel).toBe('info');
        expect(settings.getPlexClientIdentifier()).toMatch(/[0-9a-f-]{36}/);
    });

    it('encrypts tokens and returns masked values', () => {
        settings.update({
            discord: { botToken: 'bot-token-1234', userToken: 'user-token-5678' },
            plex: { token: 'plex-token-9999' },
        });

        expect(settings.getDiscordTokens()).toEqual({
            botToken: 'bot-token-1234',
            userToken: 'user-token-5678',
        });
        expect(settings.getPlexToken()).toBe('plex-token-9999');
        expect(settings.getPlexConfig().tokenLast4).toBe('9999');
        expect(settings.getPlexConfig().tokenSet).toBe(true);

        const raw = connection.sqlite
            .prepare('select value from settings where key = ?')
            .get('discord') as { value: string };
        expect(raw.value).not.toContain('bot-token-1234');
        expect(raw.value).not.toContain('user-token-5678');
    });

    it('persists updates across instances', () => {
        settings.update({
            stream: { bitrateVideo: 9000, minimizeLatency: false },
            ui: { timezone: 'Europe/Ljubljana', logLevel: 'debug' },
            auth: { enabled: true },
        });

        const reloaded = new SettingsService(connection.db, loadOrCreateKeys(dir));
        const publicSettings = reloaded.getPublic();

        expect(publicSettings.stream.bitrateVideo).toBe(9000);
        expect(publicSettings.stream.minimizeLatency).toBe(false);
        expect(publicSettings.timezone).toBe('Europe/Ljubljana');
        expect(publicSettings.logLevel).toBe('debug');
        expect(publicSettings.auth.enabled).toBe(true);
    });

    it('rejects invalid quality values', () => {
        expect(() => settings.update({ plex: { defaultQuality: '8k' as never } })).toThrow();
    });

    it('clears a token with an empty string', () => {
        settings.update({ plex: { token: 'plex-token-9999' } });
        settings.update({ plex: { token: '' } });

        expect(settings.getPlexToken()).toBeNull();
        expect(settings.getPlexConfig().tokenSet).toBe(false);
    });
});
