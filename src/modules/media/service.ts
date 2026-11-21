import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../database/client';
import {
    addMediaQueueItem,
    clearMediaQueue,
    createMediaSource,
    deleteMediaSource,
    getMediaQueueItem,
    getMediaHistoryItem,
    getMediaSource,
    listLegacyPlexLibraries,
    listLegacyPlexQueue,
    listMediaHistory,
    listMediaLibraries,
    listMediaQueue,
    listMediaSources,
    nextQueuedMediaItem,
    removeMediaHistory,
    removeMediaQueueItem,
    replaceMediaLibraries,
    reorderMediaQueue,
    setMediaHistoryProgress,
    setMediaHistorySubtitleMode,
    setMediaLibraryEnabled,
    setMediaQueueStatus,
    setMediaQueueSubtitleMode,
    updateMediaSource,
    upsertMediaHistory,
    type MediaSourceRecord,
} from '../database/repo';
import type { SettingsService } from '../settings';
import type { MediaPlaybackProvider, PlaybackEngine, PlaybackResult, PlaybackTarget } from '../playback/engine';
import { createMediaProvider } from './providers';
import { discordHeightForQuality } from './quality';
import { isPlaybackComplete, resolveResumePosition } from './resume';
import type { MediaItem, MediaItemDetail, MediaProvider, MediaStream, PreparedPlayback } from './types';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import {
    getViewerCount,
    joinVoiceChannel,
    leaveVoiceChannel,
    pauseStreaming,
    replaceMediaStreamingSource,
    resumeStreaming,
    startMediaStreaming,
    startStreaming,
    stopStreaming,
} from '../streaming';
import type {
    ChannelDto,
    MediaHistoryDto,
    MediaItemDetailDto,
    MediaItemDto,
    MediaLibraryDto,
    MediaQuality,
    MediaSourceDto,
    MediaSourceKind,
    MediaStreamDto,
    QueueItemDto,
} from '../../shared/types';

const logger = getLogger();
const execFileAsync = promisify(execFile);
const PLACEHOLDER_DURATION_SECONDS = 6;
const HISTORY_SAVE_INTERVAL_MS = 15_000;

interface ProviderState {
    provider: MediaProvider;
    connected: boolean;
    error: string | null;
    serverVersion: string | null;
    serverName: string | null;
}

interface CurrentPlayback {
    sourceId: number;
    sourceName: string;
    sourceKind: MediaSourceKind;
    queueItem: QueueItemDto;
    detail: MediaItemDetail;
    sessionId: string;
    url: string;
    positionSeconds: number;
    startedAt: number;
    subtitleStreamIndex: number | null;
    quality: MediaQuality;
    target: PlaybackTarget;
    stopSession: () => Promise<void>;
    /** True once an intro marker was skipped or passed for this item. */
    introSkipped: boolean;
}

interface PlaceholderState {
    sourceId: number;
    channelName: string;
    idleTimer: NodeJS.Timeout;
    emptyTimer: NodeJS.Timeout;
    emptySeconds: number;
    runToken: number;
}

export interface MediaSourceInput {
    kind: MediaSourceKind;
    name: string;
    serverUrl: string;
    token?: string;
    channelName: string;
    idleMinutes?: number;
    emptyGraceSeconds?: number;
    defaultQuality?: MediaQuality;
    enabled?: boolean;
}

export type MediaSourceUpdateInput = Partial<Omit<MediaSourceInput, 'kind'>> & {
    kind?: MediaSourceKind;
};

/**
 * Multi-source media browsing, queue, and playback.
 *
 * One instance owns every configured Plex and Jellyfin source. It implements
 * the PlaybackEngine's media provider contract so the WebUI, Discord commands,
 * and the shared queue all see one playback state.
 */
export class MediaService implements MediaPlaybackProvider {
    private readonly providers = new Map<number, ProviderState>();
    private current: CurrentPlayback | null = null;
    private paused = false;
    private runToken = 0;
    private placeholder: PlaceholderState | null = null;
    private placeholderRunToken = 0;
    private historyTimer: NodeJS.Timeout | null = null;
    private introTimer: NodeJS.Timeout | null = null;
    private introSkipInFlight = false;
    private restartInFlight = false;
    private startingQueueItemId: number | null = null;

    constructor(
        private readonly db: Db,
        private readonly settings: SettingsService,
        private readonly playback: PlaybackEngine,
        private readonly events: EventEmitter,
        private readonly dataDir: string
    ) {
        this.introTimer = setInterval(() => {
            void this.checkIntroMarker();
        }, 2_000);
        this.introTimer.unref();
    }

    /**
     * Migrates legacy Plex settings, builds providers, and validates every
     * enabled source on boot.
     */
    async initialize(): Promise<void> {
        this.migrateLegacyPlex();
        await this.rebuildProviders();
        const sources = listMediaSources(this.db).filter(source => source.enabled && source.tokenEncrypted);
        await Promise.allSettled(sources.map(source => this.connect(source.id)));
    }

    /**
     * Stops the placeholder and every provider proxy on shutdown.
     */
    async shutdown(): Promise<void> {
        this.stopHistoryTimer();
        if (this.introTimer) {
            clearInterval(this.introTimer);
            this.introTimer = null;
        }
        if (this.current) {
            const positionMs = this.currentPosition(this.current) * 1000;
            this.recordHistory(
                this.current,
                positionMs,
                isPlaybackComplete(positionMs, this.currentDuration(this.current)),
                false
            );
        }
        await this.stopPlaceholder(false);
        await Promise.allSettled([...this.providers.values()].map(state => state.provider.shutdown()));
        this.providers.clear();
    }

    /**
     * Returns every configured media source with live connection state, in the
     * operator's saved tab order. Sources not in the saved order stay in name
     * order after the ordered ones.
     */
    getSources(): MediaSourceDto[] {
        const rows = listMediaSources(this.db);
        const order = this.settings.getUi().mediaSourceOrder;
        const byId = new Map(rows.map(source => [source.id, source]));
        const ordered = order
            .map(id => byId.get(id))
            .filter((source): source is MediaSourceRecord => Boolean(source));
        const known = new Set(ordered.map(source => source.id));
        return [...ordered, ...rows.filter(source => !known.has(source.id))].map(source =>
            this.toSourceDto(source)
        );
    }

    /**
     * Saves the media source tab order.
     *
     * @param ids - Source ids in display order
     */
    reorderSources(ids: number[]): MediaSourceDto[] {
        const existing = new Set(listMediaSources(this.db).map(source => source.id));
        this.settings.setMediaSourceOrder(ids.filter(id => existing.has(id)));
        const sources = this.getSources();
        this.events.emit('media', sources);
        return sources;
    }

    /**
     * Returns one configured source.
     *
     * @param id - Media source id
     */
    getSource(id: number): MediaSourceDto | undefined {
        const source = getMediaSource(this.db, id);
        return source ? this.toSourceDto(source) : undefined;
    }

