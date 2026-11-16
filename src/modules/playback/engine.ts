import { EventEmitter } from 'node:events';
import type { Db } from '../database/client';
import type { SettingsService } from '../settings';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import type { PlaybackStateDto } from '../../shared/types';
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
 * Optional Plex provider. The Plex service implements this once configured.
 */
export interface PlexPlaybackProvider {
    playQueue(target: PlaybackTarget): Promise<PlaybackResult>;
    startPlaceholder(target: PlaybackTarget): Promise<PlaybackResult>;
    pause(): Promise<PlaybackResult>;
    resume(): Promise<PlaybackResult>;
    seek(seconds: number): Promise<PlaybackResult>;
    skip(): Promise<PlaybackResult>;
    stop(): Promise<void>;
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
    private runId = 0;
    private plex: PlexPlaybackProvider | null = null;

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
     * Registers the Plex provider.
     *
     * @param provider - Plex playback implementation
     */
    setPlexProvider(provider: PlexPlaybackProvider): void {
        this.plex = provider;
    }

    /**
     * Marks the start of a Plex queue item. The Plex service owns the queue and
     * calls this so the WebUI and Discord see the current title and poster.
     *
     * @param input - Current item metadata
     */
    beginPlexState(input: {
        title: string;
        subtitle: string | null;
        posterUrl: string | null;
        queueItemId: number;
        durationMs: number | null;
    }): void {
        this.mode = 'plex';
        this.title = input.title;
        this.subtitle = input.subtitle;
        this.posterUrl = input.posterUrl;
        this.startedAt = Date.now();
        this.positionMs = 0;
        this.durationMs = input.durationMs;
        this.positionUpdatedAt = this.startedAt;
        this.paused = false;
        this.queueItemId = input.queueItemId;
        this.emit();
    }

    /**
     * Updates the Plex playback position and duration.
     *
     * @param positionMs - Position at the time of the update
     * @param durationMs - Item duration, or null when unknown
     */
    setPlexProgress(positionMs: number, durationMs: number | null): void {
        this.positionMs = Math.max(0, positionMs);
        this.durationMs = durationMs;
        this.positionUpdatedAt = Date.now();
        this.emit();
    }

    /**
     * Updates the paused flag for Plex playback.
     *
     * @param paused - New paused state
     */
    setPlexPaused(paused: boolean): void {
        this.paused = paused;
        this.emit();
    }

    /**
     * Clears Plex state after the queue ends or is stopped.
     */
    endPlexState(): void {
        if (this.mode === 'plex') {
            this.reset();
            this.emit();
        }
    }

    /**
     * Marks the Plex placeholder as active.
     *
     * @param title - Placeholder title shown in the UI
     */
    beginPlaceholderState(title: string): void {
        this.mode = 'placeholder';
        this.title = title;
        this.subtitle = 'On demand';
        this.posterUrl = null;
        this.startedAt = Date.now();
        this.positionMs = null;
        this.durationMs = null;
        this.positionUpdatedAt = null;
        this.paused = false;
        this.queueItemId = null;
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
        return this.mode === 'iptv' || this.mode === 'plex';
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
            if (this.plex) {
                await this.plex.stop();
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
     * Starts the Plex on-demand queue.
     *
     * @param target - Guild and voice channel
     */
    async playPlex(target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.plex) {
            return { ok: false, message: 'Plex is not configured.' };
        }
        if (this.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        return this.plex.playQueue(target);
    }

    /**
     * Starts the Plex placeholder stream in Discord.
     *
     * @param target - Guild and voice channel
     */
    async startPlaceholder(target: PlaybackTarget): Promise<PlaybackResult> {
        if (!this.plex) {
            return { ok: false, message: 'Plex is not configured.' };
        }
        if (this.isBusy()) {
            return { ok: false, message: 'Another stream is already playing. Stop it first.' };
        }
        return this.plex.startPlaceholder(target);
    }

    /**
     * Stops playback and leaves voice.
     */
    async stop(): Promise<PlaybackResult> {
        this.runId++;
        if (this.plex && (this.mode === 'plex' || this.mode === 'placeholder')) {
            await this.plex.stop();
        }
        await leaveVoiceChannel();
        this.reset();
        this.emit();
        return { ok: true, message: 'Playback stopped.' };
    }

    /**
     * Skips the current Plex item. IPTV stops instead.
     */
    async skip(): Promise<PlaybackResult> {
        if (this.mode === 'plex' && this.plex) {
            return this.plex.skip();
        }
        if (this.mode === 'iptv' || this.mode === 'placeholder') {
            return this.stop();
        }
        return { ok: false, message: 'Nothing is playing.' };
    }

    /**
     * Pauses Plex playback. IPTV cannot be paused.
     */
    async pause(): Promise<PlaybackResult> {
        if (this.mode !== 'plex' || !this.plex) {
            return { ok: false, message: 'Only Plex playback can be paused.' };
        }
        const result = await this.plex.pause();
        if (result.ok) {
            this.paused = true;
            this.emit();
        }
        return result;
    }

    /**
     * Resumes Plex playback.
     */
    async resume(): Promise<PlaybackResult> {
        if (this.mode !== 'plex' || !this.plex) {
            return { ok: false, message: 'Only Plex playback can be resumed.' };
        }
        const result = await this.plex.resume();
        if (result.ok) {
            this.paused = false;
            this.emit();
        }
        return result;
    }

    /**
     * Seeks Plex playback to an absolute offset.
     *
     * @param seconds - Target offset in seconds
     */
    async seek(seconds: number): Promise<PlaybackResult> {
        if (this.mode !== 'plex' || !this.plex) {
            return { ok: false, message: 'Only Plex playback can be seeked.' };
        }
        return this.plex.seek(seconds);
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
    }

    private emit(): void {
        this.events.emit('playback', this.getState());
    }
}
