import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { Db } from '../database/client';
import { channels, iptvSources } from '../database/schema';
import {
    getSource,
    listSources,
    pruneProgrammes,
    replaceSourceChannels,
    replaceSourceProgrammes,
    setSourceRefreshResult,
    type ChannelInput,
    type ProgrammeInput,
} from '../database/repo';
import type { SettingsService } from '../settings';
import { fetchWithRetry } from './downloaders';
import { fromPlaylistLine } from './parsers/playlist-parser';
import { extractXMLTVData } from './parsers/xmltv-parser';
import { getCacheDir } from '../../utils/cache';
import { getLogger } from '../../utils/logger';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();
const PROGRAMME_RETENTION_DAYS = 7;

/**
 * Owns IPTV source downloads, parsing, database sync, and refresh timers.
 */
export class IptvService {
    private readonly timers = new Map<number, NodeJS.Timeout>();
    private readonly refreshing = new Set<number>();
    private stopped = false;

    constructor(
        private readonly db: Db,
        private readonly settings: SettingsService,
        private readonly events: EventEmitter
    ) {}

    /**
     * Schedules every enabled source and refreshes stale sources in the
     * background. It never blocks startup on a large playlist.
     */
    start(): void {
        this.stopped = false;
        for (const source of listSources(this.db)) {
            if (!source.enabled) continue;
            this.schedule(source.id);
            if (this.needsRefresh(source.id)) {
                void this.refreshSource(source.id);
            }
        }
    }

    /**
     * Stops every refresh timer.
     */
    stop(): void {
        this.stopped = true;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    /**
     * Returns true while a source is refreshing.
     *
     * @param sourceId - Source id
     */
    isRefreshing(sourceId: number): boolean {
        return this.refreshing.has(sourceId);
    }

    /**
     * Refreshes every enabled source.
     *
     * @returns Number of sources attempted
     */
    async refreshAll(force = false): Promise<number> {
        const sources = listSources(this.db).filter(source => source.enabled);
        for (const source of sources) {
            await this.refreshSource(source.id, force);
        }
        return sources.length;
    }

    /**
     * Refreshes one source. Concurrent requests for the same source are
     * coalesced.
     *
     * @param sourceId - Source id
     * @returns True when the source refreshed successfully
     */
    async refreshSource(sourceId: number, force = false): Promise<boolean> {
        if (this.refreshing.has(sourceId)) {
            logger.debug(`Source ${sourceId} is already refreshing`);
            return false;
        }

        const source = getSource(this.db, sourceId);
        if (!source) {
            logger.warn(`Source ${sourceId} no longer exists`);
            return false;
        }

        this.refreshing.add(sourceId);
        this.events.emit('source:refreshing', { sourceId, refreshing: true });

        try {
            await this.syncSource(sourceId, source.playlistUrl, source.xmltvUrl, force);
            setSourceRefreshResult(this.db, sourceId, null);
            logger.info(`Refreshed source "${source.name}"`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSourceRefreshResult(this.db, sourceId, message);
            logger.error(`Source "${source.name}" refresh failed: ${message}`);
            return false;
        } finally {
            this.refreshing.delete(sourceId);
            this.events.emit('source:refreshing', { sourceId, refreshing: false });
            this.events.emit('sources', listSources(this.db));
        }
    }

    /**
     * Reschedules one source after a settings change.
     *
     * @param sourceId - Source id
     */
    reschedule(sourceId: number): void {
        const existing = this.timers.get(sourceId);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(sourceId);
        }
        this.schedule(sourceId);
    }

    /**
     * Removes a source timer.
     *
     * @param sourceId - Source id
     */
    removeSource(sourceId: number): void {
        const existing = this.timers.get(sourceId);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(sourceId);
        }
    }

    private schedule(sourceId: number): void {
        if (this.stopped) return;
        const source = getSource(this.db, sourceId);
        if (!source || !source.enabled) return;

        const intervalMs = Math.max(1, source.refreshMinutes) * 60_000;
        const timer = setTimeout(async () => {
            await this.refreshSource(sourceId);
            this.schedule(sourceId);
        }, intervalMs);
        timer.unref();
        this.timers.set(sourceId, timer);
    }

    private needsRefresh(sourceId: number): boolean {
        const source = getSource(this.db, sourceId);
        if (!source) return false;
        if (!source.lastRefreshedAt) return true;
        const age = Date.now() - source.lastRefreshedAt;
        if (age >= Math.max(1, source.refreshMinutes) * 60_000) return true;
        const count = this.db
            .select({ count: sql<number>`count(*)` })
            .from(channels)
            .where(eq(channels.sourceId, sourceId))
            .get();
        return (count?.count ?? 0) === 0;
    }

