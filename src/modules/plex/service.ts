import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../database/client';
import {
    addQueueItem,
    getQueueItem,
    listPlexLibraries,
    listQueue,
    nextQueuedItem,
    replacePlexLibraries,
    reorderQueue,
    setPlexLibraryEnabled,
    setQueueItemStatus,
} from '../database/repo';
import type { SettingsService } from '../settings';
import type { PlaybackEngine, PlaybackResult, PlaybackTarget, PlexPlaybackProvider } from '../playback/engine';
import {
    PlexClient,
    PlexError,
    type PlexItem,
    type PlexItemDetail,
    type PlexStream,
} from './index';
import {
    buildStopSessionUrl,
    buildTranscodeUrl,
    createSessionId,
    isBurnableSubtitleStream,
    pickSubtitleStream,
} from './transcode';
import { PlexProxy } from './proxy';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import { getViewerCount, joinVoiceChannel, leaveVoiceChannel, startStreaming, stopStreaming } from '../streaming';
import type {
    PlexConfigDto,
    PlexItemDetailDto,
    PlexItemDto,
    PlexLibraryDto,
    PlexQuality,
    PlexStreamDto,
    QueueItemDto,
} from '../../shared/types';

const logger = getLogger();
const execFileAsync = promisify(execFile);
const PLACEHOLDER_DURATION_SECONDS = 6;

interface CurrentPlayback {
    queueItem: QueueItemDto;
    detail: PlexItemDetail;
    sessionId: string;
    url: string;
    startedAt: number;
    offsetBase: number;
    subtitleStreamIndex: number | null;
    quality: PlexQuality;
    target: PlaybackTarget;
}

interface PlaceholderState {
    idleTimer: NodeJS.Timeout;
    emptyTimer: NodeJS.Timeout;
    emptySeconds: number;
    runToken: number;
}

/**
 * Plex connection, browsing, queue, and playback.
 *
 * The service implements the PlaybackEngine's Plex provider contract so the
 * WebUI, Discord commands, and the queue all share one playback state.
 */
export class PlexService implements PlexPlaybackProvider {
    private client: PlexClient | null = null;
    private connected = false;
    private error: string | null = null;
    private current: CurrentPlayback | null = null;
    private paused = false;
    private runToken = 0;
    private placeholder: PlaceholderState | null = null;
    private placeholderRunToken = 0;
    private configKey = '';
    private proxy: PlexProxy | null = null;

    constructor(
        private readonly db: Db,
        private readonly settings: SettingsService,
        private readonly playback: PlaybackEngine,
        private readonly events: EventEmitter,
        private readonly dataDir: string
    ) {
        this.rebuildClient();
        this.events.on('settings', () => this.onSettingsChanged());
    }

    /**
     * Validates the saved Plex connection and syncs libraries on boot.
     */
    async initialize(): Promise<void> {
        if (!this.client) {
            return;
        }
        await this.connect();
    }

    /**
     * Stops the loopback proxy and any placeholder state on app shutdown.
     */
    async shutdown(): Promise<void> {
        await this.stopPlaceholder(false);
        await this.proxy?.stop();
        this.proxy = null;
    }

    /**
     * Returns the Plex connection status.
     */
    getConfig(): PlexConfigDto {
        const config = this.settings.getPlexConfig();
        return {
            ...config,
            connected: this.connected,
            error: this.error,
        };
    }

    /**
     * Validates the server and syncs the library list.
     */
    async connect(): Promise<PlexConfigDto> {
        if (!this.client) {
            this.connected = false;
            this.error = 'Plex is not configured.';
            return this.getConfig();
        }
        try {
            await this.client.validate();
            await this.syncLibraries();
            this.connected = true;
            this.error = null;
            logger.info('Plex connection validated');
        } catch (error) {
            this.connected = false;
            this.error = error instanceof Error ? error.message : String(error);
            logger.error(`Plex validation failed: ${this.error}`);
        }
        this.events.emit('plex', this.getConfig());
        return this.getConfig();
    }

    /**
     * Returns the library list, syncing from Plex when the local list is empty.
     */
    async getLibraries(): Promise<PlexLibraryDto[]> {
        let libraries = listPlexLibraries(this.db);
        if (libraries.length === 0 && this.client) {
            await this.syncLibraries();
            libraries = listPlexLibraries(this.db);
        }
        return libraries;
    }

