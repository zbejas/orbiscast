import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getLogger } from '../../utils/logger';
import { downloadCacheAndFillDb, syncPlaylistChannels, populateDatabaseFromXMLTV } from '../../modules/iptv';

const logger = getLogger();

/**
 * Executes a refresh operation for channel or program data
 * @param type - Type of refresh operation ('all', 'channels', or 'programme')
 * @returns Object containing success status and result message
 */
export async function executeRefresh(type: string): Promise<{ success: boolean, message: string }> {
    try {
        if (type === 'all') {
            logger.info('Refreshing all data...');
            await downloadCacheAndFillDb(true);
        } else if (type === 'channels') {
            logger.info('Refreshing channels...');
            await syncPlaylistChannels(true);
        } else if (type === 'programme') {
            logger.info('Refreshing programme...');
            await populateDatabaseFromXMLTV(true);
        } else {
            return { success: false, message: `Unknown refresh type: ${type}` };
        }

        logger.info(`Successfully refreshed ${type} data.`);
        return { success: true, message: `Successfully refreshed ${type} data.` };
    } catch (error) {
        logger.error(`Error refreshing ${type} data: ${error}`);
        return { success: false, message: `Failed to refresh ${type} data.` };
    }
}

/**
 * Handles the /refresh slash command interaction
 * @param interaction - The Discord command interaction
 */
export async function handleRefreshCommand(interaction: ChatInputCommandInteraction) {
    const type = interaction.options.getString('type', true);
    const result = await executeRefresh(type);
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
}
