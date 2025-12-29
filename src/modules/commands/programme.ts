import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, EmbedBuilder, MessageFlags, type Channel } from 'discord.js';
import { getLogger } from '../../utils/logger';
import { getChannelEntries, getProgrammeEntries } from '../../modules/database';
import type { ChannelEntry, ProgrammeEntry } from '../../interfaces/iptv';
import { getCurrentChannelEntry } from '../streaming';
import { ProgrammeEmbedProcessor } from '../embeds/programme';

const logger = getLogger();
/**
 * Generates programme information embeds for a given channel
 * @param channelName - Name of the channel to get programme information for
 * @returns Object containing success status, message and programme embeds
 */
export async function generateProgrammeInfo(channelName: string) {
    try {
        const channels = await getChannelEntries();
        const channel = channels.find(ch => ch.tvg_name?.toLowerCase() === channelName.toLowerCase());

        if (!channel || !channel.tvg_id) {
            return { success: false, message: `Channel not found: ${channelName}`, embeds: [] };
        }

        const allProgrammes = await getProgrammeEntries();
        const channelProgrammes = allProgrammes.filter(p => p.channel === channel.tvg_id);

        const now = Math.floor(Date.now() / 1000);
        const futureProgrammes = channelProgrammes
            .filter(p => typeof p.stop_timestamp === 'number' && p.stop_timestamp >= now)
            .sort((a, b) => (a.start_timestamp ?? 0) - (b.start_timestamp ?? 0))
            .slice(0, 10); // Get the next 10 upcoming shows

        if (futureProgrammes.length === 0) {
            return { success: false, message: `No upcoming programmes found for channel: ${channelName}`, embeds: [] };
        }

        // Use the moved embed generation function
        const embedsToSend = ProgrammeEmbedProcessor.generateProgrammeInfoEmbeds(channelName, channelProgrammes);

        if (embedsToSend.length === 0) {
            return { success: false, message: `No programme information available for channel: ${channelName}`, embeds: [] };
        }

        return { success: true, message: '', embeds: embedsToSend };

    } catch (error) {
        logger.error(`Error generating programme info: ${error}`);
        return { success: false, message: 'An error occurred while fetching the programme information.', embeds: [] };
    }
}

/**
 * Generates a paginated channel list for programme selection
 * @param pageOption - Page number to display
 * @returns Response object containing embed, components and status information
 */
export async function generateProgrammeList(pageOption: number = 1): Promise<{
    success: boolean,
    message: string,
    page: number,
    totalPages: number,
    channels?: any[],
    embed?: EmbedBuilder,
    components?: ActionRowBuilder<ButtonBuilder>[]
}> {
    const channelEntries = await getChannelEntries();
    const itemsPerPage = 20;

    const totalPages = Math.ceil(channelEntries.length / itemsPerPage);

    if (pageOption < 1 || pageOption > totalPages) {
        return {
            success: false,
            message: `Invalid page number. Please provide a number between 1 and ${totalPages}.`,
            page: pageOption,
            totalPages
        };
    }

    const start = (pageOption - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const channelsToDisplay = channelEntries.slice(start, end);

    const liveChannel: ChannelEntry | null = getCurrentChannelEntry();

    // Use the moved embed generation function
    const embed = ProgrammeEmbedProcessor.generateChannelListEmbed(
        channelsToDisplay,
        liveChannel,
        pageOption,
        totalPages
    );

    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    const paginationRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`programme_list_prev_${pageOption}`)
                .setLabel('Previous Page')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageOption <= 1),
            new ButtonBuilder()
                .setCustomId(`programme_list_next_${pageOption}`)
                .setLabel('Next Page')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(pageOption >= totalPages)
        );
    components.push(paginationRow);

    const maxButtonsPerRow = 5;
    const maxButtonRows = 4;

    const channelsForButtons = channelsToDisplay.slice(0, maxButtonsPerRow * maxButtonRows);

    for (let i = 0; i < channelsForButtons.length; i += maxButtonsPerRow) {
        const buttonRow = new ActionRowBuilder<ButtonBuilder>();
        const chunk = channelsForButtons.slice(i, i + maxButtonsPerRow);

        for (const channel of chunk) {
            if (channel.tvg_name) {
                const isLive = liveChannel?.tvg_name === channel.tvg_name;

                // Sanitize the channel name for use in custom ID
                // Discord has a 100 character limit on custom IDs
                const safeChannelName = channel.tvg_name.replace(/[^\w-]/g, '_').slice(0, 80);

                //logger.debug(`Creating button with ID: view_programme_${safeChannelName} for channel: ${channel.tvg_name}`);

                buttonRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`view_programme_${safeChannelName}`)
                        .setLabel(`${isLive ? '🔴 ' : '📋 '}${channel.tvg_name}`)
                        .setStyle(isLive ? ButtonStyle.Danger : ButtonStyle.Primary)
                );
            }
        }

        if (buttonRow.components.length > 0) {
            components.push(buttonRow);
        }
    }

    return {
        success: true,
        message: `Select a channel to view the programme guide:`,
        page: pageOption,
        totalPages,
        channels: channelsToDisplay,
        embed,
        components
    };
}

