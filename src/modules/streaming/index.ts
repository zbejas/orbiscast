import { Client } from "discord.js-selfbot-v13";
import { Streamer } from '@dank074/discord-video-stream';
import { prepareStream, playStream, Utils } from "@dank074/discord-video-stream";
import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();
let streamer = new Streamer(new Client());
let abortController = new AbortController();
let currentChannelEntry: ChannelEntry | null = null;
let streamSpectatorMonitor: ReturnType<typeof setInterval> | null = null;
let streamAloneTime: number = 0;

/**
 * Initializes the streaming client
 * Logs in the streamer client for video streaming capabilities
 */
export async function initializeStreamer() {
    try {
        await loginStreamer();
    } catch (error) {
        logger.error(`Error logging in streamer client: ${error}`);
    }
}

/**
 * Logs out the streamer client if currently logged in
 */
async function logoutStreamer() {
    if (!streamer.client.isReady()) {
        logger.debug('Streamer client is not logged in');
        return;
    }
    await (streamer.client as Client).logout();
    logger.info('Streamer client logged out successfully');
}

/**
 * Logs in the streamer client using the user token
 */
async function loginStreamer() {
    if (streamer.client.isReady()) {
        logger.debug('Streamer client is already logged in');
        return;
    }
    await (streamer.client as Client).login(config.DISCORD_USER_TOKEN);
    logger.info('Streamer client logged in successfully');
}

/**
 * Gets the current streaming channel entry.
 * 
 * @returns Channel entry object or null if not streaming
 */
export function getCurrentChannelEntry(): ChannelEntry | null {
    return currentChannelEntry;
}

/**
 * Joins a voice channel in the specified guild
 * @param guildId - Discord guild ID
 * @param channelId - Voice channel ID to join
 */
export async function joinVoiceChannel(guildId: string, channelId: string) {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in.');
        return;
    }

    const guild = streamer.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);

    if (!guild || !channel || !channel.isVoice()) {
        logger.error('Invalid guild or channel ID.');
        return;
    }

    const connection = streamer.voiceConnection;
    if (connection && connection.channelId === channelId) {
        logger.debug(`Already connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        return;
    }
    try {
        let response = await streamer.joinVoice(guildId, channelId);
        if (response.ready) {
            logger.info(`Connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        } else {
            logger.error(`Failed to connect to voice channel: ${channel.name} in guild: ${guild.name}`);
        }
    } catch (error) {
        logger.error(`Error joining voice channel: ${error}`);
    }
}

/**
 * Stops the stream and leaves the current voice channel
 */
export async function leaveVoiceChannel() {
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
        logger.info(`Stopped video stream and disconnected from the voice channel: ${channel?.name || 'unknown'} in guild: ${guild?.name || 'unknown'}`);
    } catch (error) {
        logger.error(`Error leaving voice channel: ${error}`);
    }
}

/**
 * Starts monitoring spectators in the voice channel.
 * Automatically stops the stream if there are no viewers for a specified time.
 * 
 * @returns Cleanup function to stop monitoring
 */
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

            // we don't count bots as spectators, and we don't count the bot itself
            const members = channel.members.filter(member => !member.user.bot).size - 1;
            if (members === 0) {
                streamAloneTime += 10;
                logger.debug(`No spectators for ${streamAloneTime} seconds`);

                if (streamAloneTime >= config.DEFAULT_STREAM_TIMEOUT * 60) {
                    logger.info(`No spectators for ${config.DEFAULT_STREAM_TIMEOUT} ${config.DEFAULT_STREAM_TIMEOUT > 1 ? 'minutes' : 'minute'}. Stopping stream.`);

                    stopStreaming().then(() => {
                        return leaveVoiceChannel();
                    }).catch(err => {
                        logger.error(`Error during automated stream cleanup: ${err}`);
                    });
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
            logger.debug('Cleaning up spectator monitor');
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;
    };
}

/**
 * Starts streaming the specified channel to a Discord voice channel
 * @param channelEntry - Channel information containing stream URL and metadata
 */
export async function startStreaming(channelEntry: ChannelEntry) {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return;
    }

    try {
        logger.info(`Stopping any possible existing stream.`);
        await stopStreaming();

        // Detect HLS stream and adjust settings accordingly
        const isHLS = channelEntry.url.includes('streamMode=hls') || channelEntry.url.includes('.m3u8');

        const { command, output } = prepareStream(channelEntry.url, {
            noTranscoding: false,
            minimizeLatency: config.MINIMIZE_LATENCY,
            bitrateVideo: config.BITRATE_VIDEO,
            bitrateVideoMax: config.BITRATE_VIDEO_MAX,
            videoCodec: Utils.normalizeVideoCodec("H264"),
            h26xPreset: "veryfast",
            customFfmpegFlags: isHLS ? [
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-fflags', '+genpts',
                '-re'
            ] : [],
        }, abortController.signal);

        currentChannelEntry = channelEntry;

        command.on("error", async (err: any, _stdout: any, _stderr: any) => {
            if (!err.toString().includes('ffmpeg exited with code 255')) {
                logger.error(`FFmpeg ${err}`);
                await stopStreaming();
            }
        });

        command.on("end", async (stdout: string | null, stderr: string | null) => {
            logger.debug(`FFmpeg process ended`);
            if (stderr) {
                logger.error(`FFmpeg stderr: ${stderr}`);
            }
            await stopStreaming();
        });

        logger.info(`Streaming channel: ${channelEntry.tvg_name}.`);

        const cleanupMonitoring = startSpectatorMonitoring();

        try {
            await playStream(output, streamer, {
                type: "go-live",
                //readrateInitialBurst: 1000000,
            }, abortController.signal);
        } finally {
            // Always cleanup monitoring regardless of success or failure
            cleanupMonitoring();
        }
    } catch (error) {
        logger.error(`Error starting stream: ${error}`);
        await stopStreaming();
    }
}

/**
 * Stops the current stream and cleans up resources
 */
export async function stopStreaming() {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return;
    }

    try {
        abortController.abort();
        await new Promise(resolve => setTimeout(resolve, 1000));
        abortController = new AbortController();

        if (streamSpectatorMonitor) {
            logger.debug('Clearing spectator monitor');
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;

        if (!currentChannelEntry) {
            logger.debug('No channel currently playing');
            return;
        }

        logger.info(`Stopped video stream from ${currentChannelEntry?.tvg_name || 'unknown channel'}`);
        currentChannelEntry = null;
    } catch (error) {
        logger.error(`Error stopping stream: ${error}`);
    }
}

