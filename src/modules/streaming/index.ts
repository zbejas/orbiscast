import { Client } from '@lng2004/discord.js-selfbot-v13';
import {
    Encoders,
    GatewayOpCodes,
    prepareStream,
    playStream,
    Streamer,
    Utils,
} from '@dank074/discord-video-stream';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import type { ChannelEntry } from '../../interfaces/iptv';
import { appendFfmpegLine, buildScaleFilter, KEYFRAME_OPTIONS, LOW_LATENCY_INPUT_OPTIONS } from './ffmpeg';
import { applyLibraryFixes, setVideoPacerFloor, VIDEO_PACER_MAX_MULTIPLIER } from './library-fixes';
import { PersistentStream } from './persistent-session';

const logger = getLogger();
const libraryFixesReady = applyLibraryFixes();

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
let joinListenerClient: Client | null = null;
const streamerJoinHandlers = new Set<(guildId: string) => void>();
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
setVideoPacerFloor(settings.bitrateVideoMax * 1000 * VIDEO_PACER_MAX_MULTIPLIER);

const JOIN_VOICE_TIMEOUT_MS = 20_000;
const ACCEPT_INVITE_TIMEOUT_MS = 20_000;

/**
 * Attaches the guild-join listener to the current streamer client once.
 *
 * Reconnects replace the client, so this runs again on every login. The bot
 * client does not request the privileged GuildMembers intent, which is why the
 * user client is the reliable source for this event.
 */
function attachJoinListener(): void {
    const client = streamer.client as Client;
    if (joinListenerClient === client) {
        return;
    }
    joinListenerClient = client;

    client.on('guildMemberAdd', member => {
        const userId = client.user?.id;
        if (!userId || member.id !== userId) {
            return;
        }
        const guildId = member.guild?.id;
        if (!guildId) {
            return;
        }
        for (const handler of streamerJoinHandlers) {
            handler(guildId);
        }
    });
}

/**
 * Applies the current streaming settings to new playback.
 *
 * @param next - Stream settings from SQLite
 */
