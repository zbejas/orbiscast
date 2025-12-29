import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { getProgrammeEntries } from '../database';

const logger = getLogger();

/**
 * Parses a date string in the XMLTV format.
 * Format: YYYYMMDDHHMMSS with optional timezone offset (+/-HHMM)
 * 
 * @param dateString - Date string in XMLTV format
 * @returns Parsed date object
 * @throws Error if the date string format is invalid
 */
export function parseDate(dateString: string): Date {
    // Split by space to separate timestamp from timezone offset
    const parts = dateString.split(' ');

    // Extract the timestamp and offset
    const timestamp = parts[0];
    const offsetPart = parts[1];

    if (!timestamp || timestamp.length < 14) {
        throw new Error(`Invalid date string format: ${dateString}`);
    }

    // Extract date parts from the timestamp
    const year = parseInt(timestamp.slice(0, 4));
    const month = parseInt(timestamp.slice(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(timestamp.slice(6, 8));

    // Extract time parts from the timestamp
    const hour = parseInt(timestamp.slice(8, 10));
    const minute = parseInt(timestamp.slice(10, 12));
    const second = parseInt(timestamp.slice(12, 14));

    // Handle timezone offset
    let offset = 0;
    if (offsetPart) {
        const offsetSign = offsetPart[0] === '+' ? 1 : -1;
        const offsetHour = parseInt(offsetPart.slice(1, 3) || '0');
        const offsetMinute = parseInt(offsetPart.slice(3, 5) || '0');
        offset = offsetSign * (offsetHour * 60 + offsetMinute) * 60000;
    }

    const date = new Date(Date.UTC(year, month, day, hour, minute, second));
    return new Date(date.getTime() - offset);
}

/**
 * Checks if the programme data in the database is stale and needs refreshing.
 * Considers both the age of the data and whether it contains any future programmes.
 * 
 * @returns True if data is stale, missing, or all programmes are in the past
 */
export async function isProgrammeDataStale(): Promise<boolean> {
    const programmes = await getProgrammeEntries();

    // No programmes means data is stale
    if (!programmes || programmes.length === 0) {
        logger.debug('No programmes in database, data is stale');
        return true;
    }

    const createdAt = programmes[0]?.created_at;

    // Check if data was fetched too long ago
    if (!createdAt || isOlderThanSetRefreshTime(createdAt)) {
        logger.debug('Programme data is older than refresh interval');
        return true;
    }

    // Check if all programmes are in the past (data is outdated even if recently fetched)
    const now = Math.floor(Date.now() / 1000);
    const hasFutureProgrammes = programmes.some(p =>
        typeof p.stop_timestamp === 'number' && p.stop_timestamp >= now
    );

    if (!hasFutureProgrammes) {
        logger.warn('All programme data is in the past, forcing refresh');
        return true;
    }

    return false;
}

/**
 * Checks if a date is older than the configured refresh time.
 * Includes a 3-minute grace period to prevent premature refreshes.
 * 
 * @param dateString - ISO date string to check
 * @returns True if the date is older than the refresh interval
 */
export function isOlderThanSetRefreshTime(dateString: string): boolean {
    const date = new Date(dateString);
    const refreshTime = Math.max(config.REFRESH_IPTV * 60 * 1000 - 3 * 60 * 1000, 0);
    return (Date.now() - date.getTime()) > refreshTime;
}
