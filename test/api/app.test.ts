import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { openDatabase, runMigrations, type DatabaseConnection } from '../../src/modules/database/client';
import { loadOrCreateKeys } from '../../src/utils/crypto';
import { SettingsService } from '../../src/modules/settings';
import { IptvService } from '../../src/modules/iptv/service';
import { PlaybackEngine } from '../../src/modules/playback/engine';
import { DiscordService } from '../../src/modules/discord/service';
import { MediaService } from '../../src/modules/media/service';
import { createAuthAdapter } from '../../src/web/auth';
import { createApp } from '../../src/web/app';
import {
    createMediaSource,
    replaceSourceChannels,
    replaceSourceProgrammes,
    upsertMediaHistory,
} from '../../src/modules/database/repo';

let dir: string;
let connection: DatabaseConnection;
let settings: SettingsService;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-api-'));
    connection = openDatabase(dir);
    runMigrations(connection.db);
    const keys = loadOrCreateKeys(dir);
    const events = new EventEmitter();
    settings = new SettingsService(connection.db, keys, events);
    settings.init();

    const iptv = new IptvService(connection.db, settings, events);
    const playback = new PlaybackEngine(connection.db, settings, events);
    const media = new MediaService(connection.db, settings, playback, events, dir);
    playback.setMediaProvider(media);
    const discord = new DiscordService(connection.db, settings, playback, iptv, events);
    const auth = createAuthAdapter({ db: connection.db, settings });

    app = createApp({
        dataDir: dir,
        db: connection.db,
        settings,
        iptv,
        playback,
        media,
        discord,
        events,
        auth,
    });
});

afterEach(() => {
    connection.close();
    rmSync(dir, { recursive: true, force: true });
});

