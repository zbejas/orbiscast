import { promises as fs } from 'fs';
import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { clearCache, getCachedFile, getCachedFilePath } from '../../utils/cache';
import { clearChannels, addChannels, clearProgrammes, addProgrammes, getChannelEntries } from '../database';
import { fetchWithRetry } from './downloaders';
import { fromPlaylistLine } from './parsers/playlist-parser';
import { extractXMLTVData } from './parsers/xmltv-parser';
import { isProgrammeDataStale } from './utils';
import { scheduleIPTVRefresh } from './schedulers';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();

/**
 * Downloads IPTV data, caches it, and populates the database with channels and programmes.
 * This is the main entry point for IPTV data initialization.
 * 
 * @param force - Whether to force download even if cache exists
 */
export async function downloadCacheAndFillDb(force = false): Promise<void> {
    logger.debug(`Initiating IPTV data download and database population (force: ${force})`);

    // Try XMLTV first for comprehensive data
    if (config.XMLTV) {
        await populateDatabaseFromXMLTV(force);

        // Sync with playlist if available to get stream URLs
        if (config.PLAYLIST) {
            await syncPlaylistChannels(force);
        }
    } else if (config.PLAYLIST) {
        // Fallback to playlist-only mode
        await syncPlaylistChannels(force);
    }

    logger.debug('Database population completed');
    await clearCache();

    // Schedule automatic refresh for subsequent updates
    if (!force) {
        scheduleIPTVRefresh();
    }
}

/**
 * Populates the database with channels and programmes extracted from XMLTV source.
 * 
 * @param force - Force download even if cache exists
 */
