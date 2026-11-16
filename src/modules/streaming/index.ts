import { Client } from '@lng2004/discord.js-selfbot-v13';
import { Encoders, prepareStream, playStream, Streamer, Utils } from '@dank074/discord-video-stream';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import type { ChannelEntry } from '../../interfaces/iptv';
import { PersistentStream } from './persistent-session';

const logger = getLogger();

export interface StreamSettings {
    minimizeLatency: boolean;
    disableTranscode: boolean;
    bitrateVideo: number;
    bitrateVideoMax: number;
    defaultStreamTimeout: number;
}

export interface StreamResult {
    aborted: boolean;
    error: string | null;
}

let streamer = new Streamer(new Client());
let abortController = new AbortController();
let currentChannelEntry: ChannelEntry | null = null;
let persistentStream: PersistentStream | null = null;
let streamProcess: (Promise<unknown> & { kill: (signal?: NodeJS.Signals | number) => boolean }) | null = null;
let streamPaused = false;
let streamSpectatorMonitor: ReturnType<typeof setInterval> | null = null;
let streamAloneTime = 0;
let settings: StreamSettings = {
    minimizeLatency: true,
    disableTranscode: false,
    bitrateVideo: 5000,
    bitrateVideoMax: 7500,
    defaultStreamTimeout: 10,
};

const JOIN_VOICE_TIMEOUT_MS = 20_000;

/**
 * Applies the current streaming settings to new playback.
 *
 * @param next - Stream settings from SQLite
 */
export function setStreamSettings(next: StreamSettings): void {
    settings = { ...next };
}

/**
 * Returns the active voice connection, if any.
 */
export function getVoiceConnection() {
    return streamer.voiceConnection;
}

/**
 * Returns the streamer client status for the API and Discord service.
 */
export function getStreamerStatus(): { online: boolean; tag: string | null; guildId: string | null; channelId: string | null } {
    return {
        online: streamer.client.isReady(),
        tag: streamer.client.user?.tag ?? null,
        guildId: streamer.voiceConnection?.guildId ?? null,
        channelId: streamer.voiceConnection?.channelId ?? null,
    };
}

/**
 * Returns the streamer's current voice channel and guild names.
 */
export function getVoiceChannelInfo(): {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
} | null {
    const guildId = streamer.voiceConnection?.guildId;
    const channelId = streamer.voiceConnection?.channelId;
    if (!guildId || !channelId) {
        return null;
    }
    const guild = streamer.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    return {
        guildId,
        guildName: guild?.name ?? 'Unknown guild',
        channelId,
        channelName: channel?.name ?? 'Unknown channel',
    };
}

/**
 * Counts non-bot members in the streamer's voice channel.
 */
export function getViewerCount(): number {
    const channelId = streamer.voiceConnection?.channelId;
    if (!channelId) {
        return 0;
    }
    const channel = streamer.client.channels.cache.get(channelId);
    if (!channel || !channel.isVoice()) {
        return 0;
    }
    return Math.max(0, channel.members.filter(member => !member.user.bot).size - 1);
}

/**
 * Returns the currently playing channel entry.
 */
export function getCurrentChannelEntry(): ChannelEntry | null {
    return currentChannelEntry;
}

/**
 * Freezes the active Discord stream without ending it. The Discord stream
 * stays live and the last frame stays on screen; the Plex session and voice
 * connection remain open.
 *
 * @returns True when the stream was paused
 */
export function pauseStreaming(): boolean {
    if (persistentStream?.active) {
        const paused = persistentStream.pause();
        if (paused) {
            logger.info('Froze video stream and kept the voice connection open');
        }
        return paused;
    }
    if (!currentChannelEntry || !streamProcess || streamPaused) {
        return false;
    }
    if (!streamProcess.kill('SIGSTOP')) {
        return false;
    }
    streamPaused = true;
    logger.info('Froze video stream and kept the voice connection open');
    return true;
}

/**
 * Resumes a stream frozen by {@link pauseStreaming}.
 *
 * @returns True when the stream was resumed
 */
export function resumeStreaming(): boolean {
    if (persistentStream?.active) {
        const resumed = persistentStream.resume();
        if (resumed) {
            logger.info('Resumed video stream');
        }
        return resumed;
    }
    if (!currentChannelEntry || !streamProcess || !streamPaused) {
        return false;
    }
    if (!streamProcess.kill('SIGCONT')) {
        return false;
    }
    streamPaused = false;
    logger.info('Resumed video stream');
    return true;
}

/**
 * Logs in the streamer client.
 *
 * @param token - Discord user token
 */
export async function initializeStreamer(token?: string): Promise<boolean> {
    if (streamer.client.isReady()) {
        return true;
    }
    if (!token) {
        logger.warn('No streamer token configured');
        return false;
    }
    try {
        await (streamer.client as Client).login(token);
        logger.info('Streamer client logged in successfully');
        return true;
    } catch (error) {
        logger.error(`Error logging in streamer client: ${error}`);
        return false;
    }
}

/**
 * Replaces the streamer client with a new token without calling logout.
 *
 * @param token - Discord user token
 */
