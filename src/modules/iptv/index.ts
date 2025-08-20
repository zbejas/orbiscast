import { promises as fs } from 'fs';
import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { clearCache, getCachedFile, getCachedFilePath } from '../../utils/cache';
import { clearChannels, addChannels, clearProgrammes, addProgrammes } from '../database';
import { fetchWithRetry } from './downloaders';
import { fromPlaylistLine } from './parsers/playlist-parser';
import { parseXMLTV } from './parsers/xmltv-parser';
import { isProgrammeDataStale } from './utils';
import { scheduleIPTVRefresh } from './schedulers';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();

/**
 * Downloads IPTV data, caches it, and fills the database with channels and programmes.
 * Should only be called at startup to initialize data and scheduling.
 * 
 * @param {boolean} force - Whether to force download even if cache exists
 * @returns {Promise<void>}
 */
export async function downloadCacheAndFillDb(force = false): Promise<void> {
    logger.debug('Cache download started and parsing with force: ' + force);
    await fillDbChannels(force);
    await fillDbProgrammes(force);
    logger.debug('Finished parsing');
    await clearCache();

    // Only schedule refresh if this is initial startup, not a scheduled refresh
    if (!force) {
        scheduleIPTVRefresh();
    }
}

/**
 * Clears and fills the channels database with data from the playlist file.
 * 
 * @param {boolean} force - Whether to force download even if cache exists
 * @returns {Promise<void>}
 */
export async function fillDbChannels(force = true): Promise<void> {
    logger.debug('Starting to fill the channels database');

    await clearChannels();
    logger.info('Fetching playlist...');

    let playlistContent = null;
    try {
        playlistContent = await getCachedFile('playlist.m3u');
        if (playlistContent) {
            logger.debug(`Retrieved cached playlist, size: ${playlistContent.length} bytes`);
        }
    } catch (error) {
        logger.warn(`Error retrieving cached playlist: ${error}`);
    }

    if (!playlistContent || force) {
        logger.info(`${force ? 'Force flag set, downloading' : 'No cached content available'}, fetching from source...`);
        try {
            playlistContent = await fetchWithRetry(config.PLAYLIST, 'playlist.m3u');
            if (playlistContent) {
                logger.debug(`Successfully downloaded playlist, size: ${playlistContent.length} bytes`);
            } else {
                logger.error('Failed to download playlist: empty response');
            }
        } catch (error) {
            logger.error(`Error downloading playlist: ${error}`);
        }
    }

    if (playlistContent) {
        logger.info('Adding channels to database...');
        const channels: ChannelEntry[] = [];
        let channel: ChannelEntry | null = null;
        for (const line of playlistContent.toString().split('\n')) {
            if (line.startsWith('#EXTINF:')) {
                channel = fromPlaylistLine(line);
            } else if (channel && !line.startsWith('#') && line.trim()) {
                channel.url = line.trim();
                channel.created_at = new Date().toISOString();
                channels.push(channel);
                channel = null;
            }
        }
        await addChannels(channels);
    } else {
        logger.error('Failed to fetch playlist content from both cache and source');
    }
}

/**
 * Clears and fills the programme database with data from the XMLTV file.
 * Only refreshes if data is stale or forced.
 * 
 * @param {boolean} force - Whether to force download even if cache exists
 * @returns {Promise<void>}
 */
export async function fillDbProgrammes(force = false): Promise<void> {
    logger.debug('Starting to fill the programmes database');

    const isStale = await isProgrammeDataStale();

    if (isStale || force) {
        await clearProgrammes();
        logger.info('Fetching XMLTV...');

        let xmltvContent = await getCachedFile('xmltv.xml');
        if (!xmltvContent || force) {
            xmltvContent = await fetchWithRetry(config.XMLTV, 'xmltv.xml');
        }

        if (xmltvContent) {
            logger.info('Adding programmes to database...');
            const xmltvPath = await getCachedFilePath('xmltv.xml');
            if (xmltvPath) {
                await fs.writeFile(xmltvPath, xmltvContent);
                const programmes = await parseXMLTV(xmltvPath);
                await addProgrammes(programmes);
            } else {
                logger.error('XMLTV path is null. Cannot read file.');
            }
        } else {
            logger.error('No XMLTV content available. Cannot process.');
        }
    } else {
        logger.info('TV Schedule up to date');
    }
}

export { scheduleIPTVRefresh, stopIPTVRefresh } from './schedulers';
