import { promises as fs } from 'fs';
import { parseStringPromise } from 'xml2js';
import { getLogger } from '../../../utils/logger';
import { parseDate } from '../utils';
import type { ChannelEntry, ProgrammeEntry } from '../../../interfaces/iptv';

const logger = getLogger();

/**
 * Represents the complete parsed content from an XMLTV file
 */
export interface ParsedXMLTV {
    channels: ChannelEntry[];
    programmes: ProgrammeEntry[];
}

/**
 * Extracts complete channel and programme data from an XMLTV file.
 * 
 * @param filePath - Path to the XMLTV file
 * @returns Object containing arrays of channels and programmes
 */
export async function extractXMLTVData(filePath: string): Promise<ParsedXMLTV> {
    const output: ParsedXMLTV = { channels: [], programmes: [] };

    const fileContent = await fs.readFile(filePath, 'utf8');
    logger.debug(`Loaded XMLTV file: ${fileContent.length} bytes`);

    const xmlData = await parseStringPromise(fileContent).catch((err) => {
        logger.error(`XML parsing failed: ${err}`);
        return null;
    });

    if (!xmlData?.tv) {
        logger.error('Invalid XMLTV structure detected');
        return output;
    }

    // Process channels if available
    const channelList = xmlData.tv.channel || [];
    if (channelList.length > 0) {
        logger.info(`Processing ${channelList.length} channel entries`);

        channelList.forEach((channelNode: any) => {
            try {
                output.channels.push(extractChannelData(channelNode));
            } catch (err) {
                const channelId = channelNode.$?.id || 'unknown';
                logger.error(`Channel extraction failed for "${channelId}": ${err}`);
            }
        });
    }

    // Build channel name map for title cleanup
    const channelNameMap = new Map<string, string>();
    output.channels.forEach(ch => {
        if (ch.tvg_id && ch.tvg_name) {
            channelNameMap.set(ch.tvg_id, ch.tvg_name);
        }
    });

    // Process programmes if available
    const programmeList = xmlData.tv.programme || [];
    if (programmeList.length > 0) {
        logger.info(`Processing ${programmeList.length} programme entries`);

        programmeList.forEach((programmeNode: any) => {
            try {
                output.programmes.push(buildProgrammeEntry(programmeNode, channelNameMap));
            } catch (err) {
                const programmeTitle = extractTextContent(programmeNode['title']?.[0]) || 'unknown';
                logger.error(`Programme extraction failed for "${programmeTitle}": ${err}`);
            }
        });

        if (output.programmes.length > 0) {
            logProgrammeStatistics(output.programmes);
        }
    }

    // Trigger memory cleanup for large data processing
    if (typeof global.gc === 'function') {
        global.gc();
    }

    return output;
}

/**
 * Extracts and structures channel data from raw XMLTV channel element.
 * 
 * @param channel - Raw channel data from XMLTV
 * @returns Structured channel entry
 */
function extractChannelData(channel: any): ChannelEntry {
    const channelId = channel.$.id;
    let channelName = '';
    let channelNum = '';

    // Extract channel name and number from display-name elements
    if (channel['display-name'] && Array.isArray(channel['display-name'])) {
        for (const nameElement of channel['display-name']) {
            const displayName = extractTextContent(nameElement);

            // Identify numeric-only display names as channel numbers
            if (/^\d+$/.test(displayName) && !channelNum) {
                channelNum = displayName;
            }
            // Use first non-numeric display name as primary channel name
            // This prevents "1 One Piece" format from being used when "One Piece" is available
            else if (!channelName || /^\d+\s/.test(channelName)) {
                channelName = displayName;
            }
        }
    }

    // Extract icon URL from channel metadata
    const iconUrl = channel['icon']?.[0]?.$?.src || '';

    logger.debug(`Extracted channel: ${channelId} -> ${channelName}`);

    return {
        xui_id: parseInt(channelNum) || 0,
        tvg_id: channelId,
        tvg_name: channelName,
        tvg_logo: iconUrl,
        group_title: '',
        url: '',
        created_at: new Date().toISOString(),
    };
}

/**
 * Builds a structured programme entry from raw XMLTV programme data.
 * 
 * @param programme - Raw programme data from XMLTV
 * @param channelNameMap - Map of channel IDs to names for title cleanup
 * @returns Structured programme entry
 * @throws Error if programme is missing required fields
 */
