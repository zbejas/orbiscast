import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { openDatabase, runMigrations, type DatabaseConnection } from '../../src/modules/database/client';
import { loadOrCreateKeys } from '../../src/utils/crypto';
import { SettingsService } from '../../src/modules/settings';
import { PlaybackEngine } from '../../src/modules/playback/engine';
import { MediaService } from '../../src/modules/media/service';
import {
    addMediaQueueItem,
    clearMediaQueue,
    createMediaSource,
    deleteMediaSource,
    getMediaHistoryItem,
    getMediaQueueItem,
    listMediaHistory,
    listMediaLibraries,
    listMediaQueue,
    listMediaSources,
    nextQueuedMediaItem,
    removeMediaHistory,
    replaceMediaLibraries,
    reorderMediaQueue,
    resetPlayingMediaItems,
    setMediaHistoryProgress,
    setMediaLibraryEnabled,
    setMediaQueueStatus,
    upsertMediaHistory,
} from '../../src/modules/database/repo';

let dir: string;
let connection: DatabaseConnection;
let settings: SettingsService;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-media-'));
    connection = openDatabase(dir);
    runMigrations(connection.db);
    settings = new SettingsService(connection.db, loadOrCreateKeys(dir));
    settings.init();
});

afterEach(() => {
    connection.close();
    rmSync(dir, { recursive: true, force: true });
});

