import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ButtonInteraction, ComponentType, EmbedBuilder, GuildMember, Message, InteractionResponse, MessageFlags } from 'discord.js';
import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { getChannelEntries, getProgrammeEntries } from '../../modules/database';
import { getVoiceConnection } from '@discordjs/voice';
import { initializeStreamer, joinVoiceChannel, startStreaming, stopStreaming } from '../../modules/streaming';
import { generateProgrammeInfo } from './programme';
import { executeStopStream } from './stop';
import { createStreamEmbed } from '../embeds';

const logger = getLogger();
const PROGRAMME_BUTTON_ID = 'show_programme';
const STOP_BUTTON_ID = 'stop_stream';

/**
 * Starts streaming the requested channel to a voice channel
 * @param channelName - Name of the channel to stream
 * @param voiceChannelId - Discord voice channel ID to stream to
 * @param interaction - Optional Discord interaction for button collectors
 * @returns Object containing success status, message, and UI components
 */
export async function executeStreamChannel(
    channelName: string,
    voiceChannelId: string,
): Promise<{
    success: boolean;
    message: string;
    channel?: any;
    embed?: EmbedBuilder;
    components?: ActionRowBuilder<ButtonBuilder>[];
    setupCollector?: (message: Message | InteractionResponse) => void;
}> {
    if (!channelName) {
        return { success: false, message: 'Please specify a channel name.' };
    }

    logger.info(`Attempting to stream channel: ${channelName}`);

    try {
        const channels = await getChannelEntries();
        const channel = channels.find(ch => ch.tvg_name?.toLowerCase() === channelName.toLowerCase());

        if (!channel || !channel.tvg_id) {
            return { success: false, message: `Channel not found: ${channelName}` };
        }

        if (!voiceChannelId) {
            return { success: false, message: 'You need to be in a voice channel to use this function.' };
        }

        try {
            await initializeStreamer();
            await new Promise(resolve => setTimeout(resolve, 750));

            const connection = getVoiceConnection(config.GUILD);
            if (connection && connection.joinConfig.channelId === voiceChannelId) {
                logger.debug('Already connected to the desired voice channel');
            } else {
                logger.info('Joining voice channel...');
                await joinVoiceChannel(config.GUILD, voiceChannelId);
                await new Promise(resolve => setTimeout(resolve, 750));
            }

            const allProgrammes = await getProgrammeEntries();
            const channelProgrammes = allProgrammes.filter(p => p.channel === channel.tvg_id);
            const now = Math.floor(Date.now() / 1000);

            const currentProgramme = channelProgrammes.find(p =>
                (p.start_timestamp ?? 0) <= now &&
                (p.stop_timestamp ?? Infinity) >= now
            );

            const nextProgrammes = channelProgrammes
                .filter(p => (p.start_timestamp ?? 0) > now)
                .sort((a, b) => (a.start_timestamp ?? 0) - (b.start_timestamp ?? 0));

            // Use our new embed creator function
            const streamEmbed = createStreamEmbed(channel, currentProgramme, nextProgrammes);

            // This is empty for now, but we can add buttons to the embed
            let components: ActionRowBuilder<ButtonBuilder>[] = [];

            // Add a function to setup the collector only when interaction buttons are included
            const setupCollector = (message: Message | InteractionResponse) => {
                // Create a collector for button interactions
                const collector = message.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                });

                collector.on('collect', async (i) => {
                    try {
                        await i.deferUpdate();
                        if (i.customId === PROGRAMME_BUTTON_ID) {
                            logger.info(`Programme button clicked for channel: ${channelName} by ${i.user.tag}`);
                            const programmeInfo = await generateProgrammeInfo(channelName);

                            if (!programmeInfo.success) {
                                await i.followUp({
                                    content: programmeInfo.message,
                                    flags: MessageFlags.Ephemeral
                                });
                                return;
                            }

                            await i.followUp({
                                content: `📺 Programme Guide for ${channelName}`,
                                embeds: programmeInfo.embeds,
                                flags: MessageFlags.Ephemeral // Only visible to the user who clicked
                            });
                        } else if (i.customId === STOP_BUTTON_ID) {
                            logger.info(`Stop button clicked for stream: ${channelName} by ${i.user.tag}`);
                            const stopResult = await executeStopStream();

                            if (!stopResult.success) {
                                await i.followUp({
                                    content: stopResult.message,
                                    flags: MessageFlags.Ephemeral
                                });
                                return;
                            }

                            await i.followUp({
                                content: 'Stream stopped successfully.',
                                ephemeral: false
                            });
                        } else if (i.customId.startsWith('play_channel_')) {
                            const playChannelName = i.customId.replace('play_channel_', '');
                            // Pass the current button interaction to maintain the interaction chain
                            const playResult = await executeStreamChannel(playChannelName, voiceChannelId);

                            if (playResult.success) {
                                await i.followUp({
                                    content: playResult.message,
                                    embeds: playResult.embed ? [playResult.embed] : [],
                                    components: playResult.components || [],
                                    flags: MessageFlags.Ephemeral
                                });

                                // Setup collector for the new message if available
                                if (playResult.setupCollector) {
                                    const reply = await i.fetchReply();
                                    playResult.setupCollector(reply);
                                }
                            } else {
                                await i.followUp({
                                    content: playResult.message,
                                    flags: MessageFlags.Ephemeral
                                });
                            }
                        }
                    } catch (error) {
                        logger.error(`Error handling button interaction: ${error}`);
                        try {
                            await i.followUp({
                                content: 'An error occurred while processing your request.',
                                flags: MessageFlags.Ephemeral
                            });
                        } catch (followUpError) {
                            logger.error(`Error sending follow-up message: ${followUpError}`);
                        }
                    }
                });
            }

            // we will not await this as it's a void function, but we need to call it to start the stream
            startStreaming(channel);
            return {
                success: true,
                message: ``, // Empty message as we're sending the embed
                channel: channel,
                embed: streamEmbed,
                components,
                setupCollector
            };
        } catch (streamError) {
            logger.error(`Stream error: ${streamError}`);
            if (streamError instanceof Error) {
                return { success: false, message: `Error during streaming: ${streamError.message}` };
            } else {
                return { success: false, message: 'An unknown error occurred during streaming.' };
            }
        }
    } catch (error) {
        logger.error(`Error getting stream: ${error}`);
        return { success: false, message: 'An error occurred while fetching the stream information.' };
    }
}

/**
 * Handles the stream command interaction
 * @param interaction - The Discord command interaction
 */
export async function handleStreamCommand(interaction: ChatInputCommandInteraction) {
    try {
        const channelName = interaction.options.getString('channel');
        if (!channelName) {
            await interaction.reply({
                content: 'Please specify a channel name.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.member as GuildMember;
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            await interaction.editReply('You need to be in a voice channel to use this command.');
            return;
        }

        const result = await executeStreamChannel(channelName, voiceChannel.id);

        if (!result.success) {
            await interaction.editReply(result.message);
            return;
        }

        const reply = await interaction.editReply({
            content: result.message,
            embeds: result.embed ? [result.embed] : [],
            components: result.components || []
        });

        if (result.setupCollector) {
            result.setupCollector(reply);
        }
    } catch (error) {
        logger.error(`Error handling stream command: ${error}`);
        try {
            await interaction.reply({
                content: 'An error occurred while processing your request.',
                flags: MessageFlags.Ephemeral
            });
        } catch (replyError) {
            logger.error(`Error sending reply: ${replyError}`);
        }
    }
}
