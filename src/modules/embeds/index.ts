import { ProgrammeEmbedProcessor } from './programme';
import { ChannelEmbedProcessor, type Channel } from './channel';
import type { EmbedOptions, EmbedResult, EmbedProcessor } from './types';
import { EmbedBuilder } from 'discord.js';
import type { ProgrammeEntry } from '../../interfaces/iptv';

export type { EmbedOptions, EmbedResult, EmbedProcessor };
export { BaseEmbedProcessor } from './base';
export { ProgrammeEmbedProcessor } from './programme';
export { ChannelEmbedProcessor } from './channel';
export type { Channel } from './channel';

// Create instances of our processors
const programmeProcessor = new ProgrammeEmbedProcessor();
const channelProcessor = new ChannelEmbedProcessor();

// Export a list of all processors
export const embedProcessors = [
    programmeProcessor,
    channelProcessor,
];

/**
 * Processes any compatible data into a Discord embed
 * @param data - Data to process
 * @param options - Customization options for the embed
 * @returns Generated embed result or null if no processor can handle the data
 */
export async function processEmbed(data: unknown, options: EmbedOptions = {}): Promise<EmbedResult | null> {
    for (const processor of embedProcessors) {
        if (processor.canProcess(data)) {
            return await processor.process(data, options);
        }
    }
    return null;
}

/**
 * Type guard to check if data is a programme
 * @param data - Data to check
 * @returns True if the data is a programme
 */
export function isProgramme(data: unknown): data is ProgrammeEntry {
    return programmeProcessor.canProcess(data);
}

/**
 * Type guard to check if data is a channel
 * @param data - Data to check
 * @returns True if the data is a channel
 */
export function isChannel(data: unknown): data is Channel {
    return channelProcessor.canProcess(data);
}

/**
 * Creates a Discord embed for a programme
 * @param programme - Programme data
 * @param embedOptions - Customization options for the embed
 * @returns Generated embed result
 */
export async function createProgrammeEmbed(
    programme: ProgrammeEntry,
    embedOptions: EmbedOptions = {}
): Promise<EmbedResult> {
    return await programmeProcessor.process(programme, {
        title: `📺 ${programme.title}`,
        color: '#3fd15e',
        ...embedOptions
    });
}

/**
 * Creates a Discord embed for a channel
 * @param channel - Channel data
 * @param embedOptions - Customization options for the embed
 * @returns Generated embed result
 */
export async function createChannelEmbed(
    channel: Channel,
    embedOptions: EmbedOptions = {}
): Promise<EmbedResult> {
    return await channelProcessor.process(channel, {
        title: `📺 ${channel.tvg_name || 'Channel'} Stream`,
        color: '#3fd15e',
        ...embedOptions
    });
}

/**
 * Creates a rich Discord embed for a streaming channel with programme information
 * @param channel - Channel being streamed
 * @param currentProgramme - Currently airing programme, if available
 * @param upcomingProgrammes - List of upcoming programmes
 * @returns Discord embed for the stream
 */
export function createStreamEmbed(
    channel: Channel,
    currentProgramme?: ProgrammeEntry | null,
    upcomingProgrammes: ProgrammeEntry[] = []
): EmbedBuilder {
    const streamEmbed = new EmbedBuilder()
        .setTitle(`📺 ${channel.tvg_name || 'Channel'} Stream`)
        .setColor('#3fd15e')
        .setTimestamp();

    if (channel.tvg_logo && !channel.tvg_logo.startsWith('http://')) {
        streamEmbed.setThumbnail(channel.tvg_logo);
    }

    if (currentProgramme) {
        const info = programmeProcessor.generateProgrammeInfoEmbed(currentProgramme);
        streamEmbed.addFields(
            { name: '🔴 NOW PLAYING', value: info.title, inline: false },
            { name: 'Time', value: info.timeRange, inline: true },
            { name: 'Description', value: info.description }
        );
    } else {
        streamEmbed.addFields(
            { name: '🔴 NOW PLAYING', value: 'No current programme information available', inline: false }
        );
    }

    if (upcomingProgrammes.length > 0) {
        const upcomingCount = Math.min(10, upcomingProgrammes.length);
        const upcomingList = upcomingProgrammes.slice(0, upcomingCount)
            .map(prog => {
                const startDate = prog.start
                    ? new Date(prog.start)
                    : prog.start_timestamp ? new Date(prog.start_timestamp * 1000) : new Date();

                const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                const timeUntilStart = Math.floor((startDate.getTime() - Date.now()) / 60000); // minutes until start

                const formatTime = (minutes: number): string => {
                    if (minutes < 60) return `${minutes} min`;
                    const hours = Math.floor(minutes / 60);
                    const remainingMinutes = minutes % 60;
                    if (remainingMinutes === 0) return `${hours}h`;
                    return `${hours}h ${remainingMinutes}min`;
                };

                // Build episode info
                const episodeInfo = [];
                if (prog.season !== undefined) episodeInfo.push(`S${prog.season}`);
                if (prog.episode !== undefined) episodeInfo.push(`E${prog.episode}`);
                const episodeText = episodeInfo.length > 0 ? ` (${episodeInfo.join('')})` : '';
                const showTitle = prog.subtitle
                    ? `${prog.title}${episodeText}: ${prog.subtitle}`
                    : `${prog.title}${episodeText}`;

                return `• **${showTitle}** at ${startTime} (in ${formatTime(timeUntilStart)})`;
            });

        streamEmbed.addFields({
            name: '⏭️ UPCOMING',
            value: upcomingList.join('\n'),
            inline: false,
        });
    } else {
        streamEmbed.addFields(
            { name: '⏭️ UPCOMING', value: 'No upcoming programme information available', inline: false }
        );
    }

    streamEmbed.setFooter({ text: 'Stream and programme information is subject to change' });
    return streamEmbed;
}
