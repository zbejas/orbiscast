import { EmbedBuilder } from 'discord.js';
import { BaseEmbedProcessor } from './base';
import type { EmbedOptions, EmbedResult } from './types';
import type { ChannelEntry } from '../../interfaces/iptv';

/**
 * Processor for creating embeds from IPTV channel data
 */
export class ChannelEmbedProcessor extends BaseEmbedProcessor<ChannelEntry> {
    /**
     * Validates that the data is a valid channel entry
     * @param data - Data to validate
     * @returns Type guard indicating if the data is a valid channel entry
     */
    protected validateData(data: unknown): data is ChannelEntry {
        const channel = data as ChannelEntry;
        return typeof channel === 'object' && channel !== null &&
            typeof channel.tvg_id === 'string' &&
            typeof channel.tvg_name === 'string';
    }

    /**
     * Generates a Discord embed from a channel entry
     * @param channel - The channel data
     * @param options - Customization options for the embed
     * @returns Generated embed result
     */
    protected generateEmbed(channel: ChannelEntry, options: EmbedOptions): EmbedResult {
        const { theme = 'light', title, color = '#3fd15e' } = options;

        const embed = new EmbedBuilder()
            .setTitle(title || `📺 ${channel.tvg_name || 'Channel'}`)
            .setColor(color as any)
            .setTimestamp();

        if (channel.tvg_logo && !channel.tvg_logo.startsWith('http://')) {
            embed.setThumbnail(channel.tvg_logo);
        }

        embed.addFields(
            { name: 'Channel', value: channel.tvg_name || 'Unknown Channel', inline: true },
            { name: 'Category', value: channel.group_title || 'No Category', inline: true }
        );

        if (channel.country && channel.country !== channel.group_title) {
            embed.addFields({ name: 'Country', value: channel.country, inline: true });
        }

        return { embed };
    }

    /**
     * Creates a simplified representation of a channel for use in other embeds
     * @param channel - The channel data
     * @returns Simplified channel information object
     */
    public generateChannelInfoEmbed(channel: ChannelEntry): any {
        return {
            name: channel.tvg_name || 'Unknown Channel',
            logo: channel.tvg_logo,
            group: channel.group_title
        };
    }
}

export type Channel = ChannelEntry;
