const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DEFAULT_LOCALE = 'en-US';

function dateOf(value: number | Date): Date {
    return value instanceof Date ? value : new Date(value);
}

export function formatTime(value: number | Date, timeZone?: string): string {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
    }).format(dateOf(value));
}

export function formatClock(value: number | Date, timeZone?: string): string {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone,
    }).format(dateOf(value));
}

export function formatTimeRange(start: number | Date, stop: number | Date, timeZone?: string): string {
    return `${formatTime(start, timeZone)} - ${formatTime(stop, timeZone)}`;
}

export function formatDay(value: number | Date, timeZone?: string): string {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone,
    }).format(dateOf(value));
}

export function formatLongDay(value: number | Date, timeZone?: string): string {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone,
    }).format(dateOf(value));
}

export function formatDate(value: number | Date, timeZone?: string): string {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone,
    }).format(dateOf(value));
}

/** Movie and episode length, for example "1h 52m". */
export function formatDuration(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return 'Unknown';
    const totalMinutes = Math.round(ms / MINUTE);
    if (totalMinutes < 1) return '< 1m';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/** Elapsed clock for playback, for example "1:42:09" or "12:04". */
export function formatElapsed(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '0:00';
    const totalSeconds = Math.floor(ms / SECOND);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatUptime(startedAt: number | null | undefined, now = Date.now()): string {
    if (startedAt == null) return 'Not running';
    return formatElapsed(Math.max(0, now - startedAt));
}

export function formatRelative(value: number | null | undefined, now = Date.now()): string {
    if (value == null || !Number.isFinite(value)) return 'Never';
    const diff = now - value;
    if (diff < -MINUTE) {
        const inMinutes = Math.round(Math.abs(diff) / MINUTE);
        return inMinutes < 60 ? `in ${inMinutes} min` : `in ${Math.round(inMinutes / 60)} hr`;
    }
    if (diff < MINUTE) return 'Just now';
    if (diff < HOUR) {
        const minutes = Math.round(diff / MINUTE);
        return `${minutes} min ago`;
    }
    if (diff < DAY) {
        const hours = Math.round(diff / HOUR);
        return `${hours} hr ago`;
    }
    if (diff < 7 * DAY) {
        const days = Math.round(diff / DAY);
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return formatDate(value);
}

export function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[index]}`;
}

export function formatCount(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '0';
    return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}

export function formatCompactCount(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '0';
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
        notation: value >= 10_000 ? 'compact' : 'standard',
        maximumFractionDigits: 1,
    }).format(value);
}

export function formatAudience(value: number | null | undefined): string {
    const count = value ?? 0;
    return `${formatCount(count)} ${count === 1 ? 'viewer' : 'viewers'}`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
    if (value == null || !Number.isFinite(value)) return '0%';
    return `${(value * 100).toFixed(digits)}%`;
}

export function formatBitrate(kbps: number | null | undefined): string {
    if (kbps == null || !Number.isFinite(kbps)) return 'Auto';
    return `${formatCount(kbps)} kbps`;
}

export function toDateKey(value: number | Date = Date.now()): string {
    const date = dateOf(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function startOfDay(value: number | Date = Date.now()): number {
    const date = dateOf(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export function parseDateKey(key: string): number {
    const [year, month, day] = key.split('-').map(Number);
    if (!year || !month || !day) return startOfDay();
    return new Date(year, month - 1, day).getTime();
}

export function shiftDateKey(key: string, days: number): string {
    const date = new Date(parseDateKey(key));
    date.setDate(date.getDate() + days);
    return toDateKey(date);
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function titleCase(value: string): string {
    return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function initials(value: string): string {
    const words = value
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