describe('API', () => {
    it('serves health and setup status', async () => {
        const health = await request(app).get('/api/health').expect(200);
        expect(health.body.ok).toBe(true);

        const setup = await request(app).get('/api/setup/status').expect(200);
        expect(setup.body.discordConfigured).toBe(false);
        expect(setup.body.guildReady).toBe(false);
        expect(setup.body.botInviteUrl).toBeNull();
        expect(setup.body.authEnabled).toBe(false);
    });

    it('reports Discord invite state and refuses a streamer join while offline', async () => {
        const status = await request(app).get('/api/discord/status').expect(200);
        expect(status.body.botInviteUrl).toBeNull();
        expect(status.body.streamerGuildIds).toEqual([]);
        expect(status.body.streamerJoin).toEqual({
            state: 'idle',
            guildId: null,
            guildName: null,
            fallbackInviteUrl: null,
            error: null,
        });

        const join = await request(app).post('/api/discord/streamer/join').send({}).expect(409);
        expect(join.body.error.code).toBe('bot_offline');
    });

    it('validates and stores sources', async () => {
        await request(app)
            .post('/api/sources')
            .send({ name: 'Bad', playlistUrl: 'not-a-url' })
            .expect(400);

        const created = await request(app)
            .post('/api/sources')
            .send({
                name: 'Test source',
                playlistUrl: 'http://example.com/playlist.m3u',
                xmltvUrl: 'http://example.com/guide.xml',
                refreshMinutes: 60,
            })
            .expect(201);

        expect(created.body.name).toBe('Test source');

        const list = await request(app).get('/api/sources').expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0].channelCount).toBe(0);
    });

    it('filters channels and updates visibility in bulk', async () => {
        const source = await request(app)
            .post('/api/sources')
            .send({ name: 'Source', playlistUrl: 'http://example.com/playlist.m3u' })
            .expect(201);

        replaceSourceChannels(connection.db, source.body.id, [
            {
                stableKey: 'one',
                tvgId: 'one',
                name: 'Alpha',
                streamUrl: 'http://example.com/alpha',
                groupTitle: 'News',
            },
            {
                stableKey: 'two',
                tvgId: 'two',
                name: 'Beta',
                streamUrl: 'http://example.com/beta',
                groupTitle: 'Sports',
            },
        ]);

        const all = await request(app).get('/api/channels').expect(200);
        expect(all.body.total).toBe(2);
        expect(all.body.page).toBe(1);
        expect(all.body.visibleTotal).toBe(0);
        expect(all.body.totalAll).toBe(2);
        expect(all.body.groups).toEqual(['News', 'Sports']);

        const news = await request(app).get('/api/channels?group=News').expect(200);
        expect(news.body.total).toBe(1);
        expect(news.body.items[0].name).toBe('Alpha');

        const ids = all.body.items.map((item: { id: number }) => item.id);
        await request(app)
            .patch('/api/channels/visibility')
            .send({ ids, visible: true })
            .expect(200);

        const visible = await request(app).get('/api/channels?visible=true').expect(200);
        expect(visible.body.total).toBe(2);

        const hidden = await request(app).get('/api/channels?visibility=hidden').expect(200);
        expect(hidden.body.total).toBe(0);

        const searched = await request(app).get('/api/channels?search=Alpha').expect(200);
        expect(searched.body.total).toBe(1);
        expect(searched.body.items[0].name).toBe('Alpha');

        const single = await request(app)
            .patch(`/api/channels/${ids[0]}/visibility`)
            .send({ visible: false })
            .expect(200);
        expect(single.body.visible).toBe(false);

        const groups = await request(app).get('/api/channels/groups').expect(200);
        expect(groups.body.groups).toEqual(['News', 'Sports']);
    });

    it('serves a day of guide data in milliseconds', async () => {
        const source = await request(app)
            .post('/api/sources')
            .send({ name: 'Guide', playlistUrl: 'http://example.com/playlist.m3u' })
            .expect(201);

        replaceSourceChannels(connection.db, source.body.id, [
            {
                stableKey: 'alpha',
                tvgId: 'alpha',
                name: 'Alpha',
                streamUrl: 'http://example.com/alpha',
                groupTitle: 'News',
            },
        ]);
        const channels = await request(app).get('/api/channels').expect(200);
        await request(app)
            .patch('/api/channels/visibility')
            .send({ ids: [channels.body.items[0].id], visible: true })
            .expect(200);

        const day = '2026-02-03';
        const start = Math.floor(new Date(`${day}T12:00:00`).getTime() / 1000);
        replaceSourceProgrammes(connection.db, source.body.id, [
            {
                channelTvgId: 'alpha',
                start: '20260203120000 +0000',
                stop: '20260203130000 +0000',
                startTimestamp: start,
                stopTimestamp: start + 3600,
                title: 'Midday News',
                description: 'A test programme',
                category: 'News',
            },
        ]);

        const guide = await request(app).get(`/api/guide?day=${day}`).expect(200);
        expect(guide.body.dayStart).toBe(new Date(`${day}T00:00:00`).getTime());
        expect(guide.body.channels).toHaveLength(1);
        expect(guide.body.channels[0].name).toBe('Alpha');
        expect(guide.body.programmes).toHaveLength(1);
        expect(guide.body.programmes[0]).toMatchObject({
            channelTvgId: 'alpha',
            title: 'Midday News',
            start: start * 1000,
            stop: (start + 3600) * 1000,
        });
    });

    it('includes the current and next programme on channel rows', async () => {
        const source = await request(app)
            .post('/api/sources')
            .send({ name: 'Guide rows', playlistUrl: 'http://example.com/playlist.m3u' })
            .expect(201);

        replaceSourceChannels(connection.db, source.body.id, [
            {
                stableKey: 'alpha',
                tvgId: 'alpha',
                name: 'Alpha',
                streamUrl: 'http://example.com/alpha',
                groupTitle: 'News',
            },
        ]);
        const channels = await request(app).get('/api/channels').expect(200);
        await request(app)
            .patch('/api/channels/visibility')
            .send({ ids: [channels.body.items[0].id], visible: true })
            .expect(200);

        const now = Math.floor(Date.now() / 1000);
        replaceSourceProgrammes(connection.db, source.body.id, [
            {
                channelTvgId: 'alpha',
                start: '20260101120000 +0000',
                stop: '20260101130000 +0000',
                startTimestamp: now - 300,
                stopTimestamp: now + 300,
                title: 'Current show',
                description: '',
                category: 'News',
            },
            {
                channelTvgId: 'alpha',
                start: '20260101130000 +0000',
                stop: '20260101140000 +0000',
                startTimestamp: now + 300,
                stopTimestamp: now + 900,
                title: 'Next show',
                description: '',
                category: 'News',
            },
        ]);

        const rows = await request(app).get('/api/channels?visible=true').expect(200);
        expect(rows.body.items[0]).toMatchObject({
            nowPlaying: 'Current show',
            next: 'Next show',
        });
    });

    it('persists settings updates', async () => {
        const updated = await request(app)
            .patch('/api/settings')
            .send({
                stream: { bitrateVideo: 9000 },
                playback: { autoplayNextEpisode: true },
                ui: { logLevel: 'debug' },
            })
            .expect(200);

        expect(updated.body.stream.bitrateVideo).toBe(9000);
        expect(updated.body.playback.autoplayNextEpisode).toBe(true);
        expect(updated.body.logLevel).toBe('debug');
    });

    it('remembers recent playback voice channels', async () => {
        const updated = await request(app)
            .post('/api/settings/recent-voice-channels')
            .send({
                channels: [
                    {
                        guildId: 'guild-1',
                        guildName: 'Guild One',
                        channelId: 'channel-1',
                        channelName: 'General',
                    },
                    {
                        guildId: 'guild-1',
                        guildName: 'Guild One',
                        channelId: 'channel-2',
                        channelName: 'Cinema',
                    },
                ],
            })
            .expect(200);

        expect(updated.body.recentVoiceChannels).toEqual([
            { guildId: 'guild-1', guildName: 'Guild One', channelId: 'channel-1', channelName: 'General' },
            { guildId: 'guild-1', guildName: 'Guild One', channelId: 'channel-2', channelName: 'Cinema' },
        ]);

        const reloaded = await request(app).get('/api/settings').expect(200);
        expect(reloaded.body.recentVoiceChannels).toHaveLength(2);
    });

    it('enables auth, requires a session, and disables again', async () => {
        const agent = request.agent(app);

        await request(app)
            .post('/api/auth/enable')
            .send({ username: 'admin', password: 'testpass123' })
            .expect(201);

        await request(app).get('/api/settings').expect(401);

        await agent
            .post('/api/auth/sign-in/username')
            .send({ username: 'admin', password: 'testpass123' })
            .expect(200);

        const session = await agent.get('/api/auth/session').expect(200);
        expect(session.body.user).toMatchObject({ name: 'admin' });

        const settingsResponse = await agent.get('/api/settings').expect(200);
        expect(settingsResponse.body.auth.enabled).toBe(true);

        await agent.post('/api/auth/logout').expect(204);
        const signedOut = await agent.get('/api/auth/session').expect(200);
        expect(signedOut.body.user).toBeNull();

        const login = await agent
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'testpass123' })
            .expect(200);
        expect(login.body.user.name).toBe('admin');

        const signedIn = await agent.get('/api/auth/session').expect(200);
        expect(signedIn.body.user.name).toBe('admin');

        const invalid = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'wrongpass' })
            .expect(401);
        expect(invalid.body.error.message).toBe('Invalid username or password');

        await agent.post('/api/auth/disable').expect(200);
        await request(app).get('/api/settings').expect(200);
    });

    it('serves an empty media queue', async () => {
        const list = await request(app).get('/api/media/queue').expect(200);
        expect(list.body).toEqual([]);

        const shuffled = await request(app).post('/api/media/queue/shuffle').expect(200);
        expect(shuffled.body).toEqual([]);

        await request(app).delete('/api/media/queue/999').expect(404);
        await request(app).delete('/api/media/queue').expect(204);
    });

    it('serves resumable media history and deletes entries', async () => {
        const empty = await request(app).get('/api/media/history').expect(200);
        expect(empty.body).toEqual([]);

        const source = createMediaSource(connection.db, {
            kind: 'plex',
            name: 'Plex',
            baseUrl: 'http://plex.test:32400',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'client',
            channelName: 'Plex',
        });
        const history = upsertMediaHistory(connection.db, {
            sourceId: source.id,
            itemId: '100',
            type: 'movie',
            title: 'Movie',
            durationMs: 7_200_000,
            positionMs: 1_200_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        const list = await request(app).get('/api/media/history?limit=5').expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({
            id: history.id,
            itemId: '100',
            title: 'Movie',
            positionMs: 1_200_000,
            sourceKind: 'plex',
        });

        await request(app).delete('/api/media/history/999').expect(404);
        await request(app).delete(`/api/media/history/${history.id}`).expect(204);
        expect((await request(app).get('/api/media/history').expect(200)).body).toEqual([]);
    });

    it('reorders media source tabs and keeps the order in settings', async () => {
        const alpha = createMediaSource(connection.db, {
            kind: 'plex',
            name: 'Alpha',
            baseUrl: 'http://alpha.test:32400',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'alpha',
            channelName: 'Alpha',
        });
        const zulu = createMediaSource(connection.db, {
            kind: 'jellyfin',
            name: 'Zulu',
            baseUrl: 'https://zulu.test',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'zulu',
            channelName: 'Zulu',
        });

        const initial = await request(app).get('/api/media/sources').expect(200);
        expect(initial.body.map((source: { id: number }) => source.id)).toEqual([
            alpha.id,
            zulu.id,
        ]);

        const reordered = await request(app)
            .post('/api/media/sources/order')
            .send({ ids: [zulu.id, alpha.id] })
            .expect(200);
        expect(reordered.body.map((source: { id: number }) => source.id)).toEqual([
            zulu.id,
            alpha.id,
        ]);

        const reloaded = await request(app).get('/api/media/sources').expect(200);
        expect(reloaded.body.map((source: { id: number }) => source.id)).toEqual([
            zulu.id,
            alpha.id,
        ]);
        expect(settings.getUi().mediaSourceOrder).toEqual([zulu.id, alpha.id]);
    });

    it('validates media source input and lists no channels before a source exists', async () => {
        await request(app)
            .post('/api/media/sources')
            .send({
                kind: 'jellyfin',
                name: 'Bad',
                serverUrl: 'not-a-url',
                token: 'test',
                channelName: 'Jellyfin',
            })
            .expect(400);

        const sources = await request(app).get('/api/media/sources').expect(200);
        expect(sources.body).toEqual([]);

        const channels = await request(app).get('/api/channels/media').expect(200);
        expect(channels.body).toEqual([]);
    });

    it('rejects seek when nothing is playing', async () => {
        const response = await request(app)
            .post('/api/playback/seek')
            .send({ seconds: 30 })
            .expect(409);
        expect(response.body.error.code).toBe('seek_failed');
    });

    it('serves no current media item and rejects subtitle changes when idle', async () => {
        const current = await request(app).get('/api/media/playback/item').expect(200);
        expect(current.body).toBeNull();

        const response = await request(app)
            .post('/api/media/playback/subtitle')
            .send({ mode: 'off' })
            .expect(409);
        expect(response.body.ok).toBe(false);
    });

    it('reports Discord token state without secrets', async () => {
        settings.update({
            discord: {
                botToken: 'bot-token-1234',
                userToken: 'user-token-5678',
            },
        });

        const state = await request(app).get('/api/discord/tokens').expect(200);
        expect(state.body).toEqual({
            botTokenSet: true,
            userTokenSet: true,
            botLast4: '1234',
            userLast4: '5678',
        });
        expect(JSON.stringify(state.body)).not.toContain('bot-token');
        expect(JSON.stringify(state.body)).not.toContain('user-token');
    });
});