export function setStreamSettings(next: StreamSettings): void {
    settings = { ...next };
    setVideoPacerFloor(next.bitrateVideoMax * 1000 * VIDEO_PACER_MAX_MULTIPLIER);
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
 * Returns the logged-in streaming account's public identity.
 *
 * @returns User ID and tag, or null when the streamer client is not ready
 */
export function getStreamerInfo(): { id: string; tag: string } | null {
    const client = streamer.client;
    const user = client.user;
    if (!client.isReady() || !user) {
        return null;
    }

    return { id: user.id, tag: user.tag };
}

/**
 * Lists the guilds the streaming account is a member of.
 *
 * @returns Guild IDs from the streamer client cache
 */
export function getStreamerGuildIds(): string[] {
    if (!streamer.client.isReady()) {
        return [];
    }
    return [...streamer.client.guilds.cache.keys()];
}

/**
 * Checks whether the streaming account is already a member of a guild.
 *
 * @param guildId - Discord guild ID
 * @returns True when the guild is cached for the streaming account
 */
export function isStreamerInGuild(guildId: string): boolean {
    return streamer.client.isReady() && streamer.client.guilds.cache.has(guildId);
}

/**
 * Fetches the streaming account's member record from a guild.
 *
 * This uses the user client, which does not need the bot's privileged
 * GuildMembers intent.
 *
 * @param guildId - Discord guild ID
 * @returns True when the streaming account is a member of the guild
 */
export async function fetchStreamerGuildMember(guildId: string): Promise<boolean> {
    const client = streamer.client;
    const user = client.user;
    if (!client.isReady() || !user) {
        return false;
    }

    let guild = client.guilds.cache.get(guildId);
    if (!guild) {
        try {
            guild = await client.guilds.fetch(guildId);
        } catch {
            return false;
        }
    }

    try {
        await guild.members.fetch(user.id);
        return true;
    } catch {
        return false;
    }
}

/**
 * Accepts a guild invite with the streaming account's user token.
 *
 * @param invite - Invite code or URL
 * @returns Success state and a safe error message
 */
export async function acceptGuildInvite(invite: string): Promise<{ success: boolean; error?: string }> {
    const client = streamer.client;
    if (!client.isReady()) {
        return { success: false, error: 'The streaming account is not logged in.' };
    }

    try {
        await withTimeout(
            client.acceptInvite(invite, { bypassOnboarding: true, bypassVerify: true }),
            ACCEPT_INVITE_TIMEOUT_MS,
            'Timed out accepting the Discord invite'
        );
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Subscribes to the streaming account joining a guild.
 *
 * @param handler - Called with the joined guild ID
 * @returns Unsubscribe function
 */
export function onStreamerGuildJoin(handler: (guildId: string) => void): () => void {
    streamerJoinHandlers.add(handler);
    return () => {
        streamerJoinHandlers.delete(handler);
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
 * Sends Discord's stream pause state for the active voice stream.
 *
 * @param paused - Whether viewers should see Discord's paused screen
 * @returns True when the opcode was sent
 */
function signalStreamPaused(paused: boolean): boolean {
    const connection = streamer.voiceConnection;
    const user = streamer.client.user;
    if (!connection || !user) {
        return false;
    }
    const streamKey = Utils.generateStreamKey(
        connection.type,
        connection.guildId,
        connection.channelId,
        user.id
    );
    streamer.sendOpcode(GatewayOpCodes.STREAM_SET_PAUSED, {
        stream_key: streamKey,
        paused,
    });
    return true;
}

/**
 * Pauses the active Discord stream without ending it. Discord shows its paused
 * screen, FFmpeg is suspended, and the Plex session and voice connection remain
 * open.
 *
 * @returns True when the stream was paused
 */
export function pauseStreaming(): boolean {
    if (persistentStream?.active) {
        if (!signalStreamPaused(true)) {
            return false;
        }
        const paused = persistentStream.pause();
        if (!paused) {
            signalStreamPaused(false);
            return false;
        }
        logger.info('Paused video stream with the Discord pause state');
        return true;
    }
    if (!currentChannelEntry || !streamProcess || streamPaused) {
        return false;
    }
    if (!signalStreamPaused(true)) {
        return false;
    }
    if (!streamProcess.kill('SIGSTOP')) {
        signalStreamPaused(false);
        return false;
    }
    streamPaused = true;
    logger.info('Paused video stream with the Discord pause state');
    return true;
}

/**
 * Resumes a stream paused by {@link pauseStreaming}.
 *
 * @returns True when the stream was resumed
 */
export function resumeStreaming(): boolean {
    if (persistentStream?.active) {
        const resumed = persistentStream.resume();
        if (!resumed) {
            return false;
        }
        signalStreamPaused(false);
        logger.info('Resumed video stream');
        return true;
    }
    if (!currentChannelEntry || !streamProcess || !streamPaused) {
        return false;
    }
    if (!streamProcess.kill('SIGCONT')) {
        return false;
    }
    signalStreamPaused(false);
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
    attachJoinListener();
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

    await libraryFixesReady;
    let signal = abortController.signal;
    let errorMessage: string | null = null;
    const ffmpegLog: string[] = [];
    let ffmpegTailLogged = false;
    const logFfmpegTail = () => {
        if (ffmpegTailLogged || ffmpegLog.length === 0) return;
        ffmpegTailLogged = true;
        logger.error(`Last FFmpeg output:\n${ffmpegLog.map(line => redactSecrets(line)).join('\n')}`);
    };

    try {
        logger.info('Stopping any possible existing stream');
        await stopStreaming();
        signal = abortController.signal;

        logger.info(`Attempting to stream: ${channelEntry.tvg_name ?? 'unknown'}`);

        const encoder = Encoders.software({
            x264: { preset: 'veryfast' },
            x265: { preset: 'veryfast' },
        });
        const inputOptions = [
            ...(settings.minimizeLatency ? LOW_LATENCY_INPUT_OPTIONS : []),
            ...(options.inputOptions ?? []),
        ];

        const { command, output, promise } = prepareStream(
            channelEntry.url,
            {
                noTranscoding: settings.disableTranscode,
                // The library's minimizeLatency passes an invalid `-flags lowdelay`.
                minimizeLatency: false,
                bitrateVideo: settings.bitrateVideo,
                bitrateVideoMax: settings.bitrateVideoMax,
                videoCodec: Utils.normalizeVideoCodec('H264'),
                encoder,
                customInputOptions: inputOptions,
                customHeaders: options.headers ?? {},
                customFfmpegFlags: KEYFRAME_OPTIONS,
            },
            signal
        );
        command.on('stderr', (line: string) => appendFfmpegLine(ffmpegLog, line));

        currentChannelEntry = channelEntry;
        streamProcess = promise as Promise<unknown> & {
            kill: (signal?: NodeJS.Signals | number) => boolean;
        };
        streamPaused = false;

        promise.catch((err: unknown) => {
            if (!signal.aborted) {
                errorMessage = String(err);
                logger.error(`FFmpeg process error: ${redactSecrets(String(err))}`);
                logFfmpegTail();
            }
        });

        command.on('error', (err: unknown) => {
            if (!signal.aborted) {
                errorMessage = String(err);
                logger.error(`FFmpeg ${redactSecrets(String(err))}`);
                logFfmpegTail();
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
            logFfmpegTail();
            await stopStreaming();
        }
        return { aborted: signal.aborted, error: errorMessage };
    }
}

/**
 * Starts a media stream on one persistent Discord stream connection. The
 * connection survives source swaps so seeking does not delete and recreate the
 * stream.
 *
 * @param channelEntry - Channel metadata and source URL
 * @param options - Input options and headers
 * @returns Playback result
 */
export async function startMediaStreaming(
    channelEntry: ChannelEntry,
    options: { inputOptions?: string[]; headers?: Record<string, string>; maxHeight?: number } = {}
): Promise<StreamResult> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return { aborted: false, error: 'Streamer client is not logged in' };
    }

    await libraryFixesReady;
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
            bitrateVideo: settings.bitrateVideo,
            bitrateVideoMax: settings.bitrateVideoMax,
            encoder,
            // On-demand media keeps the library's buffering. Low-latency
            // input flags force `low_delay` on sources that can contain
            // B-frames, and reading with `-re` leaves the demuxer without the
            // read-ahead that absorbs provider jitter. Both show up as a
            // frozen picture while audio keeps playing.
            inputOptions: options.inputOptions ?? [],
            headers: options.headers ?? {},
            maxHeight: options.maxHeight,
            scaleFilter: options.maxHeight ? buildScaleFilter(options.maxHeight) : undefined,
        });
    } catch (error) {
        const message = String(error);
        logger.error(`Error starting media stream: ${redactSecrets(message)}`);
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
 * Replaces the media source while keeping the current Discord stream alive.
 *
 * @param url - New provider transcode URL
 * @returns True when the source was replaced
 */
export async function replaceMediaStreamingSource(url: string): Promise<boolean> {
    if (!persistentStream?.active) {
        return false;
    }
    await persistentStream.replace(url);
    signalStreamPaused(false);
    return true;
}

/** @deprecated Use startMediaStreaming. */
export const startPlexStreaming = startMediaStreaming;

/** @deprecated Use replaceMediaStreamingSource. */
export const replacePlexStreamingSource = replaceMediaStreamingSource;

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
