import { getLogger } from '../../utils/logger';

const logger = getLogger();

/**
 * Parses a date string in the XMLTV format.
 * Format: YYYYMMDDHHMMSS with an optional +/-HHMM offset.
 *
 * @param dateString - XMLTV date string
 * @returns Parsed date in UTC
 * @throws Error when the string is too short
 */
export function parseDate(dateString: string): Date {
    const parts = dateString.split(' ');
    const timestamp = parts[0];
    const offsetPart = parts[1];

    if (!timestamp || timestamp.length < 14) {
        throw new Error(`Invalid date string format: ${dateString}`);
    }

    const year = parseInt(timestamp.slice(0, 4));
    const month = parseInt(timestamp.slice(4, 6)) - 1;
    const day = parseInt(timestamp.slice(6, 8));
    const hour = parseInt(timestamp.slice(8, 10));
    const minute = parseInt(timestamp.slice(10, 12));
    const second = parseInt(timestamp.slice(12, 14));

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
 * Logs a one-line summary of parsed programme data.
 *
 * @param count - Number of programmes
 * @param channelCount - Number of distinct channels
 */
export function logProgrammeSummary(count: number, channelCount: number): void {
    logger.info(`Parsed ${count} programmes across ${channelCount} channels`);
}
