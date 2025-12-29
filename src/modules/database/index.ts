import { promises as fs } from 'fs';
import { join } from 'path';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { getLogger } from '../../utils/logger';
import type { ChannelEntry, ProgrammeEntry } from '../../interfaces/iptv';

const logger = getLogger();
// __dirname is available in CommonJS
const dataDir = join(__dirname, '../../../data');

fs.mkdir(dataDir, { recursive: true }).catch(err => logger.error(`Error creating data directory: ${err}`));

const channelsDb = new Low<{ channels: ChannelEntry[] }>(new JSONFile(join(dataDir, 'channels.db.json')), { channels: [] });
const programmesDb = new Low<{ programmes: ProgrammeEntry[] }>(new JSONFile(join(dataDir, 'programmes.db.json')), { programmes: [] });

/**
 * Retrieves all channel entries from the database
 * @returns Array of channel entries
 */
export async function getChannelEntries(): Promise<ChannelEntry[]> {
    await channelsDb.read();
    return channelsDb.data?.channels || [];
}

/**
 * Retrieves all programme entries from the database
 * @returns Array of programme entries
 */
export async function getProgrammeEntries(): Promise<ProgrammeEntry[]> {
    await programmesDb.read();
    return programmesDb.data?.programmes || [];
}

/**
 * Clears all channel data from the database
 */
export async function clearChannels(): Promise<void> {
    await channelsDb.read();
    channelsDb.data = { channels: [] };
    await channelsDb.write();
    logger.debug('Channels table truncated');
}

/**
 * Adds channel entries to the database, replacing any existing entries
 * @param channels - Array of channel entries to add
 */
export async function addChannels(channels: ChannelEntry[]): Promise<void> {
    await channelsDb.read();
    channelsDb.data.channels = channels;
    await channelsDb.write();
    logger.debug(`Added ${channels.length} channels to database`);
}

/**
 * Clears all programme data from the database
 */
export async function clearProgrammes(): Promise<void> {
    await programmesDb.read();
    programmesDb.data = { programmes: [] };
    await programmesDb.write();
    logger.debug('Programmes table truncated');
}

/**
 * Adds programme entries to the database, replacing any existing entries
 * @param programmes - Array of programme entries to add
 */
export async function addProgrammes(programmes: ProgrammeEntry[]): Promise<void> {
    await programmesDb.read();
    programmesDb.data.programmes = programmes;
    await programmesDb.write();
    logger.debug(`Added ${programmes.length} programmes to database`);
}
