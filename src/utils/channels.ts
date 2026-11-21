import type { ChannelEntry } from '../interfaces/iptv';

/**
 * Sanitizes a channel name so it can be safely embedded in a Discord
 * component custom ID. Discord limits custom IDs to 100 characters, and
 * arbitrary characters are not allowed.
 *
 * Sanitization is intentionally lossy; use {@link findChannelBySanitizedId}
 * to resolve an ID back to a channel.
 *
 * @param name - Channel name to sanitize
 * @returns A safe custom ID fragment of at most 80 characters
 */
export function sanitizeChannelId(name: string): string {
    return name.replace(/[^\w-]/g, '_').slice(0, 80);
}

/**
 * Finds a channel whose name sanitizes to the provided custom ID value.
 *
 * @param channels - Channels to search
 * @param sanitizedId - The custom ID fragment produced by {@link sanitizeChannelId}
 * @returns The matching channel, or undefined if none matches
 */
export function findChannelBySanitizedId(channels: ChannelEntry[], sanitizedId: string): ChannelEntry | undefined {
    return channels.find(channel =>
        channel.tvg_name !== undefined && sanitizeChannelId(channel.tvg_name) === sanitizedId
    );
}

/**
 * Formats a channel label as "Channel | Category" within Discord's
 * 100-character limit, shortening the channel name first so the category stays
 * readable. Same-named channels from different categories remain distinct.
 *
 * @param name - Channel name
 * @param category - Optional category or group title
 * @returns Label safe for a Discord option or button
 */
export function formatChannelLabel(name: string, category?: string | null): string {
    const group = category?.trim();
    if (!group) return name.slice(0, 100);
    const suffix = ` | ${group}`.slice(0, 50);
    const room = Math.max(1, 100 - suffix.length);
    const shown = name.length > room ? `${name.slice(0, room - 1)}…` : name;
    return `${shown}${suffix}`;
}