describe('media repository', () => {
    it('stores sources and libraries and preserves enabled flags', () => {
        const source = createMediaSource(connection.db, {
            kind: 'jellyfin',
            name: 'Living room',
            baseUrl: 'https://jellyfin.test',
            tokenEncrypted: 'ciphertext',
            tokenLast4: '1234',
            clientIdentifier: 'device-id',
            channelName: 'Jellyfin',
        });

        expect(listMediaSources(connection.db)).toHaveLength(1);
        replaceMediaLibraries(connection.db, source.id, [
            { key: 'movies', title: 'Movies', type: 'movie' },
            { key: 'shows', title: 'TV Shows', type: 'show' },
        ]);
        setMediaLibraryEnabled(connection.db, source.id, 'movies', true);

        const libraries = listMediaLibraries(connection.db, source.id);
        expect(libraries).toHaveLength(2);
        expect(libraries.find(library => library.key === 'movies')?.enabled).toBe(true);
        expect(libraries.find(library => library.key === 'shows')?.enabled).toBe(false);

        replaceMediaLibraries(connection.db, source.id, [
            { key: 'movies', title: 'Movies', type: 'movie' },
            { key: 'shows', title: 'TV Shows', type: 'show' },
        ]);
        expect(listMediaLibraries(connection.db, source.id).find(library => library.key === 'movies')?.enabled).toBe(true);
    });

    it('keeps one global queue and cascades entries with the source', () => {
        const first = createMediaSource(connection.db, {
            kind: 'plex',
            name: 'Plex',
            baseUrl: 'http://plex.test:32400',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'client',
            channelName: 'Plex',
        });
        const second = createMediaSource(connection.db, {
            kind: 'jellyfin',
            name: 'Jellyfin',
            baseUrl: 'https://jellyfin.test',
            tokenEncrypted: 'ciphertext2',
            clientIdentifier: 'device',
            channelName: 'Jellyfin',
        });

        const movie = addMediaQueueItem(connection.db, {
            sourceId: first.id,
            itemId: '100',
            type: 'movie',
            title: 'Movie',
            quality: '1080p-8',
            subtitleMode: 'auto',
        });
        const episode = addMediaQueueItem(connection.db, {
            sourceId: second.id,
            itemId: '200',
            type: 'episode',
            title: 'Pilot',
            showTitle: 'Show',
            seasonNumber: 1,
            episodeNumber: 1,
            quality: '720p-4',
            subtitleMode: 'off',
        });

        expect(listMediaQueue(connection.db)).toHaveLength(2);
        expect(movie.sourceKind).toBe('plex');
        expect(episode.sourceName).toBe('Jellyfin');
        expect(nextQueuedMediaItem(connection.db)?.id).toBe(movie.id);

        reorderMediaQueue(connection.db, [episode.id, movie.id]);
        expect(nextQueuedMediaItem(connection.db)?.id).toBe(episode.id);

        setMediaQueueStatus(connection.db, episode.id, 'playing');
        resetPlayingMediaItems(connection.db);
        expect(getMediaQueueItem(connection.db, episode.id)?.status).toBe('queued');

        deleteMediaSource(connection.db, second.id);
        expect(listMediaQueue(connection.db)).toHaveLength(1);
        expect(listMediaSources(connection.db)).toHaveLength(1);
    });

    it('saves playback history, keeps one row per item, and cascades with the source', () => {
        const source = createMediaSource(connection.db, {
            kind: 'plex',
            name: 'Plex',
            baseUrl: 'http://plex.test:32400',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'client',
            channelName: 'Plex',
        });

        const created = upsertMediaHistory(connection.db, {
            sourceId: source.id,
            itemId: '100',
            type: 'movie',
            title: 'Movie',
            durationMs: 7_200_000,
            thumbUrl: '/api/media/thumb/1/100',
            positionMs: 120_000,
            quality: '720p-4',
            subtitleMode: 'off',
        });

        expect(created.positionMs).toBe(120_000);
        expect(created.completed).toBe(false);
        expect(created.sourceKind).toBe('plex');
        expect(created.subtitleMode).toBe('off');
        expect(listMediaHistory(connection.db)).toHaveLength(1);

        upsertMediaHistory(connection.db, {
            sourceId: source.id,
            itemId: '100',
            type: 'movie',
            title: 'Movie',
            durationMs: 7_200_000,
            positionMs: 1_800_000,
            quality: '1080p-12',
            subtitleMode: 'auto',
        });

        const updated = getMediaHistoryItem(connection.db, source.id, '100');
        expect(updated?.positionMs).toBe(1_800_000);
        expect(updated?.quality).toBe('1080p-12');
        expect(listMediaHistory(connection.db)).toHaveLength(1);

        setMediaHistoryProgress(connection.db, source.id, '100', 7_200_000, true);
        expect(listMediaHistory(connection.db)).toEqual([]);
        expect(listMediaHistory(connection.db, 10, true)).toHaveLength(1);
        expect(listMediaHistory(connection.db, 10, true)[0]?.completed).toBe(true);

        expect(removeMediaHistory(connection.db, created.id)).toBe(true);
        expect(listMediaHistory(connection.db, 10, true)).toEqual([]);
        expect(removeMediaHistory(connection.db, created.id)).toBe(false);
    });

    it('cascades playback history when a source is deleted', () => {
        const source = createMediaSource(connection.db, {
            kind: 'jellyfin',
            name: 'Jellyfin',
            baseUrl: 'https://jellyfin.test',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'device',
            channelName: 'Jellyfin',
        });
        upsertMediaHistory(connection.db, {
            sourceId: source.id,
            itemId: '200',
            type: 'episode',
            title: 'Pilot',
            showTitle: 'Show',
            seasonNumber: 1,
            episodeNumber: 1,
            durationMs: 1_800_000,
            positionMs: 300_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        deleteMediaSource(connection.db, source.id);
        expect(listMediaHistory(connection.db, 10, true)).toEqual([]);
    });

    it('clears the queue while keeping the active item', () => {
        const source = createMediaSource(connection.db, {
            kind: 'plex',
            name: 'Plex',
            baseUrl: 'http://plex.test:32400',
            tokenEncrypted: 'ciphertext',
            clientIdentifier: 'client',
            channelName: 'Plex',
        });
        const active = addMediaQueueItem(connection.db, {
            sourceId: source.id,
            itemId: 'active',
            type: 'movie',
            title: 'Active',
            quality: '1080p-8',
            subtitleMode: 'auto',
        });
        const queued = addMediaQueueItem(connection.db, {
            sourceId: source.id,
            itemId: 'queued',
            type: 'movie',
            title: 'Queued',
            quality: '1080p-8',
            subtitleMode: 'auto',
        });
        const failed = addMediaQueueItem(connection.db, {
            sourceId: source.id,
            itemId: 'failed',
            type: 'movie',
            title: 'Failed',
            quality: '1080p-8',
            subtitleMode: 'auto',
        });
        setMediaQueueStatus(connection.db, active.id, 'playing');
        setMediaQueueStatus(connection.db, failed.id, 'failed', 'Provider rejected the transcode');

        clearMediaQueue(connection.db, active.id);
        const remaining = listMediaQueue(connection.db);
        expect(remaining.map(item => item.id)).toEqual([active.id]);
        expect(remaining[0]?.position).toBe(1);
        expect(remaining[0]?.status).toBe('playing');
        expect(getMediaQueueItem(connection.db, queued.id)).toBeUndefined();

        clearMediaQueue(connection.db);
        expect(listMediaQueue(connection.db)).toEqual([]);
    });

    it('migrates the legacy Plex settings, libraries, and queue once', async () => {
        settings.update({
            plex: {
                serverUrl: 'http://127.0.0.1:1',
                token: 'legacy-token-1234',
                channelName: 'Plex On Demand',
                idleMinutes: 12,
                emptyGraceSeconds: 45,
                defaultQuality: '720p-4',
            },
        });
        connection.sqlite
            .prepare(
                'insert into plex_libraries (library_key, title, type, enabled, updated_at) values (?, ?, ?, 1, ?)'
            )
            .run('movies', 'Movies', 'movie', Date.now());
        connection.sqlite
            .prepare(
                'insert into plex_queue_items (position, status, rating_key, type, title, quality, subtitle_mode, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )
            .run(1, 'queued', '42', 'movie', 'Legacy Movie', '1080p-8', 'auto', Date.now(), Date.now());

        const events = new EventEmitter();
        const playback = new PlaybackEngine(connection.db, settings, events);
        const media = new MediaService(connection.db, settings, playback, events, dir);
        await media.initialize();

        const sources = listMediaSources(connection.db);
        expect(sources).toHaveLength(1);
        expect(sources[0]?.kind).toBe('plex');
        expect(sources[0]?.channelName).toBe('Plex On Demand');
        expect(sources[0]?.idleMinutes).toBe(12);
        expect(sources[0]?.defaultQuality).toBe('720p-4');
        expect(listMediaLibraries(connection.db, sources[0]!.id)[0]?.enabled).toBe(true);
        expect(listMediaQueue(connection.db)[0]?.itemId).toBe('42');
        await media.shutdown();
    });
});