/**
 * Handles pagination button interaction for programme list
 * @param interaction - Button interaction
 */
export async function handleProgrammeListButtonInteraction(interaction: ButtonInteraction) {
    try {
        logger.debug(`Received button interaction: ${interaction.customId}`);

        await interaction.deferUpdate().catch(err => {
            logger.error(`Failed to defer update: ${err}`);
        });

        const customId = interaction.customId;

        if (customId.startsWith('view_programme_')) {
            const encodedChannelName = customId.replace('view_programme_', '');
            logger.debug(`Looking for channel with encoded name: ${encodedChannelName}`);

            // Find the actual channel by comparing sanitized names
            const channels = await getChannelEntries();
            const channel = channels.find(ch => {
                const sanitized = ch.tvg_name?.replace(/[^\w-]/g, '_').slice(0, 80);
                return sanitized === encodedChannelName;
            });

            if (!channel || !channel.tvg_name) {
                logger.error(`Could not find channel for encoded name: ${encodedChannelName}`);
                await interaction.followUp({
                    content: `Could not find the selected channel. Please try again.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const channelName = channel.tvg_name;

            const programmeInfo = await generateProgrammeInfo(channelName);

            logger.debug(`Programme info result: ${JSON.stringify({
                success: programmeInfo.success,
                message: programmeInfo.message,
                embedCount: programmeInfo.embeds.length
            })}`);

            if (!programmeInfo.success) {
                await interaction.followUp({
                    content: programmeInfo.message,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.followUp({
                embeds: programmeInfo.embeds,
                flags: MessageFlags.Ephemeral
            }).catch(err => {
                logger.error(`Failed to send embeds: ${err}`);
                interaction.followUp({
                    content: "Error displaying programme information. Please try again later.",
                    flags: MessageFlags.Ephemeral
                }).catch(() => { });
            });
        } else if (customId.startsWith('programme_list_prev_') || customId.startsWith('programme_list_next_')) {
            const currentPage = parseInt(customId.split('_').pop() || '1');
            let newPage = currentPage;

            if (customId.startsWith('programme_list_prev_')) {
                newPage = Math.max(1, currentPage - 1);
            } else {
                newPage = currentPage + 1;
            }

            const result = await generateProgrammeList(newPage);

            if (!result.success) {
                await interaction.followUp({
                    content: result.message,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.editReply({
                content: result.message,
                embeds: result.embed ? [result.embed] : [],
                components: result.components || []
            });
        }
    } catch (error) {
        logger.error(`Error handling programme list button: ${error}`);
        try {
            await interaction.followUp({
                content: 'An error occurred while processing your request.',
                flags: MessageFlags.Ephemeral
            });
        } catch (followupError) {
            logger.error(`Failed to send error message: ${followupError}`);
        }
    }
}

/**
 * Handles the programme command interaction, showing TV guide for a channel
 * @param interaction - The Discord command interaction
 */
export async function handleProgrammeCommand(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelName = interaction.options.getString('channel');

    // If no channel is specified, show the channel list for selection
    if (!channelName) {
        const result = await generateProgrammeList();

        if (!result.success) {
            await interaction.editReply({ content: result.message });
            return;
        }

        const message = await interaction.editReply({
            content: result.message,
            embeds: result.embed ? [result.embed] : [],
            components: result.components || []
        });

        // Create a collector for button interactions
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 10 * 60 * 1000 // 10 minutes timeout
        });

        collector.on('collect', async (buttonInteraction) => {
            logger.debug(`Button interaction received: ${buttonInteraction.customId}`);
            await handleProgrammeListButtonInteraction(buttonInteraction);
        });

        collector.on('end', () => {
            logger.debug('Button collector ended');
            // Update message to remove buttons when collector expires
            interaction.editReply({
                content: 'This selection has expired. Please run the command again to view programme information.',
                components: []
            }).catch(err => {
                logger.error(`Failed to update expired message: ${err}`);
            });
        });

        return;
    }

    logger.info(`Fetching programme for channel: ${channelName}`);

    const programmeInfo = await generateProgrammeInfo(channelName);

    if (!programmeInfo.success) {
        await interaction.editReply({ content: programmeInfo.message });
        return;
    }

    await interaction.editReply({ embeds: programmeInfo.embeds });
}