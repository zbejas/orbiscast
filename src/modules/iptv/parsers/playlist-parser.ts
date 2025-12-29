import { getLogger } from '../../../utils/logger';
import type { ChannelEntry } from '../../../interfaces/iptv';

const logger = getLogger();

/**
 * Parses a playlist line to extract channel information.
 * Tries multiple formats to ensure compatibility with different playlist providers.
 * 
 * @param {string} line - A line from the M3U playlist starting with #EXTINF
 * @returns {ChannelEntry | null} - Channel entry or null if parsing fails
 */
export function fromPlaylistLine(line: string): ChannelEntry | null {
    // Try each parsing strategy in sequence
    return parseOriginalFormat(line) ||
        parseAlternativeFormat(line) ||
        parseFlexibleFormat(line);
}

/**
 * Attempts to parse a playlist line using the original format pattern.
 * 
 * @param {string} line - A line from the M3U playlist
 * @returns {ChannelEntry | null} - Channel entry or null if parsing fails
 */
function parseOriginalFormat(line: string): ChannelEntry | null {
    const ORIGINAL_PATTERN = /#EXTINF:.*\s*channelID="(?<xui_id>.*?)"\s*tvg-chno="(?<tvg_chno>.*?)"\s*tvg-name="(?<tvg_name>.*?)"\s*tvg-id="(?<tvg_id>.*?)"\s*tvg-logo="(?<tvg_logo>.*?)"\s*group-title="(?<group_title>.*?)"/;
    const matches = line.match(ORIGINAL_PATTERN);

    if (matches?.groups) {
        const { xui_id, tvg_id, tvg_name, tvg_logo, group_title } = matches.groups;
        const [prefix] = (group_title || '').split(': |');
        return {
            xui_id: parseInt(xui_id || '0'),
            tvg_id,
            tvg_name,
            tvg_logo,
            group_title,
            url: '',
            created_at: undefined,
            country: prefix
        };
    }

    return null;
}

/**
 * Attempts to parse a playlist line using the alternative format pattern.
 * 
 * @param {string} line - A line from the M3U playlist
 * @returns {ChannelEntry | null} - Channel entry or null if parsing fails
 */
function parseAlternativeFormat(line: string): ChannelEntry | null {
    if (!line.startsWith('#EXTINF:')) {
        return null;
    }

    // Extract attributes flexibly without requiring specific order
    const tvgIdMatch = line.match(/tvg-id="([^"]+)"/);
    const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
    const tvgChnoMatch = line.match(/tvg-chno="([^"]+)"/);
    const tvgLogoMatch = line.match(/tvg-logo="([^"]+)"/);
    const groupTitleMatch = line.match(/group-title="([^"]+)"/);

    // Extract channel name from after the last comma if not in tvg-name
    const lastCommaIndex = line.lastIndexOf(',');
    let channelName = '';
    if (lastCommaIndex !== -1) {
        channelName = line.substring(lastCommaIndex + 1).trim();
    }

    const tvg_id = tvgIdMatch ? tvgIdMatch[1] : '';
    const tvg_chno = tvgChnoMatch ? tvgChnoMatch[1] : '';
    const tvg_name = tvgNameMatch ? tvgNameMatch[1] : (channelName || tvg_id);
    const tvg_logo = tvgLogoMatch ? tvgLogoMatch[1] : '';
    const group_title = groupTitleMatch ? groupTitleMatch[1] : '';
    const [prefix] = (group_title || '').split(': |');

    // Only return if we have at least a tvg_id or tvg_name
    if (tvg_id || tvg_name) {
        logger.debug(`Parsed alternative format channel: ${tvg_name}`);

        return {
            xui_id: 0,
            tvg_id,
            tvg_name,
            tvg_logo,
            group_title,
            url: '',
            created_at: undefined,
            country: prefix
        };
    }

    return null;
}

/**
 * Attempts to parse a playlist line using a flexible approach when standard patterns fail.
 * Extracts whatever information is available in the line.
 * 
 * @param {string} line - A line from the M3U playlist
 * @returns {ChannelEntry | null} - Channel entry or null if parsing fails
 */
function parseFlexibleFormat(line: string): ChannelEntry | null {
    if (!line.startsWith('#EXTINF:')) {
        return null;
    }

    logger.debug(`Trying flexible parsing for line: ${line.substring(0, 100)}...`);

    // Extract available attributes
    const tvgIdMatch = line.match(/tvg-id="([^"]+)"/);
    const tvgChnoMatch = line.match(/tvg-chno="([^"]+)"/);
    const tvgLogoMatch = line.match(/tvg-logo="([^"]+)"/);
    const groupTitleMatch = line.match(/group-title="([^"]+)"/);

    // Extract channel name from after the last comma
    const lastCommaIndex = line.lastIndexOf(',');
    let channelName = '';

    if (lastCommaIndex !== -1) {
        channelName = line.substring(lastCommaIndex + 1).trim();
        // Remove quality indicator if present (anything in parentheses at the end)
        channelName = channelName.replace(/\s+\([^)]+\)\s*$/, '');
    }

    const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';
    const tvgName = channelName || tvgId;
    const tvgLogo = tvgLogoMatch ? tvgLogoMatch[1] : '';
    const groupTitle = groupTitleMatch ? groupTitleMatch[1] : '';
    const country = groupTitle ? groupTitle.split(': |')[0] : '';

    if (tvgName) {
        logger.debug(`Flexible parsing found channel: ${tvgName}`);
        return {
            xui_id: 0,
            tvg_id: tvgId,
            tvg_name: tvgName,
            tvg_logo: tvgLogo,
            group_title: groupTitle,
            url: '',
            created_at: undefined,
            country
        };
    }

    return null;
}
