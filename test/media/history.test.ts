import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { openDatabase, runMigrations, type DatabaseConnection } from '../../src/modules/database/client';
import { loadOrCreateKeys } from '../../src/utils/crypto';
import { SettingsService } from '../../src/modules/settings';
import { PlaybackEngine } from '../../src/modules/playback/engine';
import { MediaService } from '../../src/modules/media/service';
import { setMediaHistoryProgress, getMediaHistoryItem, upsertMediaHistory } from '../../src/modules/database/repo';
import type { MediaItemDetail, MediaProvider } from '../../src/modules/media/types';

const streaming = vi.hoisted(() => ({
    offsets: [] as number[],
    subtitleIndexes: [] as Array<number | null>,
    finish: null as null | ((result: { aborted: boolean; error: string | null }) => void),
}));

vi.mock('../../src/modules/streaming', () => ({
    getViewerCount: () => 1,
    getViewers: () => [{ id: 'viewer', displayName: 'Viewer' }],
    getVoiceChannelInfo: () => null,
    joinVoiceChannel: async () => true,
    leaveVoiceChannel: async () => undefined,
    onViewerChange: () => () => undefined,
    pauseStreaming: () => true,
    replaceMediaStreamingSource: async () => true,
    resumeStreaming: () => true,
    setStreamSettings: () => undefined,
    startMediaStreaming: () =>
        new Promise<{ aborted: boolean; error: string | null }>(resolve => {
            streaming.finish = resolve;
        }),
    startStreaming: async () => ({ aborted: false, error: null }),
    stopStreaming: async () => undefined,
}));

const providers = vi.hoisted(() => ({
    provider: null as MediaProvider | null,
}));

vi.mock('../../src/modules/media/providers', () => ({
    createMediaProvider: () => providers.provider,
}));

const detail: MediaItemDetail = {
    itemId: 'episode-1',
    libraryKey: 'shows',
    type: 'episode',
    title: 'Pilot',
    showTitle: 'Show',
    seasonNumber: 1,
    episodeNumber: 1,
    year: 2024,
    durationMs: 600_000,
    summary: null,
    mediaSourceId: 'media-1',
    partId: 'part-1',
    showItemId: 'show-1',
    seasonItemId: 'season-1',
    intro: null,
    streams: [
        {
            id: 42,
            index: 2,
            type: 'subtitle',
            codec: 'srt',
            language: 'English',
            displayTitle: 'English',
            default: true,
            forced: false,
            burnable: true,
        },
        {
            id: 43,
            index: 3,
            type: 'subtitle',
            codec: 'srt',
            language: 'Deutsch',
            displayTitle: 'Deutsch',
            default: false,
            forced: false,
            burnable: true,
        },
    ],
};

const nextDetail: MediaItemDetail = {
    ...detail,
    itemId: 'episode-2',
    title: 'Second',
    episodeNumber: 2,
    streams: [],
};

function fakeProvider(): MediaProvider {
    return {
        kind: 'plex',
        validate: async () => ({ name: 'Home', version: '1.0', userId: null, userName: null }),
        getLibraries: async () => [{ key: 'shows', title: 'Shows', type: 'show' }],
        getLibraryItems: async () => ({ items: [], total: 0 }),
        search: async () => [],
        getSeasons: async () => [],
        getEpisodes: async () => [],
        getAllEpisodes: async () => [detail, nextDetail],
        getItem: async itemId => (itemId === nextDetail.itemId ? nextDetail : detail),
        fetchThumbnail: async () => ({ contentType: 'image/png', body: Buffer.alloc(0) }),
        preparePlayback: async input => {
            streaming.offsets.push(input.offsetSeconds);
            streaming.subtitleIndexes.push(input.subtitleStreamIndex);
            return { url: 'http://provider.test/stream', stop: async () => undefined };
        },
        shutdown: async () => undefined,
    };
}

let dir: string;
let connection: DatabaseConnection;
let settings: SettingsService;
let media: MediaService;
let sourceId: number;

beforeEach(async () => {
    streaming.offsets.length = 0;
    streaming.subtitleIndexes.length = 0;
    detail.intro = null;
    providers.provider = fakeProvider();
    dir = mkdtempSync(join(tmpdir(), 'orbiscast-history-'));
    connection = openDatabase(dir);
    runMigrations(connection.db);
    settings = new SettingsService(connection.db, loadOrCreateKeys(dir));
    settings.init();
    const events = new EventEmitter();
    const playback = new PlaybackEngine(connection.db, settings, events);
    media = new MediaService(connection.db, settings, playback, events, dir);
    playback.setMediaProvider(media);
    const source = await media.createSource({
        kind: 'plex',
        name: 'Plex',
        serverUrl: 'http://plex.test:32400',
        token: 'fixture-token',
        channelName: 'Plex',
    });
    sourceId = source.id;
    media.setLibraryEnabled(sourceId, 'shows', true);
});

