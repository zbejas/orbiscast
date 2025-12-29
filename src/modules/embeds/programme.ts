import { BaseEmbedProcessor } from './base';
import { EmbedBuilder } from 'discord.js';
import type { EmbedOptions, EmbedResult } from './types';
import type { ChannelEntry, ProgrammeEntry } from '../../interfaces/iptv';

/**
 * Processor for creating embeds from TV programme data
 */
export class ProgrammeEmbedProcessor extends BaseEmbedProcessor<ProgrammeEntry> {
    /**
     * Validates that the data is a valid programme entry
     * @param data - Data to validate
     * @returns Type guard indicating if the data is a valid programme entry
     */
    protected validateData(data: unknown): data is ProgrammeEntry {
        const programme = data as ProgrammeEntry;
        return typeof programme === 'object' && programme !== null &&
            typeof programme.title === 'string';
    }

    /**
     * Generates a Discord embed from a programme entry
     * @param programme - The programme data
     * @param options - Customization options for the embed
     * @returns Generated embed result
     */
    protected generateEmbed(programme: ProgrammeEntry, options: EmbedOptions): EmbedResult {
        const { theme = 'light', title, color = '#3fd15e' } = options;

        const startDate = programme.start
            ? new Date(programme.start)
            : programme.start_timestamp ? new Date(programme.start_timestamp * 1000) : null;

        const stopDate = programme.stop
            ? new Date(programme.stop)
            : programme.stop_timestamp ? new Date(programme.stop_timestamp * 1000) : null;

        const embed = new EmbedBuilder()
            .setTitle(title || programme.title)
            .setColor(color as any)
            .setTimestamp();

        if (startDate && stopDate) {
            const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const stopTime = stopDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const date = startDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

            embed.addFields(
                { name: 'Time', value: `${startTime} - ${stopTime}`, inline: true },
                { name: 'Date', value: date, inline: true }
            );
        }

        if (programme.description) {
            embed.setDescription(programme.description);
        }

        // Add season/episode information if available
        if (programme.season !== undefined || programme.episode !== undefined) {
            const episodeInfo = [];
            if (programme.season !== undefined) episodeInfo.push(`Season ${programme.season}`);
            if (programme.episode !== undefined) episodeInfo.push(`Episode ${programme.episode}`);
            embed.addFields({ name: '📺 Episode', value: episodeInfo.join(' • '), inline: true });
        }

        if (programme.subtitle) {
            embed.addFields({ name: 'Subtitle', value: programme.subtitle, inline: true });
        }

        if (programme.category) {
            embed.addFields({ name: 'Category', value: programme.category, inline: true });
        }

        return { embed };
    }

    /**
     * Creates a simplified representation of a programme for use in other embeds
     * @param programme - The programme data
     * @returns Simplified programme information object
     */
    public generateProgrammeInfoEmbed(programme: ProgrammeEntry): any {
        const startDate = programme.start
            ? new Date(programme.start)
            : programme.start_timestamp ? new Date(programme.start_timestamp * 1000) : null;

        const stopDate = programme.stop
            ? new Date(programme.stop)
            : programme.stop_timestamp ? new Date(programme.stop_timestamp * 1000) : null;

        const startTime = startDate ? startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Unknown';
        const stopTime = stopDate ? stopDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Unknown';

        const description = typeof programme.description === 'string'
            ? programme.description.substring(0, 150) + (programme.description.length > 150 ? '...' : '')
            : 'No description available';

        // Build episode info if available
        const episodeInfo = [];
        if (programme.season !== undefined) episodeInfo.push(`S${programme.season}`);
        if (programme.episode !== undefined) episodeInfo.push(`E${programme.episode}`);
        const episodeText = episodeInfo.length > 0 ? ` (${episodeInfo.join('')})` : '';

        return {
            title: programme.title + episodeText,
            timeRange: `${startTime} - ${stopTime}`,
            description
        };
    }

    /**
     * Finds the currently airing programme from a list
     * @param programmes - List of programmes to search
     * @param now - Current timestamp in seconds
     * @returns The current programme or the first one if none are current
     */
    public static getCurrentShow(programmes: ProgrammeEntry[], now: number): ProgrammeEntry | undefined {
        return programmes.find(p =>
            (p.start_timestamp ?? 0) <= now && (p.stop_timestamp ?? Infinity) >= now
        ) || programmes[0];
    }