    /**
     * Enables or disables a library in the picker.
     *
     * @param key - Plex library key
     * @param enabled - New enabled state
     */
    setLibraryEnabled(key: string, enabled: boolean): PlexLibraryDto[] {
        setPlexLibraryEnabled(this.db, key, enabled);
        return listPlexLibraries(this.db);
    }

    /**
     * Searches enabled libraries.
     *
     * @param query - Search text
     */
    async search(query: string): Promise<PlexItemDto[]> {
        const client = this.requireClient();
        const enabled = listPlexLibraries(this.db)
            .filter(library => library.enabled)
            .map(library => library.key);
        if (enabled.length === 0) {
            return [];
        }
        const items = await client.search(query, enabled);
        return items.map(item => this.toItemDto(item));
    }

    /**
     * Reads one page of a library.
     *
     * @param libraryKey - Plex library key
     * @param start - Zero-based offset
     * @param size - Page size
     */
    async getLibraryItems(
        libraryKey: string,
        start: number,
        size: number
    ): Promise<{ items: PlexItemDto[]; total: number }> {
        const client = this.requireClient();
        this.requireEnabledLibrary(libraryKey);
        const page = await client.getLibraryItems(libraryKey, { start, size });
        return { items: page.items.map(item => this.toItemDto(item)), total: page.total };
    }

    /**
     * Lists the seasons of a show.
     *
     * @param showKey - Plex show rating key
     */
    async getSeasons(showKey: string): Promise<PlexItemDto[]> {
        const client = this.requireClient();
        const seasons = await client.getSeasons(showKey);
        return seasons.map(season => this.toItemDto(season));
    }

    /**
     * Lists the episodes of a season.
     *
     * @param seasonKey - Plex season rating key
     */
    async getEpisodes(seasonKey: string): Promise<PlexItemDto[]> {
        const client = this.requireClient();
        const episodes = await client.getEpisodes(seasonKey);
        return episodes.map(episode => this.toItemDto(episode));
    }

    /**
     * Lists the children of a show or season. Other item types return an empty
     * list so the WebUI can call this without knowing the type first.
     *
     * @param ratingKey - Plex rating key of a show or season
     */
    async getChildren(ratingKey: string): Promise<PlexItemDto[]> {
        const client = this.requireClient();
        const detail = await client.getItem(ratingKey);
        if (detail.type === 'show') {
            return (await client.getSeasons(ratingKey)).map(season => this.toItemDto(season));
        }
        if (detail.type === 'season') {
            return (await client.getEpisodes(ratingKey)).map(episode => this.toItemDto(episode));
        }
        return [];
    }

    /**
     * Returns the persisted queue.
     */
    getQueue(): QueueItemDto[] {
        return listQueue(this.db);
    }

    /**
     * Starts a specific queued item. The chosen item moves to the front of the
     * queue and any playing item is returned to queued first.
     *
     * @param id - Queue item id
     * @param target - Guild and voice channel
     */
    async playQueueItem(id: number, target: PlaybackTarget): Promise<PlaybackResult> {
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        const item = getQueueItem(this.db, id);
        if (!item) {
            return { ok: false, message: 'Queue item not found.' };
        }

        setQueueItemStatus(this.db, id, 'queued');
        const ids = listQueue(this.db)
            .map(entry => entry.id)
            .filter(entryId => entryId !== id);
        reorderQueue(this.db, [id, ...ids]);
        this.emitQueue();

        return this.playQueue(target);
    }

    /**
     * Starts a Plex item immediately. The item is added to the queue first and
     * then moved to the front.
     *
     * @param ratingKey - Plex rating key
     * @param quality - Transcode preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     * @param target - Guild and voice channel
     */
    async playNow(
        ratingKey: string,
        quality: PlexQuality,
        subtitleMode: string,
        target: PlaybackTarget
    ): Promise<PlaybackResult> {
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        const created = await this.addToQueue(ratingKey, quality, subtitleMode);
        return this.playQueueItem(created.id, target);
    }

