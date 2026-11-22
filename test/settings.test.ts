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
        expect(settings.getPlexConfig().channelName).toBe('Plex');
        expect(settings.getPlexConfig().defaultQuality).toBe('1080p-8');
        expect(publicSettings.stream.bitrateVideo).toBe(5000);
        expect(publicSettings.playback).toEqual({
            autoplayNextEpisode: false,
            autoSkipIntro: false,
        });
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
            playback: { autoplayNextEpisode: true, autoSkipIntro: true },
            ui: { timezone: 'Europe/Ljubljana', logLevel: 'debug' },
            auth: { enabled: true },
        });

        const reloaded = new SettingsService(connection.db, loadOrCreateKeys(dir));
        const publicSettings = reloaded.getPublic();

        expect(publicSettings.stream.bitrateVideo).toBe(9000);
        expect(publicSettings.stream.minimizeLatency).toBe(false);
        expect(publicSettings.playback).toEqual({
            autoplayNextEpisode: true,
            autoSkipIntro: true,
        });
        expect(publicSettings.timezone).toBe('Europe/Ljubljana');
        expect(publicSettings.logLevel).toBe('debug');
        expect(publicSettings.auth.enabled).toBe(true);
    });

    it('updates playback preferences without resetting the other toggle', () => {
        settings.update({ playback: { autoplayNextEpisode: true, autoSkipIntro: true } });
        settings.update({ playback: { autoplayNextEpisode: false } });

        expect(settings.getPlayback()).toEqual({
            autoplayNextEpisode: false,
            autoSkipIntro: true,
        });
    });

    it('persists the media source tab order in settings', () => {
        settings.setMediaSourceOrder([7, 3, 7, -1, 0]);
        expect(settings.getUi().mediaSourceOrder).toEqual([7, 3]);

        settings.update({ ui: { timezone: 'UTC' } });
        expect(settings.getUi().mediaSourceOrder).toEqual([7, 3]);

        const reloaded = new SettingsService(connection.db, loadOrCreateKeys(dir));
        expect(reloaded.getUi().mediaSourceOrder).toEqual([7, 3]);
    });

    it('keeps three recent voice channels without duplicates', () => {
        settings.setRecentVoiceChannels([
            { guildId: 'g1', guildName: 'Guild 1', channelId: 'c1', channelName: 'General' },
            { guildId: 'g1', guildName: 'Guild 1', channelId: 'c2', channelName: 'Cinema' },
            { guildId: 'g1', guildName: 'Guild 1', channelId: 'c1', channelName: 'General' },
            { guildId: 'g2', guildName: 'Guild 2', channelId: 'c3', channelName: 'Voice' },
            { guildId: 'g2', guildName: 'Guild 2', channelId: 'c4', channelName: 'Extra' },
        ]);

        expect(settings.getPublic().recentVoiceChannels).toEqual([
            { guildId: 'g1', guildName: 'Guild 1', channelId: 'c1', channelName: 'General' },
            { guildId: 'g1', guildName: 'Guild 1', channelId: 'c2', channelName: 'Cinema' },
            { guildId: 'g2', guildName: 'Guild 2', channelId: 'c3', channelName: 'Voice' },
        ]);

        const reloaded = new SettingsService(connection.db, loadOrCreateKeys(dir));
        expect(reloaded.getPublic().recentVoiceChannels).toHaveLength(3);
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