function buildProgrammeEntry(programme: any, channelNameMap: Map<string, string>): ProgrammeEntry {
    // Extract text content fields
    let title = extractTextContent(programme['title']?.[0]);

    // Strip duplicate channel name prefix if present (e.g., "One Piece: One Piece: The Movie" -> "One Piece: The Movie")
    const channelId = programme.$.channel;
    const channelName = channelNameMap.get(channelId);
    if (channelName && title.startsWith(`${channelName}: `)) {
        title = title.substring(channelName.length + 2);
    }
    const description = extractTextContent(programme['desc']?.[0]);
    const category = extractTextContent(programme['category']?.[0]);
    const subtitle = extractTextContent(programme['sub-title']?.[0]);
    const airDate = extractTextContent(programme['date']?.[0]);
    const image = extractTextContent(programme['image']?.[0]);

    // Extract structured data
    const episodeInfo = extractEpisodeInfo(programme['episode-num']);
    const icon = programme['icon']?.[0]?.$?.src || '';
    const isRerun = programme['previously-shown'] !== undefined;

    // Extract timing information
    const startStr = programme.$.start;
    const stopStr = programme.$.stop;

    if (!startStr || !stopStr) {
        throw new Error(`Programme missing required start/stop times: ${title}`);
    }

    logger.debug(`Building programme entry "${title}" [${startStr} - ${stopStr}]`);

    const start = parseDate(startStr);
    const stop = parseDate(stopStr);

    if (start.getTime() === stop.getTime()) {
        logger.warn(`Programme "${title}" has identical start and stop times: ${startStr}`);
    }

    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        start_timestamp: Math.floor(start.getTime() / 1000),
        stop_timestamp: Math.floor(stop.getTime() / 1000),
        channel: programme.$.channel,
        title,
        description,
        category,
        subtitle,
        episode_num: episodeInfo.episodeNum,
        season: episodeInfo.season,
        episode: episodeInfo.episode,
        icon,
        image,
        date: airDate,
        previously_shown: isRerun,
        created_at: new Date().toISOString(),
    };
}

/**
 * Extracts text content from an XMLTV element.
 * Handles both string values and structured objects with underscore property.
 * 
 * @param element - XML element that may contain text
 * @returns Extracted text or empty string if not found
 */
function extractTextContent(element: any): string {
    if (!element) {
        return '';
    }

    if (typeof element === 'string') {
        return element;
    } else if (element._) {
        return element._;
    }

    return '';
}

/**
 * Extracts episode information from XMLTV episode-num elements.
 * Handles xmltv_ns format (season.episode.part) with 0-based to 1-based conversion.
 * 
 * @param episodeElements - Array of episode-num elements
 * @returns Object with episode number string and optional season/episode numbers
 */
function extractEpisodeInfo(episodeElements: any[]): {
    episodeNum: string;
    season: number | undefined;
    episode: number | undefined;
} {
    let episodeNum = '';
    let season: number | undefined;
    let episode: number | undefined;

    if (episodeElements && Array.isArray(episodeElements)) {
        for (const element of episodeElements) {
            const system = element.$?.system;
            const rawValue = extractTextContent(element);

            if (rawValue) {
                episodeNum = rawValue;

                // Process xmltv_ns format: "season.episode.part"
                if (system === 'xmltv_ns') {
                    const segments = rawValue.split('.');
                    if (segments.length >= 2 && segments[0] && segments[1]) {
                        const seasonIndex = parseInt(segments[0]);
                        const episodeIndex = parseInt(segments[1]);

                        // Convert from 0-based to 1-based indexing
                        if (!isNaN(seasonIndex)) season = seasonIndex + 1;
                        if (!isNaN(episodeIndex)) episode = episodeIndex + 1;
                    }
                }
            }
        }
    }

    return { episodeNum, season, episode };
}

/**
 * Logs statistics about the parsed programme data.
 * Includes total count, channel count, and date range.
 * 
 * @param programmes - Array of programme entries
 */
function logProgrammeStatistics(programmes: ProgrammeEntry[]): void {
    // Add summary statistics
    const channels = new Set(programmes.map(p => p.channel)).size;
    logger.info(`Parsed ${programmes.length} programmes across ${channels} channels from XMLTV file`);

    // Check for date range in the data
    if (programmes.length > 0) {
        const dates = programmes.map(p => new Date(p.start));
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
        logger.info(`Programme date range: ${minDate.toISOString()} to ${maxDate.toISOString()}`);
    }
}