    /**
     * Creates a source and validates it immediately.
     *
     * @param input - Source connection and channel settings
     */
    async createSource(input: MediaSourceInput): Promise<MediaSourceDto> {
        const token = input.token?.trim();
        if (!token) {
            throw new Error('A server token is required');
        }
        const secret = this.settings.encodeSecret(token);
        const row = createMediaSource(this.db, {
            kind: input.kind,
            name: input.name.trim() || (input.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'),
            baseUrl: input.serverUrl.trim(),
            tokenEncrypted: secret.encrypted,
            tokenLast4: secret.last4,
            clientIdentifier: randomUUID(),
            channelName: input.channelName.trim() || (input.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'),
            idleMinutes: input.idleMinutes,
            emptyGraceSeconds: input.emptyGraceSeconds,
            defaultQuality: input.defaultQuality,
            enabled: input.enabled,
        });
        await this.rebuildProvider(row.id);
        return this.connect(row.id);
    }

    /**
     * Updates a source and validates the new connection.
     *
     * @param id - Media source id
     * @param input - Changed fields
     */
    async updateSource(id: number, input: MediaSourceUpdateInput): Promise<MediaSourceDto> {
        const existing = getMediaSource(this.db, id);
        if (!existing) {
            throw new Error('Media source not found');
        }
        const patch: Parameters<typeof updateMediaSource>[2] = {
            kind: input.kind,
            name: input.name?.trim(),
            baseUrl: input.serverUrl?.trim(),
            channelName: input.channelName?.trim(),
            idleMinutes: input.idleMinutes,
            emptyGraceSeconds: input.emptyGraceSeconds,
            defaultQuality: input.defaultQuality,
            enabled: input.enabled,
        };
        if (input.kind === 'plex') {
            patch.userId = null;
            patch.userName = null;
        }
        if (input.token !== undefined) {
            const token = input.token.trim();
            if (!token) {
                throw new Error('A server token is required');
            }
            const secret = this.settings.encodeSecret(token);
            patch.tokenEncrypted = secret.encrypted;
            patch.tokenLast4 = secret.last4;
        }
        const connectionChanged =
            (input.kind !== undefined && input.kind !== existing.kind) ||
            (input.serverUrl !== undefined && input.serverUrl.trim() !== existing.baseUrl) ||
            input.token !== undefined;
        const row = updateMediaSource(this.db, id, patch);
        if (!row) {
            throw new Error('Media source not found');
        }
        if (connectionChanged) {
            await this.rebuildProvider(id);
        }
        return this.connect(id);
    }

    /**
     * Deletes a source. Playback from that source is stopped first.
     *
     * @param id - Media source id
     */
    async deleteSource(id: number): Promise<void> {
        if (this.current?.sourceId === id) {
            await this.stop();
            await leaveVoiceChannel();
        }
        if (this.placeholder?.sourceId === id) {
            await this.stopPlaceholder(true);
        }
        const provider = this.providers.get(id);
        if (provider) {
            await provider.provider.shutdown();
            this.providers.delete(id);
        }
        deleteMediaSource(this.db, id);
        this.events.emit('media', this.getSources());
        this.emitHistory();
    }

    /**
     * Validates a source and syncs its libraries.
     *
     * @param id - Media source id
     */
    async connect(id: number): Promise<MediaSourceDto> {
        const source = getMediaSource(this.db, id);
        if (!source) {
            throw new Error('Media source not found');
        }
        const state = this.providers.get(id);
        if (!state) {
            this.events.emit('media', this.getSources());
            return this.toSourceDto(source);
        }
        try {
            const info = await state.provider.validate();
            const libraries = await state.provider.getLibraries();
            replaceMediaLibraries(
                this.db,
                id,
                libraries.map(library => ({
                    key: library.key,
                    title: library.title,
                    type: library.type,
                }))
            );
            if (source.kind === 'jellyfin') {
                updateMediaSource(this.db, id, {
                    userId: info.userId,
                    userName: info.userName,
                });
            }
            state.connected = true;
            state.error = null;
            state.serverVersion = info.version;
            state.serverName = info.name;
            logger.info(`${labelFor(source.kind)} source "${source.name}" connected`);
        } catch (error) {
            state.connected = false;
            state.error = redactSecrets(error instanceof Error ? error.message : String(error));
            logger.error(`${labelFor(source.kind)} source "${source.name}" failed: ${state.error}`);
        }
        this.events.emit('media', this.getSources());
        const refreshed = getMediaSource(this.db, id);
        return this.toSourceDto(refreshed ?? source);
    }

    /**
     * Rebuilds one provider without disturbing playback from other sources.
     *
     * @param id - Media source id
     */
    async rebuildProvider(id: number): Promise<void> {
        const existing = this.providers.get(id);
        if (existing) {
            await existing.provider.shutdown();
            this.providers.delete(id);
        }
        const source = getMediaSource(this.db, id);
        if (!source) return;
        let token: string | null = null;
        try {
            token = this.settings.decodeSecret(source.tokenEncrypted);
        } catch (error) {
            logger.error(`Could not decrypt ${labelFor(source.kind)} token: ${error}`);
        }
        if (!token) return;
        try {
            this.providers.set(id, {
                provider: createMediaProvider(source, token),
                connected: false,
                error: null,
                serverVersion: null,
                serverName: null,
            });
        } catch (error) {
            logger.error(`Could not build ${labelFor(source.kind)} provider: ${error}`);
        }
    }

    /**
     * Rebuilds every provider after a source change.
     */
    async rebuildProviders(): Promise<void> {
        const old = [...this.providers.values()];
        this.providers.clear();
        await Promise.allSettled(old.map(state => state.provider.shutdown()));

        for (const source of listMediaSources(this.db)) {
            let token: string | null = null;
            try {
                token = this.settings.decodeSecret(source.tokenEncrypted);
            } catch (error) {
                logger.error(`Could not decrypt ${labelFor(source.kind)} token: ${error}`);
            }
            if (!token) continue;
            try {
                this.providers.set(source.id, {
                    provider: createMediaProvider(source, token),
                    connected: false,
                    error: null,
                    serverVersion: null,
                    serverName: null,
                });
            } catch (error) {
                logger.error(`Could not build ${labelFor(source.kind)} provider: ${error}`);
            }
        }
    }

    /**
     * Lists a source's libraries.
     *
     * @param sourceId - Media source id
     */
    getLibraries(sourceId: number): MediaLibraryDto[] {
        this.requireSource(sourceId);
        return listMediaLibraries(this.db, sourceId);
    }

    /**
     * Enables or disables a library.
     *
     * @param sourceId - Media source id
     * @param key - Library key
     * @param enabled - New state
     */
    setLibraryEnabled(sourceId: number, key: string, enabled: boolean): MediaLibraryDto[] {
        this.requireSource(sourceId);
        setMediaLibraryEnabled(this.db, sourceId, key, enabled);
        return listMediaLibraries(this.db, sourceId);
    }

    /**
     * Searches the enabled libraries of one source.
     *
     * @param sourceId - Media source id
     * @param query - Search text
     */
    async search(sourceId: number, query: string): Promise<MediaItemDto[]> {
        const provider = this.requireProvider(sourceId);
        const enabled = listMediaLibraries(this.db, sourceId)
            .filter(library => library.enabled)
            .map(library => library.key);
        if (enabled.length === 0) {
            return [];
        }
        const items = await provider.search(query, enabled);
        return items.map(item => this.toItemDto(sourceId, item));
    }

    /**
     * Reads one page of a library.
     *
     * @param sourceId - Media source id
     * @param libraryKey - Library key
     * @param start - Zero-based offset
     * @param size - Page size
     */
    async getLibraryItems(
        sourceId: number,
        libraryKey: string,
        start: number,
        size: number
    ): Promise<{ items: MediaItemDto[]; total: number }> {
        const provider = this.requireProvider(sourceId);
        this.requireEnabledLibrary(sourceId, libraryKey);
        const page = await provider.getLibraryItems(libraryKey, start, size);
        return {
            items: page.items.map(item => this.toItemDto(sourceId, item)),
            total: page.total,
        };
    }

    /**
     * Lists the children of a show or season.
     *
     * @param sourceId - Media source id
     * @param itemId - Show or season id
     */
    async getChildren(sourceId: number, itemId: string): Promise<MediaItemDto[]> {
        const provider = this.requireProvider(sourceId);
        const detail = await provider.getItem(itemId);
        if (detail.type === 'show') {
            return (await provider.getSeasons(itemId)).map(item => this.toItemDto(sourceId, item));
        }
        if (detail.type === 'season') {
            return (await provider.getEpisodes(itemId)).map(item => this.toItemDto(sourceId, item));
        }
        return [];
    }

    /**
     * Loads full item metadata, including audio and subtitle streams.
     *
     * @param sourceId - Media source id
     * @param itemId - Item id
     */
    async getItem(sourceId: number, itemId: string): Promise<MediaItemDetailDto> {
        const provider = this.requireProvider(sourceId);
        const detail = await provider.getItem(itemId);
        return this.toDetailDto(sourceId, detail);
    }

    /**
     * Fetches a thumbnail with the provider token kept on the server.
     *
     * @param sourceId - Media source id
     * @param itemId - Item id
     * @param width - Optional width
     * @param height - Optional height
     */
    async fetchThumbnail(
        sourceId: number,
        itemId: string,
        width?: number,
        height?: number
    ): Promise<{ contentType: string; body: Buffer }> {
        const provider = this.requireProvider(sourceId);
        const targetWidth = width ?? 400;
        const targetHeight = height ?? Math.round(targetWidth * 1.5);
        return provider.fetchThumbnail(itemId, targetWidth, targetHeight);
    }

    /**
     * Returns the persisted global queue.
     */
    getQueue(): QueueItemDto[] {
        return listMediaQueue(this.db);
    }

    /**
     * Returns resumable playback history, newest first.
     *
     * @param limit - Maximum number of entries
     */
    getHistory(limit = 20): MediaHistoryDto[] {
        const current = this.current;
        return listMediaHistory(this.db, Math.max(limit * 3, 20))
            .map(entry => {
                if (
                    !current ||
                    current.sourceId !== entry.sourceId ||
                    current.detail.itemId !== entry.itemId
                ) {
                    return entry;
                }
                return {
                    ...entry,
                    positionMs: Math.round(this.currentPosition(current) * 1000),
                    completed: false,
                };
            })
            .filter(entry => resolveResumePosition(entry) > 0)
            .slice(0, limit);
    }

    /**
     * Returns resumable history plus next-episode recommendations for recently
     * finished series. Recommendations are synthetic rows with a zero position
     * and negative ids, so they cannot be removed like saved history.
     *
     * @param limit - Maximum number of entries
     */
    async getHistoryWithNext(limit = 20): Promise<MediaHistoryDto[]> {
        const resumable = this.getHistory(limit);
        const resumableKeys = new Set(resumable.map(entry => `${entry.sourceId}:${entry.itemId}`));
        const recommendations = (await this.getNextEpisodeRecommendations(3)).filter(
            entry => !resumableKeys.has(`${entry.sourceId}:${entry.itemId}`)
        );
        return [...recommendations, ...resumable].slice(0, limit);
    }

    /**
     * Finds the next unwatched episode for the most recently finished episode
     * of each series.
     *
     * @param max - Maximum recommendations
     */
    private async getNextEpisodeRecommendations(max: number): Promise<MediaHistoryDto[]> {
        const rows = listMediaHistory(this.db, Math.max(max * 8, 30), true);
        const seenShows = new Set<string>();
        const recommendations: MediaHistoryDto[] = [];
        for (const entry of rows) {
            if (!entry.completed || entry.type !== 'episode') {
                continue;
            }
            const showKey = `${entry.sourceId}:${entry.showTitle ?? entry.itemId}`;
            if (seenShows.has(showKey)) {
                continue;
            }
            seenShows.add(showKey);

            try {
                const provider = this.requireProvider(entry.sourceId);
                const currentDetail = await provider.getItem(entry.itemId);
                if (currentDetail.type !== 'episode' || !currentDetail.showItemId) {
                    continue;
                }
                const episodes = await provider.getAllEpisodes(currentDetail.showItemId);
                const index = episodes.findIndex(episode => episode.itemId === currentDetail.itemId);
                if (index < 0) {
                    continue;
                }

                for (const candidate of episodes.slice(index + 1)) {
                    if (
                        this.current &&
                        this.current.sourceId === entry.sourceId &&
                        this.current.detail.itemId === candidate.itemId
                    ) {
                        break;
                    }
                    const history = getMediaHistoryItem(
                        this.db,
                        entry.sourceId,
                        candidate.itemId
                    );
                    if (history?.completed) {
                        continue;
                    }
                    if (history && resolveResumePosition(history) > 0) {
                        break;
                    }
                    const detail = await provider.getItem(candidate.itemId);
                    const mode = String(entry.subtitleMode);
                    recommendations.push({
                        id: -(Date.now() + recommendations.length),
                        sourceId: entry.sourceId,
                        sourceName: entry.sourceName,
                        sourceKind: entry.sourceKind,
                        itemId: detail.itemId,
                        type: 'episode',
                        title: detail.title,
                        showTitle: detail.showTitle,
                        seasonNumber: detail.seasonNumber,
                        episodeNumber: detail.episodeNumber,
                        durationMs: detail.durationMs,
                        thumbUrl: this.proxyThumb(entry.sourceId, detail.itemId),
                        positionMs: 0,
                        completed: false,
                        quality: entry.quality,
                        subtitleMode: mode === 'off' ? 'off' : 'auto',
                        playedAt: Date.now(),
                        recommended: true,
                    });
                    seenShows.add(showKey);
                    break;
                }
            } catch (error) {
                logger.debug(
                    `Could not build a next-episode recommendation: ${redactSecrets(
                        error instanceof Error ? error.message : String(error)
                    )}`
                );
            }

            if (recommendations.length >= max) {
                break;
            }
        }
        return recommendations;
    }

    /**
     * Removes one entry from the resume list.
     *
     * @param id - History entry id
     */
    removeHistory(id: number): boolean {
        const removed = removeMediaHistory(this.db, id);
        if (removed) {
            this.emitHistory();
        }
        return removed;
    }

    /**
     * Returns the active media item with its streams, or null when nothing is
     * playing. The WebUI uses it for mid-stream subtitle controls.
     */
    getCurrentItem(): MediaItemDetailDto | null {
        const current = this.current;
        return current ? this.toDetailDto(current.sourceId, current.detail) : null;
    }

    /**
     * Switches the active subtitle track without recreating the Discord stream.
     * The provider source is rebuilt at the current position.
     *
     * @param mode - Auto, off, or a subtitle stream id
     */
    async setSubtitleMode(mode: string): Promise<PlaybackResult> {
        const current = this.current;
        if (!current) {
            return { ok: false, message: 'Media playback is not active.' };
        }

        if (this.restartInFlight) {
            return { ok: false, message: 'A seek is already in progress.' };
        }

        const subtitleStreamIndex = resolveSubtitleStreamIndex(current.detail.streams, mode);
        const position = this.currentPosition(current);
        const wasPaused = this.paused;

        const previousStop = current.stopSession;
        const sessionId = randomUUID();
        if (subtitleStreamIndex !== current.subtitleStreamIndex) {
            this.restartInFlight = true;
            let prepared: PreparedPlayback | null = null;
            try {
                prepared = await this.preparePlayback(
                    current,
                    position,
                    sessionId,
                    subtitleStreamIndex
                );
                if (this.current !== current) {
                    await prepared.stop();
                    return { ok: false, message: 'Playback changed before the subtitle switch.' };
                }
                const replaced = await replaceMediaStreamingSource(prepared.url);
                if (!replaced) {
                    await prepared.stop();
                    return { ok: false, message: 'The media stream is not active.' };
                }
                if (wasPaused) {
                    pauseStreaming();
                    this.playback.setMediaPaused(true);
                }
                await previousStop();
                if (this.current !== current) {
                    await prepared.stop();
                    return { ok: false, message: 'Playback changed before the subtitle switch.' };
                }

                current.sessionId = sessionId;
                current.url = prepared.url;
                current.stopSession = prepared.stop;
                current.subtitleStreamIndex = subtitleStreamIndex;
                current.positionSeconds = position;
                current.startedAt = Date.now();
                this.paused = wasPaused;
                this.playback.setMediaPaused(wasPaused);
                this.playback.setMediaProgress(
                    Math.round(position * 1000),
                    this.currentDuration(current)
                );
                this.startHistoryTimer();
            } catch (error) {
                await prepared?.stop();
                const message = redactSecrets(error instanceof Error ? error.message : String(error));
                logger.error(`Media subtitle switch failed: ${message}`);
                return { ok: false, message: 'The media source could not change subtitles.' };
            } finally {
                this.restartInFlight = false;
            }
        }

        const storedMode = String(mode);
        current.queueItem.subtitleMode =
            storedMode === 'auto' || storedMode === 'off'
                ? storedMode
                : Number.isFinite(Number(storedMode))
                  ? Number(storedMode)
                  : 'auto';
        setMediaQueueSubtitleMode(this.db, current.queueItem.id, storedMode);
        setMediaHistorySubtitleMode(
            this.db,
            current.sourceId,
            current.detail.itemId,
            storedMode
        );
        this.emitQueue();
        this.emitHistory();
        return { ok: true, message: 'Subtitles changed.' };
    }

    /**
     * Skips a Plex intro marker once per item when the operator enabled it.
     */
    private async checkIntroMarker(): Promise<void> {
        const current = this.current;
        if (!current || this.paused || this.introSkipInFlight || this.restartInFlight) {
            return;
        }
        const intro = current.detail.intro;
        if (!intro || current.introSkipped || !this.settings.getPlayback().autoSkipIntro) {
            return;
        }
        const positionMs = this.currentPosition(current) * 1000;
        if (positionMs < intro.startMs) {
            return;
        }
        if (positionMs >= intro.endMs - 500) {
            current.introSkipped = true;
            return;
        }

        current.introSkipped = true;
        this.introSkipInFlight = true;
        logger.info('Skipping the Plex intro marker');
        try {
            const result = await this.seek(intro.endMs / 1000);
            if (!result.ok) {
                if (this.current === current) {
                    current.introSkipped = false;
                }
                logger.warn(`Intro skip failed: ${result.message}`);
            }
        } finally {
            this.introSkipInFlight = false;
        }
    }

    /**
     * Starts a specific queued item. The chosen item moves to the front.
     *
     * @param id - Queue item id
     * @param target - Guild and voice channel
     * @param startOver - Ignore saved progress and start from zero
     */
    async playQueueItem(id: number, target: PlaybackTarget, startOver = false): Promise<PlaybackResult> {
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        const item = getMediaQueueItem(this.db, id);
        if (!item) {
            return { ok: false, message: 'Queue item not found.' };
        }
        setMediaQueueStatus(this.db, id, 'queued');
        const ids = listMediaQueue(this.db)
            .map(entry => entry.id)
            .filter(entryId => entryId !== id);
        reorderMediaQueue(this.db, [id, ...ids]);
        this.emitQueue();
        return this.playQueue(target, startOver);
    }

    /**
     * Starts an item immediately by adding it to the queue first.
     *
     * @param sourceId - Media source id
     * @param itemId - Item id
     * @param quality - Quality preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     * @param target - Guild and voice channel
     * @param startOver - Ignore saved progress and start from zero
     */
    async playNow(
        sourceId: number,
        itemId: string,
        quality: MediaQuality,
        subtitleMode: string,
        target: PlaybackTarget,
        startOver = false
    ): Promise<PlaybackResult> {
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        const created = await this.addToQueue(sourceId, itemId, quality, subtitleMode);
        return this.playQueueItem(created.id, target, startOver);
    }

    /**
     * Adds one movie or episode to the queue.
     *
     * @param sourceId - Media source id
     * @param itemId - Item id
     * @param quality - Quality preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addToQueue(
        sourceId: number,
        itemId: string,
        quality: MediaQuality,
        subtitleMode: string
    ): Promise<QueueItemDto> {
        const provider = this.requireProvider(sourceId);
        const detail = await provider.getItem(itemId);
        if (detail.type !== 'movie' && detail.type !== 'episode') {
            throw new Error('Only movies and episodes can be queued');
        }
        return this.addDetailToQueue(sourceId, detail, quality, subtitleMode);
    }

    /**
     * Adds every episode of a season.
     *
     * @param sourceId - Media source id
     * @param seasonId - Season id
     * @param quality - Quality preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addSeasonToQueue(
        sourceId: number,
        seasonId: string,
        quality: MediaQuality,
        subtitleMode: string
    ): Promise<QueueItemDto[]> {
        const provider = this.requireProvider(sourceId);
        const episodes = await provider.getEpisodes(seasonId);
        const added: QueueItemDto[] = [];
        for (const episode of episodes) {
            const detail = await provider.getItem(episode.itemId);
            added.push(this.addDetailToQueue(sourceId, detail, quality, subtitleMode));
        }
        return added;
    }

    /**
     * Adds every episode of a show.
     *
     * @param sourceId - Media source id
     * @param showId - Show id
     * @param quality - Quality preset
     * @param subtitleMode - Auto, off, or an explicit stream id
     */
    async addShowToQueue(
        sourceId: number,
        showId: string,
        quality: MediaQuality,
        subtitleMode: string
    ): Promise<QueueItemDto[]> {
        const provider = this.requireProvider(sourceId);
        const episodes = await provider.getAllEpisodes(showId);
        const added: QueueItemDto[] = [];
        for (const episode of episodes) {
            const detail = await provider.getItem(episode.itemId);
            added.push(this.addDetailToQueue(sourceId, detail, quality, subtitleMode));
        }
        return added;
    }

    /**
     * Moves a queue item one position up or down.
     *
     * @param id - Queue item id
     * @param direction - Up or down
     */
    moveQueueItem(id: number, direction: 'up' | 'down'): QueueItemDto[] {
        const items = listMediaQueue(this.db);
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
        reorderMediaQueue(this.db, ids);
        this.emitQueue();
        return listMediaQueue(this.db);
    }

    /**
     * Shuffles the queue and returns the new order.
     */
    shuffleQueue(): QueueItemDto[] {
        const ids = listMediaQueue(this.db).map(item => item.id);
        for (let index = ids.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
        }
        reorderMediaQueue(this.db, ids);
        this.emitQueue();
        return listMediaQueue(this.db);
    }

    /**
     * Removes a queue item.
     *
     * @param id - Queue item id
     */
    removeQueueItem(id: number): boolean {
        const activeId = this.current?.queueItem.id ?? this.startingQueueItemId;
        if (activeId === id) {
            return false;
        }
        const removed = removeMediaQueueItem(this.db, id);
        this.emitQueue();
        return removed;
    }

    /**
     * Clears the queue but keeps the item that is currently playing.
     */
    clearQueue(): void {
        clearMediaQueue(this.db, this.current?.queueItem.id ?? this.startingQueueItemId ?? undefined);
        this.emitQueue();
    }

    /**
     * Starts the queue in the requested voice channel.
     *
     * @param target - Guild and voice channel
     * @param startOver - Ignore saved progress and start from zero
     */
    async playQueue(target: PlaybackTarget, startOver = false): Promise<PlaybackResult> {
        if (this.playback.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        if (this.playback.getState().mode === 'placeholder') {
            await this.stopPlaceholder(false);
        }

        const next = nextQueuedMediaItem(this.db);
        if (!next) {
            await leaveVoiceChannel();
            return { ok: false, message: 'The queue is empty.' };
        }

        const joined = await joinVoiceChannel(target.guildId, target.voiceChannelId);
        if (!joined) {
            return { ok: false, message: 'Failed to join the voice channel.' };
        }

        try {
            await this.startItem(next, target, startOver);
            return { ok: true, message: `Playing ${next.title}` };
        } catch (error) {
            const message = redactSecrets(error instanceof Error ? error.message : String(error));
            logger.error(`Failed to start media playback: ${message}`);
            await leaveVoiceChannel();
            return { ok: false, message };
        }
    }

    /**
     * Joins voice and loops the on-demand placeholder for a source.
     *
     * @param sourceId - Media source id
     * @param target - Guild and voice channel
     */
    async startPlaceholder(sourceId: number, target: PlaybackTarget): Promise<PlaybackResult> {
        const source = this.requireSource(sourceId);
        if (!source.enabled) {
            return { ok: false, message: 'This media source is disabled.' };
        }
        if (!source.tokenEncrypted) {
            return { ok: false, message: 'This media source is not configured.' };
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
            logger.error(`Placeholder generation failed: ${error}`);
            await leaveVoiceChannel();
            return { ok: false, message: 'Could not generate the on-demand placeholder video.' };
        }

        this.playback.beginPlaceholderState({
            sourceId,
            sourceName: source.name,
            sourceKind: source.kind,
            title: source.channelName,
        });

        const runToken = ++this.placeholderRunToken;
        const state: PlaceholderState = {
            sourceId,
            channelName: source.channelName,
            idleTimer: setTimeout(() => {
                void this.stopPlaceholder(true);
            }, Math.max(1, source.idleMinutes) * 60_000),
            emptyTimer: setInterval(() => {
                if (!this.placeholder) return;
                if (getViewerCount() === 0) {
                    this.placeholder.emptySeconds += 10;
                    if (this.placeholder.emptySeconds >= Math.max(1, source.emptyGraceSeconds)) {
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
                tvg_name: source.channelName,
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

        return {
            ok: true,
            message: `${source.channelName} is on demand. Choose something in the WebUI.`,
        };
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

    /**
     * Returns virtual Discord channels for every enabled media source.
     */
    getChannels(): ChannelDto[] {
        const state = this.playback.getState();
        return listMediaSources(this.db)
            .filter(source => source.enabled && source.tokenEncrypted)
            .map(source => ({
                id: -source.id,
                sourceId: source.id,
                sourceName: source.name,
                name: source.channelName,
                logo: null,
                group: null,
                tvgId: null,
                visible: true,
                kind: source.kind,
                nowPlaying:
                    state.mode === 'media' && state.sourceId === source.id ? state.title : null,
                next: null,
            }));
    }

    /**
     * Pauses the active media item by freezing FFmpeg.
     */
    async pause(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current || this.paused) {
            return { ok: false, message: 'Media playback is not active.' };
        }
        if (this.restartInFlight) {
            return { ok: false, message: 'A source change is in progress.' };
        }
        if (!pauseStreaming()) {
            return { ok: false, message: 'Media playback is not active.' };
        }
        const position = this.currentPosition(current);
        current.positionSeconds = position;
        current.startedAt = 0;
        this.paused = true;
        this.playback.setMediaPaused(true);
        this.playback.setMediaProgress(Math.round(position * 1000), this.currentDuration(current));
        setMediaHistoryProgress(
            this.db,
            current.sourceId,
            current.detail.itemId,
            position * 1000,
            false
        );
        this.emitHistory();
        return { ok: true, message: 'Playback paused.' };
    }

    /**
     * Resumes the active media item.
     */
    async resume(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current || !this.paused) {
            return { ok: false, message: 'Media playback is not paused.' };
        }
        if (this.restartInFlight) {
            return { ok: false, message: 'A source change is in progress.' };
        }
        if (!resumeStreaming()) {
            return { ok: false, message: 'Media playback is not active.' };
        }
        current.startedAt = Date.now();
        this.paused = false;
        this.playback.setMediaPaused(false);
        this.playback.setMediaProgress(
            Math.round(current.positionSeconds * 1000),
            this.currentDuration(current)
        );
        return { ok: true, message: 'Playback resumed.' };
    }

    /**
     * Seeks by preparing a new provider stream at the offset and swapping it
     * into the live Discord stream.
     *
     * @param seconds - Target offset in seconds
     */
    async seek(seconds: number): Promise<PlaybackResult> {
        const current = this.current;
        if (!current) {
            return { ok: false, message: 'Media playback is not active.' };
        }
        const duration = this.currentDuration(current) ?? 0;
        const upper = duration > 0 ? Math.max(0, duration / 1000 - 1) : seconds;
        const target = Math.max(0, Math.min(seconds, upper));

        if (this.restartInFlight) {
            return { ok: false, message: 'A seek is already in progress.' };
        }

        const oldStop = current.stopSession;
        const sessionId = randomUUID();
        let prepared: PreparedPlayback | null = null;
        this.restartInFlight = true;
        try {
            prepared = await this.preparePlayback(current, target, sessionId);
            if (this.current !== current) {
                await prepared.stop();
                return { ok: false, message: 'Playback changed before the seek.' };
            }
            const replaced = await replaceMediaStreamingSource(prepared.url);
            if (!replaced) {
                await prepared.stop();
                return { ok: false, message: 'The media stream is not active.' };
            }
            await oldStop();
            if (this.current !== current) {
                await prepared.stop();
                return { ok: false, message: 'Playback changed before the seek.' };
            }

            current.sessionId = sessionId;
            current.url = prepared.url;
            current.stopSession = prepared.stop;
            current.positionSeconds = target;
            current.startedAt = Date.now();
            this.paused = false;
            this.playback.setMediaPaused(false);
            this.playback.setMediaProgress(
                Math.round(target * 1000),
                this.currentDuration(current)
            );
            const intro = current.detail.intro;
            current.introSkipped = intro ? target * 1000 >= intro.startMs : false;
            setMediaHistoryProgress(
                this.db,
                current.sourceId,
                current.detail.itemId,
                target * 1000,
                false
            );
            this.startHistoryTimer();
            this.emitHistory();
            return { ok: true, message: 'Playback seeked.' };
        } catch (error) {
            await prepared?.stop();
            const message = redactSecrets(error instanceof Error ? error.message : String(error));
            logger.error(`Media seek failed: ${message}`);
            return { ok: false, message: 'The media source could not seek to that position.' };
        } finally {
            this.restartInFlight = false;
        }
    }

    /**
     * Skips the current item and advances the queue.
     */
    async skip(): Promise<PlaybackResult> {
        const current = this.current;
        if (!current) {
            return { ok: false, message: 'Media playback is not active.' };
        }
        this.runToken++;
        this.stopHistoryTimer();
        this.current = null;
        const positionMs = this.currentPosition(current) * 1000;
        this.recordHistory(
            current,
            positionMs,
            isPlaybackComplete(positionMs, this.currentDuration(current))
        );
        await stopStreaming();
        await current.stopSession();
        removeMediaQueueItem(this.db, current.queueItem.id);
        await this.advance(current.target);
        return { ok: true, message: 'Skipped.' };
    }

    /**
     * Stops media playback and removes the current item from the queue. An item
     * watched to at least 85 percent is saved as completed instead of resumable.
     */
    async stop(): Promise<void> {
        this.runToken++;
        this.stopHistoryTimer();
        if (this.placeholder) {
            await this.stopPlaceholder(false);
        }
        const current = this.current;
        this.current = null;
        if (current) {
            const positionMs = this.currentPosition(current) * 1000;
            this.recordHistory(
                current,
                positionMs,
                isPlaybackComplete(positionMs, this.currentDuration(current))
            );
        }
        await stopStreaming();
        if (current) {
            await current.stopSession();
            removeMediaQueueItem(this.db, current.queueItem.id);
        }
        this.paused = false;
        this.playback.endMediaState();
        this.emitQueue();
        this.emitHistory();
    }

    private async runCurrent(token: number): Promise<void> {
        const current = this.current;
        if (!current) return;

        const result = await startMediaStreaming(
            {
                xui_id: 0,
                tvg_name: current.detail.title,
                url: current.url,
            },
            {
                inputOptions: ['-re'],
                maxHeight: discordHeightForQuality(current.quality),
            }
        );
        if (token !== this.runToken) {
            return;
        }
        this.stopHistoryTimer();
        await current.stopSession();
        if (result.aborted) {
            return;
        }

        const durationMs = this.currentDuration(current);
        const positionMs = durationMs ?? this.currentPosition(current) * 1000;
        if (result.error) {
            this.recordHistory(current, Math.min(positionMs, durationMs ?? positionMs), false);
            setMediaQueueStatus(this.db, current.queueItem.id, 'failed', redactSecrets(result.error));
            logger.error(`Media item failed: ${redactSecrets(result.error)}`);
        } else {
            this.recordHistory(current, positionMs, true);
            removeMediaQueueItem(this.db, current.queueItem.id);
        }

        this.current = null;
        await this.advance(current.target, result.error ? undefined : current);
    }

    /**
     * Starts the next queued item. When the queue is empty and autoplay is on,
     * the next episode of the finished item is queued and started.
     *
     * @param target - Guild and voice channel
     * @param autoplayFrom - Finished item that may provide a next episode
     */
    private async advance(target: PlaybackTarget, autoplayFrom?: CurrentPlayback): Promise<void> {
        const guard = this.runToken;
        let autoplayAttempted = false;
        while (true) {
            if (guard !== this.runToken) {
                return;
            }
            let next = nextQueuedMediaItem(this.db);
            if (
                !next &&
                autoplayFrom &&
                !autoplayAttempted &&
                this.settings.getPlayback().autoplayNextEpisode
            ) {
                autoplayAttempted = true;
                try {
                    next = (await this.enqueueNextEpisode(autoplayFrom)) ?? undefined;
                } catch (error) {
                    logger.error(
                        `Could not queue the next episode: ${redactSecrets(
                            error instanceof Error ? error.message : String(error)
                        )}`
                    );
                }
                if (guard !== this.runToken) {
                    return;
                }
            }
            if (!next) {
                await leaveVoiceChannel();
                this.playback.endMediaState();
                this.emitQueue();
                return;
            }
            try {
                await this.startItem(next, target);
                return;
            } catch (error) {
                const message = redactSecrets(error instanceof Error ? error.message : String(error));
                setMediaQueueStatus(this.db, next.id, 'failed', message);
                logger.error(`Media queue item failed to start: ${message}`);
                this.emitQueue();
            }
        }
    }

    /**
     * Finds the episode after the given one in the same show.
     *
     * @param current - Active playback
     */
    private async nextEpisodeFor(current: CurrentPlayback): Promise<MediaItem | null> {
        if (current.detail.type !== 'episode' || !current.detail.showItemId) {
            return null;
        }
        const provider = this.requireProvider(current.sourceId);
        const episodes = await provider.getAllEpisodes(current.detail.showItemId);
        const index = episodes.findIndex(episode => episode.itemId === current.detail.itemId);
        if (index < 0) {
            return null;
        }
        return episodes[index + 1] ?? null;
    }

    /**
     * Adds the next episode to the queue.
     *
     * @param current - Finished item
     */
    private async enqueueNextEpisode(current: CurrentPlayback): Promise<QueueItemDto | null> {
        const next = await this.nextEpisodeFor(current);
        if (!next) {
            return null;
        }
        const provider = this.requireProvider(current.sourceId);
        const detail = await provider.getItem(next.itemId);
        const mode = String(current.queueItem.subtitleMode);
        return this.addDetailToQueue(
            current.sourceId,
            detail,
            current.quality,
            mode === 'off' ? 'off' : 'auto'
        );
    }

    private async startItem(
        queueItem: QueueItemDto,
        target: PlaybackTarget,
        startOver = false
    ): Promise<void> {
        const guard = this.runToken;
        this.startingQueueItemId = queueItem.id;
        const provider = this.requireProvider(queueItem.sourceId);
        let detail: MediaItemDetail;
        try {
            detail = await provider.getItem(queueItem.itemId);
        } catch (error) {
            this.startingQueueItemId = null;
            throw error;
        }
        if (guard !== this.runToken) {
            this.startingQueueItemId = null;
            return;
        }
        const quality = queueItem.quality;
        const subtitleStreamIndex = resolveSubtitleStreamIndex(detail.streams, queueItem.subtitleMode);
        const sessionId = randomUUID();
        let resumeMs = startOver
            ? 0
            : resolveResumePosition(
                  getMediaHistoryItem(this.db, queueItem.sourceId, detail.itemId),
                  detail.durationMs
              );
        let introSkipped = false;
        const intro = detail.intro;
        if (
            this.settings.getPlayback().autoSkipIntro &&
            intro &&
            resumeMs >= intro.startMs &&
            resumeMs < intro.endMs
        ) {
            resumeMs = intro.endMs;
            introSkipped = true;
        }
        const offsetSeconds = resumeMs / 1000;
        let prepared: PreparedPlayback;
        try {
            prepared = await provider.preparePlayback({
                item: detail,
                quality,
                subtitleStreamIndex,
                offsetSeconds,
                sessionId,
            });
        } catch (error) {
            this.startingQueueItemId = null;
            throw error;
        }
        if (guard !== this.runToken) {
            this.startingQueueItemId = null;
            await prepared.stop();
            return;
        }
        this.startingQueueItemId = null;

        this.current = {
            sourceId: queueItem.sourceId,
            sourceName: queueItem.sourceName,
            sourceKind: queueItem.sourceKind,
            queueItem,
            detail,
            sessionId,
            url: prepared.url,
            positionSeconds: offsetSeconds,
            startedAt: Date.now(),
            subtitleStreamIndex,
            quality,
            target,
            stopSession: prepared.stop,
            introSkipped,
        };
        this.paused = false;

        setMediaQueueStatus(this.db, queueItem.id, 'playing');
        this.playback.beginMediaState({
            sourceId: queueItem.sourceId,
            sourceName: queueItem.sourceName,
            sourceKind: queueItem.sourceKind,
            title: detail.title,
            subtitle: detail.showTitle,
            posterUrl: this.proxyThumb(queueItem.sourceId, detail.itemId),
            queueItemId: queueItem.id,
            durationMs: detail.durationMs,
        });
        this.playback.setMediaProgress(resumeMs, detail.durationMs);

        upsertMediaHistory(this.db, {
            sourceId: queueItem.sourceId,
            itemId: detail.itemId,
            type: queueItem.type,
            title: detail.title,
            showTitle: detail.showTitle,
            seasonNumber: detail.seasonNumber,
            episodeNumber: detail.episodeNumber,
            durationMs: detail.durationMs,
            thumbUrl: this.proxyThumb(queueItem.sourceId, detail.itemId),
            positionMs: resumeMs,
            completed: false,
            quality,
            subtitleMode: String(queueItem.subtitleMode),
        });
        this.emitQueue();
        this.emitHistory();

        const token = ++this.runToken;
        this.startHistoryTimer();
        void this.runCurrent(token);
    }

    private async preparePlayback(
        current: CurrentPlayback,
        offsetSeconds: number,
        sessionId: string,
        subtitleStreamIndex: number | null = current.subtitleStreamIndex
    ): Promise<PreparedPlayback> {
        const provider = this.requireProvider(current.sourceId);
        return provider.preparePlayback({
            item: current.detail,
            quality: current.quality,
            subtitleStreamIndex,
            offsetSeconds,
            sessionId,
        });
    }

    private addDetailToQueue(
        sourceId: number,
        detail: MediaItemDetail,
        quality: MediaQuality,
        subtitleMode: string
    ): QueueItemDto {
        const created = addMediaQueueItem(this.db, {
            sourceId,
            itemId: detail.itemId,
            type: detail.type === 'episode' ? 'episode' : 'movie',
            title: detail.title,
            showTitle: detail.showTitle,
            seasonNumber: detail.seasonNumber,
            episodeNumber: detail.episodeNumber,
            durationMs: detail.durationMs,
            thumbUrl: this.proxyThumb(sourceId, detail.itemId),
            quality,
            subtitleMode,
        });
        this.emitQueue();
        return created;
    }

    private currentPosition(current: CurrentPlayback): number {
        if (this.paused) {
            return current.positionSeconds;
        }
        return current.positionSeconds + Math.max(0, Date.now() - current.startedAt) / 1000;
    }

    private currentDuration(current: CurrentPlayback): number | null {
        return current.queueItem.durationMs ?? current.detail.durationMs;
    }

    /**
     * Saves playback progress for the active item.
     *
     * @param current - Active playback
     * @param positionMs - Position in milliseconds
     * @param completed - Whether the item reached the end
     * @param emit - Whether to notify WebUI subscribers
     */
    private recordHistory(
        current: CurrentPlayback,
        positionMs: number,
        completed: boolean,
        emit = true
    ): void {
        upsertMediaHistory(this.db, {
            sourceId: current.sourceId,
            itemId: current.detail.itemId,
            type: current.queueItem.type,
            title: current.detail.title,
            showTitle: current.detail.showTitle,
            seasonNumber: current.detail.seasonNumber,
            episodeNumber: current.detail.episodeNumber,
            durationMs: this.currentDuration(current),
            thumbUrl: this.proxyThumb(current.sourceId, current.detail.itemId),
            positionMs,
            completed,
            quality: current.quality,
            subtitleMode: String(current.queueItem.subtitleMode),
        });
        if (emit) {
            this.emitHistory();
        }
    }

    /**
     * Starts the periodic save that keeps resume progress within one interval
     * of the truth if the process stops unexpectedly.
     */
    private startHistoryTimer(): void {
        this.stopHistoryTimer();
        const timer = setInterval(() => {
            const current = this.current;
            if (!current || this.paused) {
                return;
            }
            this.recordHistory(current, this.currentPosition(current) * 1000, false, false);
        }, HISTORY_SAVE_INTERVAL_MS);
        timer.unref();
        this.historyTimer = timer;
    }

    private stopHistoryTimer(): void {
        if (this.historyTimer) {
            clearInterval(this.historyTimer);
            this.historyTimer = null;
        }
    }

    private emitHistory(): void {
        this.events.emit('history', this.getHistory());
    }

    private async ensurePlaceholderVideo(): Promise<string> {
        const output = join(this.dataDir, 'cache', 'media-placeholder.mp4');
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

    private toSourceDto(source: MediaSourceRecord): MediaSourceDto {
        const state = this.providers.get(source.id);
        const libraries = listMediaLibraries(this.db, source.id);
        return {
            id: source.id,
            kind: source.kind as MediaSourceKind,
            name: source.name,
            serverUrl: source.baseUrl,
            tokenSet: Boolean(source.tokenEncrypted),
            tokenLast4: source.tokenLast4 || null,
            userId: source.userId,
            userName: source.userName,
            channelName: source.channelName,
            idleMinutes: source.idleMinutes,
            emptyGraceSeconds: source.emptyGraceSeconds,
            defaultQuality: source.defaultQuality as MediaQuality,
            enabled: source.enabled,
            connected: state?.connected ?? false,
            error: state
                ? state.error
                : source.tokenEncrypted
                  ? 'The media source could not be initialized.'
                  : 'A server token is not configured.',
            libraryCount: libraries.length,
            enabledLibraryCount: libraries.filter(library => library.enabled).length,
        };
    }

    private toItemDto(sourceId: number, item: MediaItem): MediaItemDto {
        return {
            sourceId,
            itemId: item.itemId,
            libraryKey: item.libraryKey,
            type: item.type,
            title: item.title,
            showTitle: item.showTitle,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            year: item.year,
            durationMs: item.durationMs,
            thumbUrl: this.proxyThumb(sourceId, item.itemId),
            summary: item.summary,
        };
    }

    private toDetailDto(sourceId: number, detail: MediaItemDetail): MediaItemDetailDto {
        return {
            ...this.toItemDto(sourceId, detail),
            showItemId: detail.showItemId,
            seasonItemId: detail.seasonItemId,
            intro: detail.intro,
            streams: detail.streams
                .filter(stream => stream.type === 'audio' || stream.type === 'subtitle')
                .map(stream => this.toStreamDto(stream)),
        };
    }

    private toStreamDto(stream: MediaStream): MediaStreamDto {
        return {
            id: stream.id,
            index: stream.index,
            type: stream.type,
            language: stream.language,
            displayTitle: stream.displayTitle,
            codec: stream.codec,
            default: stream.default,
            forced: stream.forced,
            burnable: stream.burnable,
        };
    }

    private proxyThumb(sourceId: number, itemId: string): string {
        return `/api/media/thumb/${sourceId}/${encodeURIComponent(itemId)}?width=400&height=600`;
    }

    private requireSource(sourceId: number): MediaSourceRecord {
        const source = getMediaSource(this.db, sourceId);
        if (!source) {
            throw new Error('Media source not found');
        }
        return source;
    }

    private requireProvider(sourceId: number): MediaProvider {
        const source = getMediaSource(this.db, sourceId);
        if (!source) {
            throw new Error('Media source not found');
        }
        if (!source.enabled) {
            throw new Error('Media source is disabled');
        }
        const state = this.providers.get(sourceId);
        if (!state) {
            throw new Error('Media source is not configured');
        }
        if (state.error) {
            throw new Error(state.error);
        }
        return state.provider;
    }

    private requireEnabledLibrary(sourceId: number, key: string): void {
        const library = listMediaLibraries(this.db, sourceId).find(item => item.key === key);
        if (!library?.enabled) {
            throw new Error('Media library is not enabled');
        }
    }

    private emitQueue(): void {
        this.events.emit('queue', listMediaQueue(this.db));
    }

    private migrateLegacyPlex(): void {
        if (listMediaSources(this.db).length > 0) {
            return;
        }
        const config = this.settings.getPlexConfig();
        const token = this.settings.getPlexToken();
        if (!token) {
            return;
        }
        const secret = this.settings.encodeSecret(token);
        const source = createMediaSource(this.db, {
            kind: 'plex',
            name: 'Plex',
            baseUrl: config.serverUrl,
            tokenEncrypted: secret.encrypted,
            tokenLast4: secret.last4,
            clientIdentifier: this.settings.getPlexClientIdentifier(),
            channelName: config.channelName,
            idleMinutes: config.idleMinutes,
            emptyGraceSeconds: config.emptyGraceSeconds,
            defaultQuality: config.defaultQuality,
            enabled: true,
        });

        const legacyLibraries = listLegacyPlexLibraries(this.db);
        replaceMediaLibraries(
            this.db,
            source.id,
            legacyLibraries.map(library => ({
                key: library.libraryKey,
                title: library.title,
                type: library.type,
            }))
        );
        for (const library of legacyLibraries.filter(item => item.enabled)) {
            setMediaLibraryEnabled(this.db, source.id, library.libraryKey, true);
        }

        for (const entry of listLegacyPlexQueue(this.db)) {
            const created = addMediaQueueItem(this.db, {
                sourceId: source.id,
                itemId: entry.ratingKey,
                type: entry.type,
                title: entry.title,
                showTitle: entry.showTitle,
                seasonNumber: entry.seasonNumber,
                episodeNumber: entry.episodeNumber,
                durationMs: entry.durationMs,
                thumbUrl: this.proxyThumb(source.id, entry.ratingKey),
                quality: entry.quality,
                subtitleMode: entry.subtitleMode,
            });
            if (entry.status !== 'queued') {
                setMediaQueueStatus(this.db, created.id, entry.status, entry.error);
            }
        }

        logger.info('Migrated the legacy Plex configuration into a media source');
        this.events.emit('media', this.getSources());
    }
}

function labelFor(kind: MediaSourceKind): string {
    return kind === 'jellyfin' ? 'Jellyfin' : 'Plex';
}

function resolveSubtitleStreamIndex(streams: MediaStream[], mode: string | number): number | null {
    if (mode === 'off') {
        return null;
    }

    const candidates = streams.filter(stream => stream.burnable);
    if (candidates.length === 0) {
        return null;
    }

    if (mode === 'auto' || mode === '' || mode === undefined) {
        const preferred =
            candidates.find(stream => stream.default) ??
            candidates.find(stream => stream.forced) ??
            candidates[0];
        return preferred?.index ?? null;
    }

    const id = Number(mode);
    if (!Number.isFinite(id)) {
        return candidates[0]?.index ?? null;
    }
    const byId = candidates.find(stream => stream.id === id);
    if (byId) return byId.index;
    const byIndex = candidates.find(stream => stream.index === id);
    if (byIndex) return byIndex.index;
    return candidates[0]?.index ?? null;
}
