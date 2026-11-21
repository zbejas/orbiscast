import { EventEmitter } from 'node:events';
import type { Db } from '../database/client';
import type { SettingsService } from '../settings';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import type { ChannelDto, MediaSourceKind, PlaybackStateDto } from '../../shared/types';
import {
    getViewerCount,
    getVoiceChannelInfo,
    joinVoiceChannel,
    leaveVoiceChannel,
    setStreamSettings,
    startStreaming,
    stopStreaming,
} from '../streaming';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();

export interface PlaybackResult {
    ok: boolean;
    message: string;
}

export interface IptvPlaybackInput {
    id: number;
    name: string;
    tvgId: string | null;
    logo: string | null;
    group: string | null;
    url: string;
}

export interface PlaybackTarget {
    guildId: string;
    voiceChannelId: string;
}

/**
 * On-demand provider contract. The media service implements this once at least
 * one Plex or Jellyfin source is configured.
 */
export interface MediaPlaybackProvider {
    playQueue(target: PlaybackTarget): Promise<PlaybackResult>;
    startPlaceholder(sourceId: number, target: PlaybackTarget): Promise<PlaybackResult>;
    pause(): Promise<PlaybackResult>;
    resume(): Promise<PlaybackResult>;
    seek(seconds: number): Promise<PlaybackResult>;
    skip(): Promise<PlaybackResult>;
    stop(): Promise<void>;
    getChannels(): ChannelDto[];
}

type PlaybackMode = PlaybackStateDto['mode'];

/**
 * Owns the single global playback state. One self-bot means one stream, so
 * every entry point goes through this class.
 */
export class PlaybackEngine {
    private mode: PlaybackMode = 'idle';
    private title: string | null = null;
    private subtitle: string | null = null;
    private posterUrl: string | null = null;
    private startedAt: number | null = null;
    private positionMs: number | null = null;
    private durationMs: number | null = null;
    private positionUpdatedAt: number | null = null;
    private paused = false;
    private queueItemId: number | null = null;
    private sourceId: number | null = null;
    private sourceName: string | null = null;
    private sourceKind: MediaSourceKind | null = null;
    private runId = 0;
    private media: MediaPlaybackProvider | null = null;

    constructor(
        private readonly db: Db,
        private readonly settings: SettingsService,
        private readonly events: EventEmitter
    ) {
        setStreamSettings(settings.getStream());
    }

    /**
     * Reloads stream settings after a settings change.
     */
    reloadSettings(): void {
        setStreamSettings(this.settings.getStream());
    }

    /**
     * Registers the on-demand media provider.
     *
     * @param provider - Plex and Jellyfin playback implementation
     */
    setMediaProvider(provider: MediaPlaybackProvider): void {
        this.media = provider;
    }

    /**
     * Returns the virtual Discord channels for every configured media source.
     */
    getMediaChannels(): ChannelDto[] {
        return this.media?.getChannels() ?? [];
    }

    /**
     * Marks the start of a media queue item. The media service owns the queue
     * and calls this so the WebUI and Discord see the current title and poster.
     *
     * @param input - Current item and source metadata
     */
    beginMediaState(input: {
        sourceId: number;
        sourceName: string;
        sourceKind: MediaSourceKind;
        title: string;
        subtitle: string | null;
        posterUrl: string | null;
        queueItemId: number;
        durationMs: number | null;
    }): void {
        this.mode = 'media';
        this.title = input.title;
        this.subtitle = input.subtitle;
        this.posterUrl = input.posterUrl;
        this.startedAt = Date.now();
        this.positionMs = 0;
        this.durationMs = input.durationMs;
        this.positionUpdatedAt = this.startedAt;
        this.paused = false;
        this.queueItemId = input.queueItemId;
        this.sourceId = input.sourceId;
        this.sourceName = input.sourceName;
        this.sourceKind = input.sourceKind;
        this.emit();
    }

    /**
     * Updates the media playback position and duration.
     *
     * @param positionMs - Position at the time of the update
     * @param durationMs - Item duration, or null when unknown
     */
    setMediaProgress(positionMs: number, durationMs: number | null): void {
        this.positionMs = Math.max(0, positionMs);
        this.durationMs = durationMs;
        this.positionUpdatedAt = Date.now();
        this.emit();
    }

    /**
     * Updates the paused flag for media playback.
     *
     * @param paused - New paused state
     */
    setMediaPaused(paused: boolean): void {
        this.paused = paused;
        this.emit();
    }

    /**
     * Clears media state after the queue ends or is stopped.
     */
    endMediaState(): void {
        if (this.mode === 'media') {
            this.reset();
            this.emit();
        }
    }

    /**
     * Marks a media placeholder as active.
     *
     * @param input - Source and channel metadata
     */
    beginPlaceholderState(input: {
        sourceId: number;
        sourceName: string;
        sourceKind: MediaSourceKind;
        title: string;
    }): void {
        this.mode = 'placeholder';
        this.title = input.title;
        this.subtitle = 'On demand';
        this.posterUrl = null;
        this.startedAt = Date.now();
        this.positionMs = null;
        this.durationMs = null;
        this.positionUpdatedAt = null;
        this.paused = false;
        this.queueItemId = null;
        this.sourceId = input.sourceId;
        this.sourceName = input.sourceName;
        this.sourceKind = input.sourceKind;
        this.emit();
    }

    /**
     * Clears the placeholder state.
     */
    endPlaceholderState(): void {
        if (this.mode === 'placeholder') {
            this.reset();
            this.emit();
        }
    }

    /**
     * Returns true when a real stream is active.
     */
    isBusy(): boolean {
        return this.mode === 'iptv' || this.mode === 'media';
    }