    /**
     * Moves a queue item one position up or down.
     *
     * @param id - Queue item id
     * @param direction - Up or down
     */
    moveQueueItem(id: number, direction: 'up' | 'down'): QueueItemDto[] {
        const items = listQueue(this.db);
        const index = items.findIndex(item => item.id === id);
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || swap < 0 || swap >= items.length) {
            return items;
        }
        const ids = items.map(item => item.id);
        const current = ids[index];
        const other = ids[swap];
        if (current === undefined || other === undefined) {
            return items;
        }
        ids[index] = other;
        ids[swap] = current;
        reorderQueue(this.db, ids);
        this.emitQueue();
        return listQueue(this.db);
    }

    /**
     * Shuffles the queue and returns the new order.
     */
    shuffleQueue(): QueueItemDto[] {
        const ids = listQueue(this.db).map(item => item.id);
        for (let index = ids.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
        }
        reorderQueue(this.db, ids);
        this.emitQueue();
        return listQueue(this.db);
    }

    /**
     * Loads full item metadata, including subtitle and audio streams.
     *
     * @param ratingKey - Plex rating key
     */
    async getItem(ratingKey: string): Promise<PlexItemDetailDto> {
        const client = this.requireClient();
        const detail = await client.getItem(ratingKey);
        return {
            ...this.toItemDto(detail),
            streams: detail.streams
                .filter(stream => stream.type === 'audio' || stream.type === 'subtitle')
                .map(stream => this.toStreamDto(stream)),
        };
    }

    /**
     * Fetches a thumbnail with the server token kept on the server.
     *
     * @param ratingKey - Plex rating key
     * @param width - Optional width
     * @param height - Optional height
     */
    async fetchThumbnail(ratingKey: string, width?: number, height?: number): Promise<{ contentType: string; body: Buffer }> {
        const client = this.requireClient();
        const targetWidth = width ?? 400;
        const targetHeight = height ?? Math.round(targetWidth * 1.5);
        const response = await fetch(client.thumbnailUrl(ratingKey, targetWidth, targetHeight));
        if (!response.ok) {
            throw new PlexError('Plex thumbnail request failed', 'HTTP_ERROR', { status: response.status });
        }
        return {
            contentType: response.headers.get('content-type') ?? 'image/jpeg',
            body: Buffer.from(await response.arrayBuffer()),
        };
    }

    /**
     * Adds one movie or episode to the queue.
     *
     * @param ratingKey - Plex rating key
     * @param quality - Transcode preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addToQueue(ratingKey: string, quality: PlexQuality, subtitleMode: string): Promise<QueueItemDto> {
        const client = this.requireClient();
        const detail = await client.getItem(ratingKey);
        if (detail.type !== 'movie' && detail.type !== 'episode') {
            throw new Error('Only movies and episodes can be queued');
        }
        return this.addDetailToQueue(detail, quality, subtitleMode);
    }

    /**
     * Adds every episode of a season.
     *
     * @param seasonKey - Plex season rating key
     * @param quality - Transcode preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addSeasonToQueue(seasonKey: string, quality: PlexQuality, subtitleMode: string): Promise<QueueItemDto[]> {
        const client = this.requireClient();
        const episodes = await client.getEpisodes(seasonKey);
        const added: QueueItemDto[] = [];
        for (const episode of episodes) {
            const detail = await client.getItem(episode.ratingKey);
            added.push(this.addDetailToQueue(detail, quality, subtitleMode));
        }
        return added;
    }

    /**
     * Adds every episode of a show.
     *
     * @param showKey - Plex show rating key
     * @param quality - Transcode preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addShowToQueue(showKey: string, quality: PlexQuality, subtitleMode: string): Promise<QueueItemDto[]> {
        const client = this.requireClient();
        const episodes = await client.getAllLeaves(showKey);
        const added: QueueItemDto[] = [];
        for (const episode of episodes) {
            const detail = await client.getItem(episode.ratingKey);
            added.push(this.addDetailToQueue(detail, quality, subtitleMode));
        }
        return added;
    }

    /**
     * Starts the Plex queue in the requested voice channel.
     *
     * @param target - Guild and voice channel
     */
    async playQueue(target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.client) {
            return { ok: false, message: 'Plex is not configured.' };
        }
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        if (this.playback.getState().mode === 'placeholder') {
            await this.stopPlaceholder(false);
        }

        const next = nextQueuedItem(this.db);
        if (!next) {
            return { ok: false, message: 'The Plex queue is empty.' };
        }

        const joined = await joinVoiceChannel(target.guildId, target.voiceChannelId);
        if (!joined) {
            return { ok: false, message: 'Failed to join the voice channel.' };
        }

        try {
            await this.startItem(next, target);
            return { ok: true, message: `Playing ${next.title}` };
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to start Plex playback: ${this.error}`);
            return { ok: false, message: this.error };
        }
    }

    /**
     * Joins voice and loops the Plex placeholder slide.
     *
     * @param target - Guild and voice channel
     */
    async startPlaceholder(target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.client) {
            return { ok: false, message: 'Plex is not configured.' };
        }
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }

        await this.stopPlaceholder(false);
        const joined = await joinVoiceChannel(target.guildId, target.voiceChannelId);
        if (!joined) {
            return { ok: false, message: 'Failed to join the voice channel.' };
        }

        let videoPath: string;
        try {
            videoPath = await this.ensurePlaceholderVideo();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            logger.error(`Placeholder generation failed: ${this.error}`);
            await leaveVoiceChannel();
            return { ok: false, message: 'Could not generate the Plex placeholder video.' };
        }

        const config = this.settings.getPlexConfig();
        this.playback.beginPlaceholderState(config.channelName);

        const runToken = ++this.placeholderRunToken;
        const state: PlaceholderState = {
            idleTimer: setTimeout(() => {
                void this.stopPlaceholder(true);
            }, Math.max(1, config.idleMinutes) * 60_000),
            emptyTimer: setInterval(() => {
                if (!this.placeholder) return;
                if (getViewerCount() === 0) {
                    this.placeholder.emptySeconds += 10;
                    if (this.placeholder.emptySeconds >= Math.max(1, config.emptyGraceSeconds)) {
                        void this.stopPlaceholder(true);
                    }
                } else {
                    this.placeholder.emptySeconds = 0;
                }
            }, 10_000),
            emptySeconds: 0,
            runToken,
        };
        this.placeholder = state;

        void startStreaming(
            {
                xui_id: 0,
                tvg_name: config.channelName,
                url: videoPath,
            },
            { inputOptions: ['-stream_loop', '-1'], monitor: false }
        ).then(async result => {
            if (runToken !== this.placeholderRunToken || result.aborted) {
                return;
            }
            if (result.error) {
                logger.error(`Placeholder stream failed: ${result.error}`);
            }
            await this.stopPlaceholder(true);
        });

        return { ok: true, message: `${config.channelName} is on demand. Choose something in the WebUI.` };
    }

    /**
     * Stops the placeholder and optionally leaves voice.
     *
     * @param leave - Whether to disconnect from voice
     */
    async stopPlaceholder(leave: boolean): Promise<void> {
        const state = this.placeholder;
        this.placeholder = null;
        if (state) {
            clearTimeout(state.idleTimer);
            clearInterval(state.emptyTimer);
        }
        this.placeholderRunToken++;
        await stopStreaming();
        if (leave) {
            await leaveVoiceChannel();
        }
        this.playback.endPlaceholderState();
    }

    async pause(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current || this.paused) {
            return { ok: false, message: 'Plex playback is not active.' };
        }
        const offset = current.offsetBase + (Date.now() - current.startedAt) / 1000;
        this.runToken++;
        await stopStreaming();
        await this.stopSession(current.sessionId);
        current.offsetBase = offset;
        current.startedAt = 0;
        current.sessionId = '';
        this.paused = true;
        this.playback.setPlexPaused(true);
        return { ok: true, message: 'Playback paused.' };
    }

    async resume(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current || !this.paused) {
            return { ok: false, message: 'Plex playback is not paused.' };
        }
        const sessionId = createSessionId();
        current.sessionId = sessionId;
        const proxyBase = await this.ensureProxy();
        current.url = buildTranscodeUrl({
            baseUrl: proxyBase,
            token: null,
            clientIdentifier: this.settings.getPlexClientIdentifier(),
            ratingKey: current.detail.ratingKey,
            mediaIndex: 0,
            partIndex: 0,
            quality: current.quality,
            subtitleStreamIndex: current.subtitleStreamIndex,
            offsetSeconds: Math.max(0, current.offsetBase),
            sessionId,
        });
        current.startedAt = Date.now();
        this.paused = false;
        this.playback.setPlexPaused(false);
        const token = ++this.runToken;
        void this.runCurrent(token);
        return { ok: true, message: 'Playback resumed.' };
    }

    async skip(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current) {
            return { ok: false, message: 'Plex playback is not active.' };
        }
        this.runToken++;
        await stopStreaming();
        await this.stopSession(current.sessionId);
        setQueueItemStatus(this.db, current.queueItem.id, 'played');
        this.current = null;
        await this.advance(current.target);
        return { ok: true, message: 'Skipped.' };
    }

    async stop(): Promise<void> {
        this.runToken++;
        if (this.placeholder) {
            await this.stopPlaceholder(false);
        }
        const current = this.current;
        this.current = null;
        await stopStreaming();
        if (current) {
            await this.stopSession(current.sessionId);
            setQueueItemStatus(this.db, current.queueItem.id, 'queued');
        }
        this.paused = false;
        this.playback.endPlexState();
        this.emitQueue();
    }

    private async runCurrent(token: number): Promise<void> {
        const current = this.current;
        if (!current) return;

        const result = await startStreaming({
            xui_id: 0,
            tvg_name: current.detail.title,
            url: current.url,
        });
        if (token !== this.runToken) {
            return;
        }

        await this.stopSession(current.sessionId);
        if (result.aborted) {
            return;
        }

        if (result.error) {
            setQueueItemStatus(this.db, current.queueItem.id, 'failed', redactSecrets(result.error));
            logger.error(`Plex item failed: ${redactSecrets(result.error)}`);
        } else {
            setQueueItemStatus(this.db, current.queueItem.id, 'played');
        }

        this.current = null;
        await this.advance(current.target);
    }

    private async advance(target: PlaybackTarget): Promise<void> {
        while (true) {
            const next = nextQueuedItem(this.db);
            if (!next) {
                await leaveVoiceChannel();
                this.playback.endPlexState();
                this.emitQueue();
                return;
            }
            try {
                await this.startItem(next, target);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setQueueItemStatus(this.db, next.id, 'failed', redactSecrets(message));
                logger.error(`Plex queue item failed to start: ${redactSecrets(message)}`);
                this.emitQueue();
            }
        }
    }

    private async startItem(queueItem: ReturnType<typeof nextQueuedItem>, target: PlaybackTarget): Promise<void> {
        if (!queueItem) {
            return;
        }
        const client = this.requireClient();
        const detail = await client.getItem(queueItem.ratingKey);
        const quality = queueItem.quality as PlexQuality;
        const subtitleStreamIndex = resolveSubtitleStreamIndex(detail.streams, queueItem.subtitleMode);
        const sessionId = createSessionId();
        const proxyBase = await this.ensureProxy();
        const url = buildTranscodeUrl({
            baseUrl: proxyBase,
            token: null,
            clientIdentifier: this.settings.getPlexClientIdentifier(),
            ratingKey: detail.ratingKey,
            mediaIndex: 0,
            partIndex: 0,
            quality,
            subtitleStreamIndex,
            offsetSeconds: 0,
            sessionId,
        });

        const queueDto: QueueItemDto = {
            id: queueItem.id,
            position: queueItem.position,
            status: 'playing',
            ratingKey: queueItem.ratingKey,
            type: queueItem.type,
            title: queueItem.title,
            showTitle: queueItem.showTitle,
            seasonNumber: queueItem.seasonNumber,
            episodeNumber: queueItem.episodeNumber,
            durationMs: queueItem.durationMs,
            thumbUrl: queueItem.thumbUrl,
            quality,
            subtitleMode: parseSubtitleMode(queueItem.subtitleMode),
            error: null,
        };

        this.current = {
            queueItem: queueDto,
            detail,
            sessionId,
            url,
            startedAt: Date.now(),
            offsetBase: 0,
            subtitleStreamIndex,
            quality,
            target,
        };
        this.paused = false;

        setQueueItemStatus(this.db, queueItem.id, 'playing');
        this.playback.beginPlexState({
            title: detail.title,
            subtitle: detail.showTitle ?? null,
            posterUrl: this.proxyThumb(detail.ratingKey),
            queueItemId: queueItem.id,
        });
        this.emitQueue();

        const token = ++this.runToken;
        void this.runCurrent(token);
    }

    private addDetailToQueue(detail: PlexItemDetail, quality: PlexQuality, subtitleMode: string): QueueItemDto {
        const created = addQueueItem(this.db, {
            ratingKey: detail.ratingKey,
            type: detail.type === 'episode' ? 'episode' : 'movie',
            title: detail.title,
            showTitle: detail.showTitle,
            seasonNumber: detail.seasonNumber,
            episodeNumber: detail.episodeNumber,
            durationMs: detail.durationMs,
            thumbUrl: this.proxyThumb(detail.ratingKey),
            quality,
            subtitleMode,
        });
        this.emitQueue();
        return {
            id: created.id,
            position: created.position,
            status: 'queued',
            ratingKey: created.ratingKey,
            type: created.type,
            title: created.title,
            showTitle: created.showTitle,
            seasonNumber: created.seasonNumber,
            episodeNumber: created.episodeNumber,
            durationMs: created.durationMs,
            thumbUrl: created.thumbUrl,
            quality: created.quality,
            subtitleMode: parseSubtitleMode(created.subtitleMode),
            error: null,
        };
    }

    private async syncLibraries(): Promise<void> {
        if (!this.client) return;
        const libraries = await this.client.getLibraries();
        replacePlexLibraries(
            this.db,
            libraries.map(library => ({
                key: library.key,
                title: library.title,
                type: library.type,
            }))
        );
    }

    private ensurePlaceholderVideo(): Promise<string> {
        const output = join(this.dataDir, 'cache', 'plex-placeholder.mp4');
        if (existsSync(output)) {
            return Promise.resolve(output);
        }
        const asset = join(process.cwd(), 'assets', 'plex-placeholder.png');
        if (!existsSync(asset)) {
            return Promise.reject(new Error('Placeholder asset is missing'));
        }
        return mkdir(join(this.dataDir, 'cache'), { recursive: true }).then(() =>
            execFileAsync(
                'ffmpeg',
                [
                    '-y',
                    '-loop',
                    '1',
                    '-i',
                    asset,
                    '-f',
                    'lavfi',
                    '-i',
                    'anullsrc=channel_layout=stereo:sample_rate=48000',
                    '-t',
                    String(PLACEHOLDER_DURATION_SECONDS),
                    '-r',
                    '30',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'veryfast',
                    '-tune',
                    'stillimage',
                    '-pix_fmt',
                    'yuv420p',
                    '-c:a',
                    'aac',
                    '-b:a',
                    '64k',
                    '-shortest',
                    '-movflags',
                    '+faststart',
                    output,
                ],
                { timeout: 120_000 }
            ).then(() => output)
        );
    }

    private async stopSession(sessionId: string): Promise<void> {
        if (!sessionId) return;
        try {
            const url = buildStopSessionUrl({
                baseUrl: this.settings.getPlexConfig().serverUrl,
                token: this.requireToken(),
                sessionId,
            });
            await fetch(url);
        } catch (error) {
            logger.warn(`Could not stop the Plex transcode session: ${error}`);
        }
    }

    private requireClient(): PlexClient {
        if (!this.client) {
            throw new Error('Plex is not configured');
        }
        return this.client;
    }

    private plexHeaders(): Record<string, string> {
        return {
            'X-Plex-Client-Identifier': this.settings.getPlexClientIdentifier(),
            'X-Plex-Product': 'OrbisCast',
            'X-Plex-Version': '1.3.0',
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Platform-Version': '140.0',
            'X-Plex-Device': 'Web',
            'X-Plex-Device-Name': 'OrbisCast',
            'X-Plex-Model': 'standalone',
            'X-Plex-Language': 'en',
            'X-Plex-Token': this.requireToken(),
        };
    }

    private async ensureProxy(): Promise<string> {
        if (!this.proxy) {
            this.proxy = new PlexProxy(this.settings.getPlexConfig().serverUrl, this.plexHeaders());
        }
        return this.proxy.start();
    }

    private requireToken(): string {
        const token = this.settings.getPlexToken();
        if (!token) {
            throw new Error('Plex token is not configured');
        }
        return token;
    }

    private requireEnabledLibrary(key: string): void {
        const library = listPlexLibraries(this.db).find(item => item.key === key);
        if (!library?.enabled) {
            throw new Error('Plex library is not enabled');
        }
    }

    private toItemDto(item: PlexItem): PlexItemDto {
        const type = normalizeItemType(item.type);
        return {
            ratingKey: item.ratingKey,
            key: item.key,
            libraryKey: item.libraryKey,
            type,
            title: item.title,
            showTitle: item.showTitle,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            year: item.year,
            durationMs: item.durationMs,
            thumbUrl: item.thumbUrl ? this.proxyThumb(item.ratingKey) : null,
            summary: item.summary,
        };
    }

    private toStreamDto(stream: PlexStream): PlexStreamDto {
        return {
            id: stream.id,
            index: stream.index,
            type: stream.type === 'audio' || stream.type === 'subtitle' ? stream.type : 'video',
            language: stream.language,
            displayTitle: stream.displayTitle ?? stream.title,
            codec: stream.codec,
            default: stream.default,
            forced: stream.forced,
            burnable: isBurnableSubtitleStream(stream),
        };
    }

    private proxyThumb(ratingKey: string): string {
        return `/api/plex/thumb/${encodeURIComponent(ratingKey)}?width=400&height=600`;
    }

    private rebuildClient(): void {
        void this.proxy?.stop();
        this.proxy = null;
        const config = this.settings.getPlexConfig();
        const token = this.settings.getPlexToken();
        this.configKey = this.configFingerprint();
        this.client =
            token && config.serverUrl
                ? new PlexClient({
                      baseUrl: config.serverUrl,
                      token,
                      clientIdentifier: this.settings.getPlexClientIdentifier(),
                  })
                : null;
        if (!this.client) {
            this.connected = false;
            this.error = 'Plex is not configured.';
        }
    }

    private onSettingsChanged(): void {
        if (this.configFingerprint() !== this.configKey) {
            this.rebuildClient();
            this.events.emit('plex', this.getConfig());
        }
    }

    private configFingerprint(): string {
        const config = this.settings.getPlexConfig();
        const token = this.settings.getPlexToken();
        const tokenKey = token ? createHash('sha256').update(token).digest('hex').slice(0, 12) : '';
        return `${config.serverUrl}|${tokenKey}`;
    }

    private emitQueue(): void {
        this.events.emit('queue', listQueue(this.db));
    }
}

function normalizeItemType(type: PlexItem['type']): PlexItemDto['type'] {
    if (type === 'movie' || type === 'show' || type === 'season' || type === 'episode') {
        return type;
    }
    throw new Error('Unsupported Plex item type');
}

function resolveSubtitleStreamIndex(streams: PlexStream[], mode: string): number | null {
    if (mode === 'off') {
        return null;
    }

    const auto = pickSubtitleStream(streams);
    if (mode === 'auto' || !mode) {
        return auto?.streamIndex ?? pickAnySubtitleIndex(streams);
    }

    const id = Number(mode);
    const byStreamId = streams.find(stream => stream.id === id && isBurnableSubtitleStream(stream));
    if (byStreamId?.index !== null && byStreamId?.index !== undefined) {
        return byStreamId.index;
    }
    const byStreamIndex = streams.find(stream => stream.index === id && isBurnableSubtitleStream(stream));
    if (byStreamIndex?.index !== null && byStreamIndex?.index !== undefined) {
        return byStreamIndex.index;
    }
    return auto?.streamIndex ?? pickAnySubtitleIndex(streams);
}

function pickAnySubtitleIndex(streams: PlexStream[]): number | null {
    const subtitles = streams.filter(isBurnableSubtitleStream);
    const preferred = subtitles.find(stream => stream.default) ?? subtitles.find(stream => stream.forced) ?? subtitles[0];
    return preferred?.index ?? null;
}

function parseSubtitleMode(value: string): 'auto' | 'off' | number {
    if (value === 'auto' || value === 'off') {
        return value;
    }
    const id = Number(value);
    return Number.isFinite(id) ? id : 'auto';
}
