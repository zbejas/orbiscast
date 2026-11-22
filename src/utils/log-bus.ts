import { EventEmitter } from 'node:events';
import type { LogLineDto } from '../shared/types';

const MAX_ENTRIES = 2000;
const entries: LogLineDto[] = [];
const events = new EventEmitter();
events.setMaxListeners(50);

let nextId = 1;

/**
 * Adds a log line to the in-memory ring buffer and notifies subscribers.
 *
 * @param level - Winston level name
 * @param message - Rendered message
 */
export function pushLog(level: string, message: string): void {
    const entry: LogLineDto = {
        id: nextId++,
        timestamp: Date.now(),
        level,
        message,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }
    events.emit('log', entry);
}

/**
 * Returns buffered log lines, newest last.
 *
 * @param options - Optional level, search, and limit filters
 * @returns Filtered log lines
 */
export function getLogs(options: { level?: string; q?: string; limit?: number } = {}): LogLineDto[] {
    const limit = Math.min(2000, Math.max(1, options.limit ?? 500));
    const search = options.q?.toLowerCase();
    const filtered = entries.filter(entry => {
        if (options.level && entry.level !== options.level) {
            return false;
        }
        if (search && !entry.message.toLowerCase().includes(search)) {
            return false;
        }
        return true;
    });
    return filtered.slice(-limit);
}

/**
 * Subscribes to new log lines.
 *
 * @param listener - Called for every new line
 * @returns Unsubscribe function
 */
export function subscribeLogs(listener: (entry: LogLineDto) => void): () => void {
    events.on('log', listener);
    return () => events.off('log', listener);
}