afterEach(async () => {
    if (media) {
        await media.stop();
        await media.shutdown();
    }
    connection?.close();
    if (dir) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('media playback history', () => {
    it('resumes saved progress and starts over when asked', async () => {
        upsertMediaHistory(connection.db, {
            sourceId,
            itemId: detail.itemId,
            type: 'episode',
            title: detail.title,
            showTitle: detail.showTitle,
            seasonNumber: 1,
            episodeNumber: 1,
            durationMs: detail.durationMs,
            positionMs: 120_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        const target = { guildId: 'guild', voiceChannelId: 'voice' };
        const result = await media.playNow(sourceId, detail.itemId, '1080p-8', 'auto', target);
        expect(result.ok).toBe(true);
        expect(streaming.offsets.at(-1)).toBe(120);
        expect(media.getHistory()[0]?.positionMs).toBeGreaterThanOrEqual(120_000);

        await media.stop();
        await media.playNow(sourceId, detail.itemId, '1080p-8', 'auto', target, true);
        expect(streaming.offsets.at(-1)).toBe(0);
    });

    it('does not resume a completed item', async () => {
        upsertMediaHistory(connection.db, {
            sourceId,
            itemId: detail.itemId,
            type: 'episode',
            title: detail.title,
            durationMs: detail.durationMs,
            positionMs: 540_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });
        setMediaHistoryProgress(connection.db, sourceId, detail.itemId, 540_000, true);

        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);
        expect(streaming.offsets.at(-1)).toBe(0);
    });

    it('marks an item watched and removes it from the queue when stopped at 85 percent', async () => {
        upsertMediaHistory(connection.db, {
            sourceId,
            itemId: detail.itemId,
            type: 'episode',
            title: detail.title,
            durationMs: detail.durationMs,
            positionMs: 510_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);
        expect(media.getQueue()).toHaveLength(1);

        await media.stop();

        expect(media.getQueue()).toHaveLength(0);
        expect(media.getHistory()).toHaveLength(0);
        expect(getMediaHistoryItem(connection.db, sourceId, detail.itemId)?.completed).toBe(true);
    });

    it('keeps a resumable entry when stopped before the completion threshold', async () => {
        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);

        await media.stop();

        expect(media.getQueue()).toHaveLength(0);
        expect(getMediaHistoryItem(connection.db, sourceId, detail.itemId)?.completed).toBe(false);
    });

    it('switches subtitles without recreating the queue item', async () => {
        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);
        expect(streaming.subtitleIndexes.at(-1)).toBe(2);

        const switched = await media.setSubtitleMode('43');
        expect(switched.ok).toBe(true);
        expect(streaming.subtitleIndexes.at(-1)).toBe(3);
        expect(media.getQueue()[0]?.subtitleMode).toBe(43);
        expect(media.getCurrentItem()?.itemId).toBe(detail.itemId);
    });

    it('skips the intro when resume lands inside it and auto skip is enabled', async () => {
        detail.intro = { startMs: 120_000, endMs: 150_000 };
        settings.update({ playback: { autoSkipIntro: true } });
        upsertMediaHistory(connection.db, {
            sourceId,
            itemId: detail.itemId,
            type: 'episode',
            title: detail.title,
            durationMs: detail.durationMs,
            positionMs: 130_000,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);
        expect(streaming.offsets.at(-1)).toBe(150);
    });

    it('recommends the next episode after a finished episode', async () => {
        upsertMediaHistory(connection.db, {
            sourceId,
            itemId: detail.itemId,
            type: 'episode',
            title: detail.title,
            showTitle: detail.showTitle,
            seasonNumber: 1,
            episodeNumber: 1,
            durationMs: detail.durationMs,
            positionMs: detail.durationMs ?? 600_000,
            completed: true,
            quality: '1080p-8',
            subtitleMode: 'auto',
        });

        const history = await media.getHistoryWithNext();
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            itemId: nextDetail.itemId,
            title: nextDetail.title,
            positionMs: 0,
            recommended: true,
        });
        expect(history[0]?.id).toBeLessThan(0);
    });

    it('queues and starts the next episode when autoplay is enabled', async () => {
        settings.update({ playback: { autoplayNextEpisode: true } });
        const result = await media.playNow(
            sourceId,
            detail.itemId,
            '1080p-8',
            'auto',
            { guildId: 'guild', voiceChannelId: 'voice' }
        );
        expect(result.ok).toBe(true);
        expect(media.getQueue()).toHaveLength(1);

        streaming.finish?.({ aborted: false, error: null });

        await vi.waitFor(
            () => {
                const queue = media.getQueue();
                expect(
                    queue.some(item => item.itemId === nextDetail.itemId && item.status === 'playing')
                ).toBe(true);
            },
            { timeout: 2_000 }
        );
        expect(media.getCurrentItem()?.itemId).toBe(nextDetail.itemId);
    });
});