export async function reconnectStreamer(token: string): Promise<boolean> {
    try {
        if (streamer.voiceConnection) {
            streamer.leaveVoice();
        }
        streamer.client.destroy();
    } catch (error) {
        logger.warn(`Error destroying old streamer client: ${error}`);
    }

    streamer = new Streamer(new Client());
    return initializeStreamer(token);
}

/**
 * Disconnects the streamer without invalidating the user token.
 */
export async function shutdownStreamer(): Promise<void> {
    if (!streamer.client.isReady()) {
        logger.debug('Streamer client is not logged in');
        return;
    }
    try {
        if (streamer.voiceConnection) {
            streamer.leaveVoice();
        }
        streamer.client.destroy();
        logger.info('Streamer client disconnected');
    } catch (error) {
        logger.error(`Error disconnecting streamer client: ${error}`);
    }
}

/**
 * Joins a voice channel with a 20-second handshake timeout.
 *
 * @param guildId - Discord guild id
 * @param channelId - Voice channel id
 * @returns True when connected
 */
export async function joinVoiceChannel(guildId: string, channelId: string): Promise<boolean> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in.');
        return false;
    }

    const guild = streamer.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);

    if (!guild || !channel || !channel.isVoice()) {
        logger.error('Invalid guild or channel ID.');
        return false;
    }

    const connection = streamer.voiceConnection;
    if (connection && connection.channelId === channelId) {
        logger.debug(`Already connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        return true;
    }

    if (connection) {
        logger.debug(`Switching voice channel, leaving ${connection.channelId} first`);
        streamer.leaveVoice();
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
        const conn = await withTimeout(
            streamer.joinVoice(guildId, channelId),
            JOIN_VOICE_TIMEOUT_MS,
            `Timed out joining voice channel: ${channel.name} in guild: ${guild.name}`
        );
        logger.info(`Connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        if (!conn.ready) {
            logger.debug('WebRTC connection is still settling after the voice join');
        }
        return true;
    } catch (error) {
        logger.error(`Error joining voice channel: ${error}`);
        streamer.leaveVoice();
        return false;
    }
}

/**
 * Stops the current stream and leaves the voice channel.
 */
export async function leaveVoiceChannel(): Promise<void> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return;
    }
    try {
        if (currentChannelEntry) {
            await stopStreaming();
        }
        const guildId = streamer.voiceConnection?.guildId;
        const channelId = streamer.voiceConnection?.channelId;
        const guild = guildId ? streamer.client.guilds.cache.get(guildId) : undefined;
        const channel = guild && channelId ? guild.channels.cache.get(channelId) : undefined;
        streamer.leaveVoice();
        logger.info(
            `Stopped video stream and disconnected from the voice channel: ${channel?.name || 'unknown'} in guild: ${guild?.name || 'unknown'}`
        );
    } catch (error) {
        logger.error(`Error leaving voice channel: ${error}`);
    }
}

/**
 * Starts streaming a source into the current voice channel.
 *
 * The returned result distinguishes a natural end from an aborted playback so
 * the queue can advance only when the media actually finished.
 *
 * @param channelEntry - Channel metadata and source URL
 * @returns Playback result
 */
export async function startStreaming(
    channelEntry: ChannelEntry,
    options: { inputOptions?: string[]; headers?: Record<string, string>; monitor?: boolean } = {}
): Promise<StreamResult> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return { aborted: false, error: 'Streamer client is not logged in' };
    }

    let signal = abortController.signal;
    let errorMessage: string | null = null;

    try {
        logger.info('Stopping any possible existing stream');
        await stopStreaming();
        signal = abortController.signal;

        logger.info(`Attempting to stream: ${channelEntry.tvg_name ?? 'unknown'}`);

        const encoder = Encoders.software({
            x264: { preset: 'veryfast' },
            x265: { preset: 'veryfast' },
        });

        const { command, output, promise } = prepareStream(
            channelEntry.url,
            {
                noTranscoding: settings.disableTranscode,
                minimizeLatency: settings.minimizeLatency,
                bitrateVideo: settings.bitrateVideo,
                bitrateVideoMax: settings.bitrateVideoMax,
                videoCodec: Utils.normalizeVideoCodec('H264'),
                encoder,
                customInputOptions: options.inputOptions ?? [],
                customHeaders: options.headers ?? {},
            },
            signal
        );

        currentChannelEntry = channelEntry;
        streamProcess = promise as Promise<unknown> & {
            kill: (signal?: NodeJS.Signals | number) => boolean;
        };
        streamPaused = false;

        promise.catch((err: unknown) => {
            if (!signal.aborted) {
                errorMessage = String(err);
                logger.error(`FFmpeg process error: ${redactSecrets(String(err))}`);
            }
        });

        command.on('error', (err: unknown) => {
            if (!signal.aborted) {
                errorMessage = String(err);
                logger.error(`FFmpeg ${redactSecrets(String(err))}`);
            }
        });

        command.on('end', () => {
            logger.debug('FFmpeg process ended');
        });

        logger.info(`Streaming channel: ${channelEntry.tvg_name}.`);
        const cleanupMonitoring = options.monitor === false ? () => undefined : startSpectatorMonitoring();

        try {
            await playStream(output, streamer, { type: 'go-live' }, signal);
        } finally {
            cleanupMonitoring();
        }

        return { aborted: signal.aborted, error: errorMessage };
    } catch (error) {
        if (!signal.aborted) {
            errorMessage = String(error);
            logger.error(`Error starting stream: ${redactSecrets(String(error))}`);
            await stopStreaming();
        }
        return { aborted: signal.aborted, error: errorMessage };
    }
}