    private async syncSource(
        sourceId: number,
        playlistUrl: string,
        xmltvUrl: string | null,
        force: boolean
    ): Promise<void> {
        const cachePrefix = `source-${sourceId}`;
        const playlist = await fetchWithRetry(playlistUrl, `${cachePrefix}/playlist.m3u`);
        if (!playlist) {
            throw new Error('Playlist download failed');
        }

        const playlistChannels = parsePlaylist(playlist.toString('utf8'));
        if (playlistChannels.length === 0) {
            throw new Error('Playlist contained no channels');
        }

        let xmltvMeta: Map<string, ChannelEntry> | null = null;
        let programmes: ProgrammeInput[] = [];

        if (xmltvUrl) {
            const xmltv = await fetchWithRetry(xmltvUrl, `${cachePrefix}/xmltv.xml`);
            if (xmltv) {
                const cachePath = join(getCacheDir(), cachePrefix, 'xmltv.xml');
                await fs.mkdir(join(getCacheDir(), cachePrefix), { recursive: true });
                await fs.writeFile(cachePath, xmltv);
                const parsed = await extractXMLTVData(cachePath);
                xmltvMeta = buildChannelMeta(parsed.channels);
                programmes = parsed.programmes.map(programme => ({
                    channelTvgId: programme.channel,
                    start: programme.start,
                    stop: programme.stop,
                    startTimestamp: programme.start_timestamp,
                    stopTimestamp: programme.stop_timestamp,
                    title: programme.title,
                    description: programme.description,
                    category: programme.category,
                    subtitle: programme.subtitle,
                    episodeNum: programme.episode_num,
                    season: programme.season ?? null,
                    episode: programme.episode ?? null,
                    icon: programme.icon ?? null,
                    image: programme.image ?? null,
                    date: programme.date ?? null,
                    previouslyShown: programme.previously_shown ?? null,
                }));
            } else {
                logger.warn(`Guide download failed for source ${sourceId}; keeping the existing guide`);
            }
        }

        const input = toChannelInput(playlistChannels, xmltvMeta);
        const channelResult = replaceSourceChannels(this.db, sourceId, input);
        logger.info(
            `Source ${sourceId}: ${channelResult.seen} channels seen, ${channelResult.removed} removed`
        );

        if (xmltvUrl && programmes.length > 0) {
            const inserted = replaceSourceProgrammes(this.db, sourceId, programmes);
            logger.info(`Source ${sourceId}: ${inserted} programmes stored`);
            pruneProgrammes(this.db, Math.floor(Date.now() / 1000) - PROGRAMME_RETENTION_DAYS * 86400);
        }

        if (force) {
            logger.debug(`Forced refresh for source ${sourceId}`);
        }
    }
}

/**
 * Parses an M3U playlist into channel entries.
 *
 * @param content - Playlist text
 * @returns Channels with stream URLs
 */
export function parsePlaylist(content: string): ChannelEntry[] {
    const result: ChannelEntry[] = [];
    let current: ChannelEntry | null = null;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
            current = fromPlaylistLine(line);
            continue;
        }
        if (line.startsWith('#')) {
            continue;
        }
        if (current) {
            current.url = line;
            current.created_at = new Date().toISOString();
            result.push(current);
            current = null;
        }
    }

    return result;
}

function buildChannelMeta(input: ChannelEntry[]): Map<string, ChannelEntry> {
    const map = new Map<string, ChannelEntry>();
    for (const channel of input) {
        if (channel.tvg_id) map.set(`id:${channel.tvg_id}`, channel);
        if (channel.tvg_name) map.set(`name:${channel.tvg_name.toLowerCase()}`, channel);
    }
    return map;
}

function toChannelInput(input: ChannelEntry[], meta: Map<string, ChannelEntry> | null): ChannelInput[] {
    const seen = new Set<string>();
    const result: ChannelInput[] = [];

    input.forEach((channel, index) => {
        const name = channel.tvg_name?.trim() || channel.tvg_id?.trim() || `Channel ${index + 1}`;
        const baseKey = channel.tvg_id?.trim() || name.toLowerCase();
        let stableKey = baseKey || `channel-${index + 1}`;
        if (seen.has(stableKey)) {
            stableKey = `${stableKey}-${index + 1}`;
        }
        seen.add(stableKey);

        const metaChannel =
            (channel.tvg_id ? meta?.get(`id:${channel.tvg_id}`) : undefined) ??
            meta?.get(`name:${name.toLowerCase()}`);

        result.push({
            stableKey,
            tvgId: channel.tvg_id || null,
            name,
            logo: channel.tvg_logo || metaChannel?.tvg_logo || null,
            groupTitle: channel.group_title || metaChannel?.group_title || null,
            streamUrl: channel.url,
            country: channel.country || null,
        });
    });

    return result;
}