    /**
     * Generates a set of programme guide embeds for a channel
     * @param channelName - Name of the channel
     * @param channelProgrammes - List of programmes for the channel
     * @returns Array of embeds for the channel's programme guide
     */
    public static generateProgrammeInfoEmbeds(
        channelName: string,
        channelProgrammes: ProgrammeEntry[]
    ): EmbedBuilder[] {
        const now = Math.floor(Date.now() / 1000);
        const futureProgrammes = channelProgrammes
            .filter(p => typeof p.stop_timestamp === 'number' && p.stop_timestamp >= now)
            .sort((a, b) => (a.start_timestamp ?? 0) - (b.start_timestamp ?? 0))
            .slice(0, 10); // Get the next 10 upcoming shows

        if (futureProgrammes.length === 0) {
            return [];
        }

        const programmesByDate = futureProgrammes.reduce((acc, programme) => {
            const startDate = programme.start
                ? new Date(programme.start)
                : new Date(programme.start_timestamp ? programme.start_timestamp * 1000 : Date.now());

            const dateKey = startDate.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push(programme);
            return acc;
        }, {} as Record<string, typeof futureProgrammes>);

        const mainEmbed = new EmbedBuilder()
            .setTitle(`📺 Programme Guide: ${channelName}`)
            .setColor('#0099ff')
            .setTimestamp()
            .setFooter({ text: 'Programme information is subject to change' });

        const currentShow = this.getCurrentShow(futureProgrammes, now);

        if (currentShow) {
            const isLive = (currentShow.start_timestamp ?? 0) <= now && (currentShow.stop_timestamp ?? Infinity) >= now;
            const startDate = currentShow.start
                ? new Date(currentShow.start)
                : new Date(currentShow.start_timestamp ? currentShow.start_timestamp * 1000 : Date.now());
            const stopDate = currentShow.stop
                ? new Date(currentShow.stop)
                : new Date(currentShow.stop_timestamp ? currentShow.stop_timestamp * 1000 : Date.now());

            const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const stopTime = stopDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const date = startDate.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

            const description = typeof currentShow.description === 'string' ? currentShow.description : '';

            // Build episode info for title
            const episodeInfo = [];
            if (currentShow.season !== undefined) episodeInfo.push(`S${currentShow.season}`);
            if (currentShow.episode !== undefined) episodeInfo.push(`E${currentShow.episode}`);
            const episodeText = episodeInfo.length > 0 ? ` (${episodeInfo.join('')})` : '';
            const showTitle = currentShow.subtitle
                ? `${currentShow.title}${episodeText}: ${currentShow.subtitle}`
                : `${currentShow.title}${episodeText}`;

            mainEmbed
                .setDescription(`${isLive ? '🔴 **NOW LIVE**' : '**Next Up**'}: ${showTitle}`)
                .addFields(
                    { name: 'Time', value: `${startTime} - ${stopTime}`, inline: true },
                    { name: 'Date', value: date, inline: true },
                    { name: 'Description', value: description ? description.substring(0, 200) + (description.length > 200 ? '...' : '') : 'No description available' }
                );

            if (isLive) {
                mainEmbed.setColor('#FF0000'); // Red for live shows
            }
        }

        const embedsToSend = [mainEmbed];

        Object.entries(programmesByDate).forEach(([date, programmes]) => {
            // Skip if this is just the current show
            if (programmes.length === 1 && programmes[0] === currentShow) {
                return;
            }

            const dateEmbed = new EmbedBuilder()
                .setTitle(`📅 ${date}`)
                .setColor('#00AAFF');

            programmes.forEach(programme => {
                if (programme === currentShow) return; // Skip current show as it's in the main embed

                const startDate = programme.start
                    ? new Date(programme.start)
                    : new Date(programme.start_timestamp ? programme.start_timestamp * 1000 : Date.now());
                const stopDate = programme.stop
                    ? new Date(programme.stop)
                    : new Date(programme.stop_timestamp ? programme.stop_timestamp * 1000 : Date.now());

                const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                const stopTime = stopDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                const description = typeof programme.description === 'string'
                    ? (programme.description.length > 100
                        ? `${programme.description.substring(0, 100)}...`
                        : programme.description)
                    : 'No description available';

                // Build episode info
                const episodeInfo = [];
                if (programme.season !== undefined) episodeInfo.push(`S${programme.season}`);
                if (programme.episode !== undefined) episodeInfo.push(`E${programme.episode}`);
                const episodeText = episodeInfo.length > 0 ? ` (${episodeInfo.join('')})` : '';
                const showTitle = programme.subtitle
                    ? `${programme.title}${episodeText}: ${programme.subtitle}`
                    : `${programme.title}${episodeText}`;

                dateEmbed.addFields({
                    name: `${startTime} - ${stopTime}: ${showTitle}`,
                    value: description
                });
            });

            if (dateEmbed.data.fields?.length) {
                embedsToSend.push(dateEmbed);
            }
        });

        // Discord has a limit of up to 10 embeds per message
        return embedsToSend.slice(0, 10);
    }

    /**
     * Creates a channel list embed for programme selection
     * @param channelsToDisplay - Channels to include in the list
     * @param liveChannel - Currently streaming channel, if any
     * @param pageOption - Current page number
     * @param totalPages - Total number of pages
     * @returns Discord embed with channel list
     */
    public static generateChannelListEmbed(
        channelsToDisplay: ChannelEntry[],
        liveChannel: ChannelEntry | null,
        pageOption: number,
        totalPages: number
    ): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle(`📺 Channel Programme Guide (Page ${pageOption}/${totalPages})`)
            .setDescription('Click a channel to view its programme guide')
            .setColor('#0099ff')
            .setTimestamp();

        const start = (pageOption - 1) * 25; // Using 25 as itemsPerPage

        for (let i = 0; i < channelsToDisplay.length; i += 10) {
            const chunk = channelsToDisplay.slice(i, i + 10);
            const fieldValue = chunk.map(channel => {
                const channelName = channel.tvg_name || 'Unknown';
                const isLive = liveChannel?.tvg_name === channel.tvg_name;
                return `- ${channelName} ${isLive ? '🔴 LIVE' : ''}`;
            }).join('\n');
            embed.addFields({ name: `Channels ${start + i + 1}-${start + i + chunk.length}`, value: fieldValue });
        }

        return embed;
    }
}

export const programmeEmbedProcessor = new ProgrammeEmbedProcessor();