export async function populateDatabaseFromXMLTV(force = false): Promise<void> {
    logger.debug('Initiating database population from XMLTV source');

    const isStale = await isProgrammeDataStale();

    if (!isStale && !force) {
        logger.info('TV Schedule and channels are up to date');
        return;
    }

    logger.info('Fetching XMLTV...');
    let xmltvContent: Buffer | null = await getCachedFile('xmltv.xml');

    if (!xmltvContent || force) {
        xmltvContent = await fetchWithRetry(config.XMLTV, 'xmltv.xml');
        if (!xmltvContent) {
            logger.error('Failed to fetch XMLTV content');
            return;
        }
    }

    const xmltvPath = await getCachedFilePath('xmltv.xml');
    if (!xmltvPath) {
        logger.error('Failed to get XMLTV cache path');
        return;
    }

    await fs.writeFile(xmltvPath, xmltvContent);
    xmltvContent = null; // Release buffer from memory

    const parsedData = await extractXMLTVData(xmltvPath);

    // Add channels from XMLTV if available
    if (parsedData.channels.length > 0) {
        await clearChannels();
        await addChannels(parsedData.channels);
        logger.info(`Added ${parsedData.channels.length} channels from XMLTV`);

        // Log channel IDs for debugging
        const channelIds = parsedData.channels.map(ch => ch.tvg_id).join(', ');
        logger.debug(`XMLTV channel IDs: [${channelIds}]`);
    }

    // Add programmes from XMLTV if available
    if (parsedData.programmes.length > 0) {
        // Validate that programmes reference known channels
        const channelIds = new Set(parsedData.channels.map(ch => ch.tvg_id));
        const programmeChannels = new Set(parsedData.programmes.map(p => p.channel));
        const unmatchedChannels = Array.from(programmeChannels).filter(id => !channelIds.has(id));

        if (unmatchedChannels.length > 0) {
            logger.warn(`Found programmes for channels not in XMLTV channel list: [${unmatchedChannels.join(', ')}]`);
        }

        await clearProgrammes();
        await addProgrammes(parsedData.programmes);

        // Log programme distribution per channel
        const progsByChannel = parsedData.programmes.reduce((acc, p) => {
            acc[p.channel] = (acc[p.channel] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        logger.info(`Added programmes per channel: ${JSON.stringify(progsByChannel)}`);
    }

    // Release parsed data references
    parsedData.channels.length = 0;
    parsedData.programmes.length = 0;
}

/**
 * Synchronizes playlist channels with database, merging with existing XMLTV data.
 * 
 * @param force - Force download even if cache exists
 */
export async function syncPlaylistChannels(force = false): Promise<void> {
    logger.debug('Initiating playlist channel synchronization');
    logger.info('Retrieving playlist data...');

    let playlistContent: Buffer | null = null;

    try {
        playlistContent = await getCachedFile('playlist.m3u');
        if (playlistContent) {
            logger.debug(`Loaded cached playlist: ${playlistContent.length} bytes`);
        }
    } catch (error) {
        logger.warn(`Cache retrieval failed: ${error}`);
    }

    if (!playlistContent || force) {
        const reason = force ? 'Force refresh requested' : 'No cached data available';
        logger.info(`${reason}, fetching playlist from remote source...`);

        try {
            playlistContent = await fetchWithRetry(config.PLAYLIST, 'playlist.m3u');
            if (playlistContent) {
                logger.debug(`Successfully downloaded playlist, size: ${playlistContent.length} bytes`);
            } else {
                logger.warn('No playlist content received');
                return;
            }
        } catch (error) {
            logger.error(`Error downloading playlist: ${error}`);
            return;
        }
    }

    if (!playlistContent) {
        return;
    }

    // Extract channels from playlist
    const playlistChannels: ChannelEntry[] = [];
    let currentChannel: ChannelEntry | null = null;

    // Process playlist line by line, releasing buffer
    const lines = playlistContent.toString().split('\n');
    playlistContent = null;

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            currentChannel = fromPlaylistLine(line);
        } else if (currentChannel && !line.startsWith('#') && line.trim()) {
            currentChannel.url = line.trim();
            currentChannel.created_at = new Date().toISOString();
            playlistChannels.push(currentChannel);
            currentChannel = null;
        }
    }

    logger.info(`Extracted ${playlistChannels.length} channels from playlist`);

    // Log playlist channel IDs for debugging
    const playlistIds = playlistChannels.map(ch => `${ch.tvg_name}(${ch.tvg_id})`).join(', ');
    logger.debug(`Playlist channel IDs: [${playlistIds}]`);

    // Retrieve and merge with existing database channels
    const existingChannels = await getChannelEntries();
    const channelMap = new Map(existingChannels.map(ch => [ch.tvg_id, ch]));

    logger.debug(`Located ${existingChannels.length} existing channels in database`);

    // Integrate playlist channels with existing data
    for (const playlistCh of playlistChannels) {
        const existingCh = playlistCh.tvg_id ? channelMap.get(playlistCh.tvg_id) : null;
        if (existingCh) {
            // Update existing channel with playlist URL
            existingCh.url = playlistCh.url;
            if (playlistCh.group_title) existingCh.group_title = playlistCh.group_title;
            if (playlistCh.tvg_logo) existingCh.tvg_logo = playlistCh.tvg_logo;
        } else {
            // Add new channel from playlist
            const channelKey = playlistCh.tvg_id || `playlist_${playlistChannels.indexOf(playlistCh)}`;
            channelMap.set(channelKey, playlistCh);
        }
    }

    // Persist merged channels to database
    const mergedChannels = Array.from(channelMap.values());
    if (mergedChannels.length > 0) {
        await clearChannels();
        await addChannels(mergedChannels);
        logger.info(`Synchronized ${mergedChannels.length} channels to database`);

        // Verify final channel list
        const finalChannelIds = mergedChannels.map(ch => `${ch.tvg_name}(${ch.tvg_id})`).join(', ');
        logger.debug(`Final database channels: [${finalChannelIds}]`);
    }
}

export { scheduleIPTVRefresh, stopIPTVRefresh } from './schedulers';