    /**
     * Returns the current playback state for the API and SSE.
     */
    getState(): PlaybackStateDto {
        const voice = getVoiceChannelInfo();
        return {
            mode: this.mode,
            title: this.title,
            subtitle: this.subtitle,
            posterUrl: this.posterUrl,
            guildId: voice?.guildId ?? null,
            guildName: voice?.guildName ?? null,
            voiceChannelId: voice?.channelId ?? null,
            voiceChannelName: voice?.channelName ?? null,
            startedAt: this.startedAt,
            positionMs: this.positionMs,
            durationMs: this.durationMs,
            positionUpdatedAt: this.positionUpdatedAt,
            viewers: getViewerCount(),
            paused: this.paused,
            queueItemId: this.queueItemId,
            sourceId: this.sourceId,
            sourceName: this.sourceName,
            sourceKind: this.sourceKind,
        };
    }

    /**
     * Starts an IPTV channel. Rejects while a real stream is active.
     *
     * @param input - Channel metadata
     * @param target - Guild and voice channel
     */
    async playIptv(input: IptvPlaybackInput, target: PlaybackTarget): Promise<PlaybackResult> {
        if (this.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }

        const run = ++this.runId;
        if (this.mode === 'placeholder') {
            if (this.media) {
                await this.media.stop();
            } else {
                await stopStreaming();
            }
        }

        const joined = await joinVoiceChannel(target.guildId, target.voiceChannelId);
        if (!joined) {
            return { ok: false, message: 'Failed to join the voice channel.' };
        }

        this.mode = 'iptv';
        this.title = input.name;
        this.subtitle = input.group;
        this.posterUrl = input.logo;
        this.startedAt = Date.now();
        this.paused = false;
        this.queueItemId = null;
        this.sourceId = null;
        this.sourceName = null;
        this.sourceKind = null;
        this.emit();

        const entry: ChannelEntry = {
            xui_id: 0,
            tvg_id: input.tvgId ?? undefined,
            tvg_name: input.name,
            tvg_logo: input.logo ?? undefined,
            group_title: input.group ?? undefined,
            url: input.url,
        };

        void this.runIptv(entry, run);
        return { ok: true, message: `Streaming ${input.name}` };
    }

    /**
     * Starts the on-demand queue.
     *
     * @param target - Guild and voice channel
     */
    async playMedia(target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.media) {
            return { ok: false, message: 'No media source is configured.' };
        }
        if (this.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        return this.media.playQueue(target);
    }

    /**
     * Starts a media source placeholder stream in Discord.
     *
     * @param sourceId - Media source id
     * @param target - Guild and voice channel
     */
    async startPlaceholder(sourceId: number, target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.media) {
            return { ok: false, message: 'No media source is configured.' };
        }
        if (this.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        return this.media.startPlaceholder(sourceId, target);
    }

    /**
     * Stops playback and leaves voice.
     */
    async stop(): Promise<PlaybackResult> {
        this.runId++;
        if (this.media && (this.mode === 'media' || this.mode === 'placeholder')) {
            await this.media.stop();
        }
        await leaveVoiceChannel();
        this.reset();
        this.emit();
        return { ok: true, message: 'Playback stopped.' };
    }

    /**
     * Skips the current media item. IPTV stops instead.
     */
    async skip(): Promise<PlaybackResult> {
        if (this.mode === 'media' && this.media) {
            return this.media.skip();
        }
        if (this.mode === 'iptv' || this.mode === 'placeholder') {
            return this.stop();
        }
        return { ok: false, message: 'Nothing is playing.' };
    }

    /**
     * Pauses media playback. IPTV cannot be paused.
     */
    async pause(): Promise<PlaybackResult> {
        if (this.mode !== 'media' || !this.media) {
            return { ok: false, message: 'Only on-demand playback can be paused.' };
        }
        const result = await this.media.pause();
        if (result.ok) {
            this.paused = true;
            this.emit();
        }
        return result;
    }

    /**
     * Resumes media playback.
     */
    async resume(): Promise<PlaybackResult> {
        if (this.mode !== 'media' || !this.media) {
            return { ok: false, message: 'Only on-demand playback can be resumed.' };
        }
        const result = await this.media.resume();
        if (result.ok) {
            this.paused = false;
            this.emit();
        }
        return result;
    }

    /**
     * Seeks media playback to an absolute offset.
     *
     * @param seconds - Target offset in seconds
     */
    async seek(seconds: number): Promise<PlaybackResult> {
        if (this.mode !== 'media' || !this.media) {
            return { ok: false, message: 'Only on-demand playback can be seeked.' };
        }
        return this.media.seek(seconds);
    }

    private async runIptv(entry: ChannelEntry, run: number): Promise<void> {
        const result = await startStreaming(entry);
        if (run !== this.runId) {
            return;
        }
        if (result.error && !result.aborted) {
            logger.error(`IPTV playback failed: ${redactSecrets(result.error)}`);
        }
        if (this.mode === 'iptv') {
            await leaveVoiceChannel();
            this.reset();
            this.emit();
        }
    }

    private reset(): void {
        this.mode = 'idle';
        this.title = null;
        this.subtitle = null;
        this.posterUrl = null;
        this.startedAt = null;
        this.positionMs = null;
        this.durationMs = null;
        this.positionUpdatedAt = null;
        this.paused = false;
        this.queueItemId = null;
        this.sourceId = null;
        this.sourceName = null;
        this.sourceKind = null;
    }

    private emit(): void {
        this.events.emit('playback', this.getState());
    }
}