/**
 * Starts a Plex stream on one persistent Discord stream connection. The
 * connection survives source swaps so seeking does not delete and recreate the
 * stream.
 *
 * @param channelEntry - Channel metadata and source URL
 * @param options - Input options and headers
 * @returns Playback result
 */
export async function startPlexStreaming(
    channelEntry: ChannelEntry,
    options: { inputOptions?: string[]; headers?: Record<string, string> } = {}
): Promise<StreamResult> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return { aborted: false, error: 'Streamer client is not logged in' };
    }

    logger.info('Stopping any possible existing stream');
    await stopStreaming();

    const encoder = Encoders.software({
        x264: { preset: 'veryfast' },
        x265: { preset: 'veryfast' },
    });
    const session = new PersistentStream(streamer);
    persistentStream = session;
    currentChannelEntry = channelEntry;
    const cleanupMonitoring = startSpectatorMonitoring();
    logger.info(`Attempting to stream: ${channelEntry.tvg_name ?? 'unknown'}`);

    try {
        return await session.start(channelEntry.url, {
            noTranscoding: settings.disableTranscode,
            minimizeLatency: settings.minimizeLatency,
            bitrateVideo: settings.bitrateVideo,
            bitrateVideoMax: settings.bitrateVideoMax,
            encoder,
            inputOptions: options.inputOptions ?? [],
            headers: options.headers ?? {},
        });
    } catch (error) {
        const message = String(error);
        logger.error(`Error starting Plex stream: ${redactSecrets(message)}`);
        return { aborted: false, error: message };
    } finally {
        if (persistentStream === session) {
            cleanupMonitoring();
            persistentStream = null;
        }
        if (currentChannelEntry === channelEntry) {
            currentChannelEntry = null;
        }
    }
}

/**
 * Replaces the Plex source while keeping the current Discord stream alive.
 *
 * @param url - New Plex transcode URL
 * @returns True when the source was replaced
 */
export async function replacePlexStreamingSource(url: string): Promise<boolean> {
    if (!persistentStream?.active) {
        return false;
    }
    await persistentStream.replace(url);
    return true;
}

/**
 * Stops the current stream without disconnecting from voice.
 */
export async function stopStreaming(): Promise<void> {
    try {
        if (persistentStream) {
            const session = persistentStream;
            persistentStream = null;
            await session.stop();
        }
        if (streamProcess && streamPaused) {
            streamProcess.kill('SIGCONT');
        }
        abortController.abort();
        await new Promise(resolve => setTimeout(resolve, 1000));
        abortController = new AbortController();

        if (streamSpectatorMonitor) {
            logger.debug('Clearing spectator monitor');
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;
        streamProcess = null;
        streamPaused = false;

        if (!currentChannelEntry) {
            logger.debug('No channel currently playing');
            return;
        }

        logger.info(`Stopped video stream from ${currentChannelEntry.tvg_name || 'unknown channel'}`);
        currentChannelEntry = null;
    } catch (error) {
        logger.error(`Error stopping stream: ${error}`);
    }
}

function startSpectatorMonitoring(): () => void {
    streamAloneTime = 0;

    if (streamSpectatorMonitor) {
        clearInterval(streamSpectatorMonitor);
        streamSpectatorMonitor = null;
    }

    logger.debug('Starting spectator monitoring');

    streamSpectatorMonitor = setInterval(() => {
        try {
            const channelId = streamer.voiceConnection?.channelId;
            if (!channelId) {
                logger.debug('No active voice connection found during monitoring');
                return;
            }

            const channel = streamer.client.channels.cache.get(channelId);
            if (!channel || !channel.isVoice()) {
                logger.debug('Could not retrieve valid voice channel during monitoring');
                return;
            }

            const members = channel.members.filter(member => !member.user.bot).size - 1;
            if (members === 0) {
                streamAloneTime += 10;
                logger.debug(`No spectators for ${streamAloneTime} seconds`);

                if (streamAloneTime >= settings.defaultStreamTimeout * 60) {
                    logger.info(
                        `No spectators for ${settings.defaultStreamTimeout} ${
                            settings.defaultStreamTimeout > 1 ? 'minutes' : 'minute'
                        }. Stopping stream.`
                    );
                    stopStreaming()
                        .then(() => leaveVoiceChannel())
                        .catch(err => logger.error(`Error during automated stream cleanup: ${err}`));
                }
            } else {
                streamAloneTime = 0;
            }
        } catch (error) {
            logger.error(`Error in spectator monitoring: ${error}`);
        }
    }, 10000);

    return () => {
        if (streamSpectatorMonitor) {
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
