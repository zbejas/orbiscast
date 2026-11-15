import { and, asc, eq, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { channels, discordGuildSettings, iptvSources, plexLibraries, plexQueueItems, programmes } from './schema';
import type {
    ChannelDto,
    PlexLibraryDto,
    PlexQuality,
    QueueItemDto,
    QueueStatus,
    SourceDto,
} from '../../shared/types';

export interface ChannelInput {
    stableKey: string;
    tvgId?: string | null;
    name: string;
    logo?: string | null;
    groupTitle?: string | null;
    streamUrl: string;
    country?: string | null;
}

export interface ProgrammeInput {
    channelTvgId: string;
    start: string;
    stop: string;
    startTimestamp: number;
    stopTimestamp: number;
    title: string;
    description?: string;
    category?: string;
    subtitle?: string | null;
    episodeNum?: string | null;
    season?: number | null;
    episode?: number | null;
    icon?: string | null;
    image?: string | null;
    date?: string | null;
    previouslyShown?: boolean | null;
}

export interface SourceInput {
    name: string;
    playlistUrl: string;
    xmltvUrl?: string | null;
    enabled?: boolean;
    refreshMinutes?: number;
}

export interface ChannelQuery {
    sourceId?: number;
    group?: string;
    q?: string;
    search?: string;
    visible?: boolean;
    visibility?: 'all' | 'visible' | 'hidden';
    page?: number;
    pageSize?: number;
}

export interface ProgrammeQuery {
    start: number;
    end: number;
    channelTvgIds?: string[];
    sourceId?: number;
}

export interface GuildSettingsRecord {
    guildId: string;
    allowedRoleIds: string[];
    enabled: boolean;
}

export interface QueueInput {
    ratingKey: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle?: string | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    durationMs?: number | null;
    thumbUrl?: string | null;
    quality: PlexQuality;
    subtitleMode: string;
}

/**
 * Lists sources with channel totals.
 *
 * @param db - Drizzle client
 * @returns Source rows ready for the API
 */
export function listSources(db: Db): SourceDto[] {
    const rows = db
        .select({
            id: iptvSources.id,
            name: iptvSources.name,
            playlistUrl: iptvSources.playlistUrl,
            xmltvUrl: iptvSources.xmltvUrl,
            enabled: iptvSources.enabled,
            refreshMinutes: iptvSources.refreshMinutes,
            lastRefreshedAt: iptvSources.lastRefreshedAt,
            lastError: iptvSources.lastError,
            channelCount: sql<number>`(select count(*) from ${channels} where ${channels.sourceId} = ${iptvSources.id})`,
            visibleCount: sql<number>`(select count(*) from ${channels} where ${channels.sourceId} = ${iptvSources.id} and ${channels.visible} = 1)`,
        })
        .from(iptvSources)
        .orderBy(asc(iptvSources.name))
        .all();

    return rows.map(row => ({
        ...row,
        refreshing: false,
    }));
}

/**
 * Returns one source row.
 *
 * @param db - Drizzle client
 * @param id - Source id
 * @returns Source row or undefined
 */
export function getSource(db: Db, id: number) {
    return db.select().from(iptvSources).where(eq(iptvSources.id, id)).get();
}

/**
 * Creates an IPTV source.
 *
 * @param db - Drizzle client
 * @param input - Source fields
 * @returns The created source
 */
export function createSource(db: Db, input: SourceInput) {
    const now = Date.now();
    return db
        .insert(iptvSources)
        .values({
            name: input.name,
            playlistUrl: input.playlistUrl,
            xmltvUrl: input.xmltvUrl ?? null,
            enabled: input.enabled ?? true,
            refreshMinutes: input.refreshMinutes ?? 1440,
            createdAt: now,
            updatedAt: now,
        })
        .returning()
        .get();
}

/**
 * Updates an IPTV source.
 *
 * @param db - Drizzle client
 * @param id - Source id
 * @param input - Partial source fields
 * @returns The updated source or undefined
 */
export function updateSource(db: Db, id: number, input: Partial<SourceInput>) {
    return db
        .update(iptvSources)
        .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.playlistUrl !== undefined ? { playlistUrl: input.playlistUrl } : {}),
            ...(input.xmltvUrl !== undefined ? { xmltvUrl: input.xmltvUrl } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.refreshMinutes !== undefined ? { refreshMinutes: input.refreshMinutes } : {}),
            updatedAt: Date.now(),
        })
        .where(eq(iptvSources.id, id))
        .returning()
        .get();
}

/**
 * Deletes a source and its channels and programmes through the FK cascade.
 *
 * @param db - Drizzle client
 * @param id - Source id
 */
export function deleteSource(db: Db, id: number): void {
    db.delete(iptvSources).where(eq(iptvSources.id, id)).run();
}

/**
 * Records a refresh result.
 *
 * @param db - Drizzle client
 * @param id - Source id
 * @param error - Error message or null on success
 */
export function setSourceRefreshResult(db: Db, id: number, error: string | null): void {
    const now = Date.now();
    db.update(iptvSources)
        .set({
            lastRefreshedAt: error ? undefined : now,
            lastError: error,
            updatedAt: now,
        })
        .where(eq(iptvSources.id, id))
        .run();
}

/**
 * Replaces a source's channel list while preserving the visible flag of rows
 * that still exist.
 *
 * @param db - Drizzle client
 * @param sourceId - Source id
 * @param input - Parsed playlist channels
 * @returns Counts of seen and removed channels
 */
export function replaceSourceChannels(
    db: Db,
    sourceId: number,
    input: ChannelInput[]
): { seen: number; removed: number } {
    const now = Date.now();
    const maxRow = db
        .select({ max: sql<number | null>`max(${channels.lastSeenAt})` })
        .from(channels)
        .where(eq(channels.sourceId, sourceId))
        .get();
    const syncToken = Math.max(now, (maxRow?.max ?? 0) + 1);

    const run = db.transaction(tx => {
        for (const channel of input) {
            tx.insert(channels)
                .values({
                    sourceId,
                    stableKey: channel.stableKey,
                    tvgId: channel.tvgId ?? null,
                    name: channel.name,
                    logo: channel.logo ?? null,
                    groupTitle: channel.groupTitle ?? null,
                    streamUrl: channel.streamUrl,
                    country: channel.country ?? null,
                    visible: false,
                    lastSeenAt: syncToken,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: [channels.sourceId, channels.stableKey],
                    set: {
                        tvgId: channel.tvgId ?? null,
                        name: channel.name,
                        logo: channel.logo ?? null,
                        groupTitle: channel.groupTitle ?? null,
                        streamUrl: channel.streamUrl,
                        country: channel.country ?? null,
                        lastSeenAt: syncToken,
                        updatedAt: now,
                    },
                })
                .run();
        }

        const removed = tx
            .delete(channels)
            .where(and(eq(channels.sourceId, sourceId), ne(channels.lastSeenAt, syncToken)))
            .run();

        return { seen: input.length, removed: removed.changes };
    });

    return run;
}

/**
 * Sets visibility for a batch of channels.
 *
 * @param db - Drizzle client
 * @param ids - Channel ids
 * @param visible - New visibility
 * @returns Number of updated rows
 */
export function setChannelVisibility(db: Db, ids: number[], visible: boolean): number {
    if (ids.length === 0) {
        return 0;
    }
    return db
        .update(channels)
        .set({ visible, updatedAt: Date.now() })
        .where(inArray(channels.id, ids))
        .run().changes;
}

/**
 * Queries channels with pagination and filters.
 *
 * @param db - Drizzle client
 * @param query - Filter and pagination options
 * @returns Page rows and total count
 */
export function queryChannels(
    db: Db,
    query: ChannelQuery
): {
    items: ChannelDto[];
    total: number;
    page: number;
    pageSize: number;
    visibleTotal: number;
    totalAll: number;
    groups: string[];
} {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const search = query.search ?? query.q;

    const conditions = [];
    if (query.sourceId !== undefined) conditions.push(eq(channels.sourceId, query.sourceId));
    if (query.group !== undefined && query.group !== '') conditions.push(eq(channels.groupTitle, query.group));
    if (query.visible !== undefined) conditions.push(eq(channels.visible, query.visible));
    if (query.visibility === 'visible') conditions.push(eq(channels.visible, true));
    if (query.visibility === 'hidden') conditions.push(eq(channels.visible, false));
    if (search) {
        const pattern = `%${search}%`;
        conditions.push(
            sql`(${channels.name} like ${pattern} or ${channels.tvgId} like ${pattern} or ${channels.groupTitle} like ${pattern} or ${iptvSources.name} like ${pattern})`
        );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countRow = db
        .select({ count: sql<number>`count(*)` })
        .from(channels)
        .innerJoin(iptvSources, eq(channels.sourceId, iptvSources.id))
        .where(where)
        .get();

    const visibleRow = db
        .select({ count: sql<number>`count(*)` })
        .from(channels)
        .where(eq(channels.visible, true))
        .get();

    const totalAllRow = db.select({ count: sql<number>`count(*)` }).from(channels).get();

    const rows = db
        .select({
            id: channels.id,
            sourceId: channels.sourceId,
            sourceName: iptvSources.name,
            name: channels.name,
            logo: channels.logo,
            group: channels.groupTitle,
            tvgId: channels.tvgId,
            visible: channels.visible,
        })
        .from(channels)
        .innerJoin(iptvSources, eq(channels.sourceId, iptvSources.id))
        .where(where)
        .orderBy(asc(channels.name))
        .limit(pageSize)
        .offset(offset)
        .all();

    return {
        items: rows.map(row => ({
            ...row,
            kind: 'iptv' as const,
            nowPlaying: null,
            next: null,
        })),
        total: countRow?.count ?? 0,
        page,
        pageSize,
        visibleTotal: visibleRow?.count ?? 0,
        totalAll: totalAllRow?.count ?? 0,
        groups: listChannelGroups(db),
    };
}

/**
 * Lists distinct channel groups.
 *
 * @param db - Drizzle client
 * @param sourceId - Optional source filter
 * @returns Group names
 */
export function listChannelGroups(db: Db, sourceId?: number): string[] {
    const where = sourceId !== undefined ? eq(channels.sourceId, sourceId) : undefined;
    const rows = db
        .selectDistinct({ group: channels.groupTitle })
        .from(channels)
        .where(where)
        .orderBy(asc(channels.groupTitle))
        .all();
    return rows.map(row => row.group).filter((group): group is string => Boolean(group));
}

/**
 * Finds a visible channel by name for Discord playback.
 *
 * @param db - Drizzle client
 * @param name - Channel name
 * @returns Channel row or undefined
 */
export function findVisibleChannelByName(db: Db, name: string) {
    return db
        .select()
        .from(channels)
        .where(and(eq(channels.visible, true), sql`lower(${channels.name}) = lower(${name})`))
        .get();
}

/**
 * Returns one channel by id.
 *
 * @param db - Drizzle client
 * @param id - Channel id
 * @returns Channel row or undefined
 */
export function getChannelById(db: Db, id: number) {
    return db.select().from(channels).where(eq(channels.id, id)).get();
}

/**
 * Returns one channel as an API DTO.
 *
 * @param db - Drizzle client
 * @param id - Channel id
 * @returns Channel DTO or undefined
 */
export function getChannelDto(db: Db, id: number): ChannelDto | undefined {
    const row = db
        .select({
            id: channels.id,
            sourceId: channels.sourceId,
            sourceName: iptvSources.name,
            name: channels.name,
            logo: channels.logo,
            group: channels.groupTitle,
            tvgId: channels.tvgId,
            visible: channels.visible,
        })
        .from(channels)
        .innerJoin(iptvSources, eq(channels.sourceId, iptvSources.id))
        .where(eq(channels.id, id))
        .get();

    if (!row) {
        return undefined;
    }

    return {
        ...row,
        kind: 'iptv',
        nowPlaying: null,
        next: null,
    };
}

/**
 * Returns visible channel names for autocomplete and the Discord channel list.
 *
 * @param db - Drizzle client
 * @param limit - Maximum number of rows
 * @returns Visible channel rows
 */
export function listVisibleChannels(db: Db, limit = 1000) {
    return db
        .select()
        .from(channels)
        .where(eq(channels.visible, true))
        .orderBy(asc(channels.name))
        .limit(limit)
        .all();
}

/**
 * Replaces a source's programmes in one transaction.
 *
 * @param db - Drizzle client
 * @param sourceId - Source id
 * @param input - Parsed programmes
 * @returns Number of inserted rows
 */
export function replaceSourceProgrammes(db: Db, sourceId: number, input: ProgrammeInput[]): number {
    const now = Date.now();
    const chunkSize = 500;

    return db.transaction(tx => {
        tx.delete(programmes).where(eq(programmes.sourceId, sourceId)).run();

        let inserted = 0;
        for (let index = 0; index < input.length; index += chunkSize) {
            const chunk = input.slice(index, index + chunkSize);
            if (chunk.length === 0) continue;
            tx.insert(programmes)
                .values(
                    chunk.map(programme => ({
                        sourceId,
                        channelTvgId: programme.channelTvgId,
                        start: programme.start,
                        stop: programme.stop,
                        startTimestamp: programme.startTimestamp,
                        stopTimestamp: programme.stopTimestamp,
                        title: programme.title,
                        description: programme.description ?? '',
                        category: programme.category ?? '',
                        subtitle: programme.subtitle ?? null,
                        episodeNum: programme.episodeNum ?? null,
                        season: programme.season ?? null,
                        episode: programme.episode ?? null,
                        icon: programme.icon ?? null,
                        image: programme.image ?? null,
                        date: programme.date ?? null,
                        previouslyShown: programme.previouslyShown ?? null,
                        createdAt: now,
                    }))
                )
                .run();
            inserted += chunk.length;
        }

        return inserted;
    });
}

/**
 * Returns programmes that overlap a time window.
 *
 * @param db - Drizzle client
 * @param query - Window and channel filters
 * @returns Programme rows ordered by start time
 */
export function queryProgrammes(db: Db, query: ProgrammeQuery) {
    const conditions = [
        lte(programmes.startTimestamp, query.end),
        sql`${programmes.stopTimestamp} >= ${query.start}`,
    ];
    if (query.sourceId !== undefined) conditions.push(eq(programmes.sourceId, query.sourceId));
    if (query.channelTvgIds && query.channelTvgIds.length > 0) {
        conditions.push(inArray(programmes.channelTvgId, query.channelTvgIds));
    }

    return db
        .select()
        .from(programmes)
        .where(and(...conditions))
        .orderBy(asc(programmes.channelTvgId), asc(programmes.startTimestamp))
        .all();
}

/**
 * Deletes programmes older than a cut-off.
 *
 * @param db - Drizzle client
 * @param beforeTimestamp - Epoch seconds
 * @returns Number of deleted rows
 */
export function pruneProgrammes(db: Db, beforeTimestamp: number): number {
    return db.delete(programmes).where(lte(programmes.stopTimestamp, beforeTimestamp)).run().changes;
}

/**
 * Returns one guild's allowlist settings.
 *
 * @param db - Drizzle client
 * @param guildId - Discord guild id
 * @returns Guild settings with parsed role ids
 */
export function getGuildSettings(db: Db, guildId: string): GuildSettingsRecord {
    const row = db.select().from(discordGuildSettings).where(eq(discordGuildSettings.guildId, guildId)).get();
    if (!row) {
        return { guildId, allowedRoleIds: [], enabled: true };
    }
    return {
        guildId: row.guildId,
        allowedRoleIds: parseRoleIds(row.allowedRoleIds),
        enabled: row.enabled,
    };
}

/**
 * Returns every stored guild allowlist.
 *
 * @param db - Drizzle client
 * @returns Guild settings rows
 */
export function listGuildSettings(db: Db): GuildSettingsRecord[] {
    return db
        .select()
        .from(discordGuildSettings)
        .all()
        .map(row => ({
            guildId: row.guildId,
            allowedRoleIds: parseRoleIds(row.allowedRoleIds),
            enabled: row.enabled,
        }));
}

/**
 * Creates or updates a guild allowlist.
 *
 * @param db - Drizzle client
 * @param guildId - Discord guild id
 * @param allowedRoleIds - Role ids allowed to use commands
 * @param enabled - Whether commands are enabled in the guild
 * @returns The stored settings
 */
export function upsertGuildSettings(
    db: Db,
    guildId: string,
    allowedRoleIds: string[],
    enabled = true
): GuildSettingsRecord {
    const now = Date.now();
    db.insert(discordGuildSettings)
        .values({
            guildId,
            allowedRoleIds: JSON.stringify(allowedRoleIds),
            enabled,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: discordGuildSettings.guildId,
            set: {
                allowedRoleIds: JSON.stringify(allowedRoleIds),
                enabled,
                updatedAt: now,
            },
        })
        .run();

    return { guildId, allowedRoleIds, enabled };
}

/**
 * Returns stored Plex libraries.
 *
 * @param db - Drizzle client
 * @returns Library rows
 */
export function listPlexLibraries(db: Db): PlexLibraryDto[] {
    return db
        .select()
        .from(plexLibraries)
        .orderBy(asc(plexLibraries.title))
        .all()
        .map(row => ({
            key: row.libraryKey,
            title: row.title,
            type: row.type,
            enabled: row.enabled,
        }));
}

/**
 * Syncs the library list while preserving each library's enabled flag.
 *
 * @param db - Drizzle client
 * @param input - Libraries from Plex
 * @returns Number of libraries seen
 */
export function replacePlexLibraries(
    db: Db,
    input: Array<{ key: string; title: string; type: string }>
): number {
    const now = Date.now();
    return db.transaction(tx => {
        for (const library of input) {
            tx.insert(plexLibraries)
                .values({
                    libraryKey: library.key,
                    title: library.title,
                    type: library.type,
                    enabled: false,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: plexLibraries.libraryKey,
                    set: {
                        title: library.title,
                        type: library.type,
                        updatedAt: now,
                    },
                })
                .run();
        }

        const keys = input.map(library => library.key);
        if (keys.length > 0) {
            tx.delete(plexLibraries).where(notInArray(plexLibraries.libraryKey, keys)).run();
        } else {
            tx.delete(plexLibraries).run();
        }

        return input.length;
    });
}

/**
 * Enables or disables a Plex library.
 *
 * @param db - Drizzle client
 * @param key - Plex library key
 * @param enabled - New enabled state
 * @returns Number of updated rows
 */
export function setPlexLibraryEnabled(db: Db, key: string, enabled: boolean): number {
    return db
        .update(plexLibraries)
        .set({ enabled, updatedAt: Date.now() })
        .where(eq(plexLibraries.libraryKey, key))
        .run().changes;
}

/**
 * Returns the queue ordered by position.
 *
 * @param db - Drizzle client
 * @returns Queue rows ready for the API
 */
export function listQueue(db: Db): QueueItemDto[] {
    return db
        .select()
        .from(plexQueueItems)
        .orderBy(asc(plexQueueItems.position))
        .all()
        .map(row => ({
            id: row.id,
            position: row.position,
            status: row.status as QueueStatus,
            ratingKey: row.ratingKey,
            type: row.type,
            title: row.title,
            showTitle: row.showTitle,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            durationMs: row.durationMs,
            thumbUrl: row.thumbUrl,
            quality: row.quality,
            subtitleMode: parseSubtitleMode(row.subtitleMode),
            error: row.error,
        }));
}

/**
 * Returns one queue row as an API DTO.
 *
 * @param db - Drizzle client
 * @param id - Queue item id
 * @returns Queue item DTO or undefined
 */
export function getQueueItem(db: Db, id: number): QueueItemDto | undefined {
    return listQueue(db).find(item => item.id === id);
}

/**
 * Appends an item to the queue.
 *
 * @param db - Drizzle client
 * @param input - Queue item fields
 * @returns The created row
 */
export function addQueueItem(db: Db, input: QueueInput) {
    const now = Date.now();
    const maxRow = db
        .select({ max: sql<number | null>`max(${plexQueueItems.position})` })
        .from(plexQueueItems)
        .get();
    const position = (maxRow?.max ?? 0) + 1;

    return db
        .insert(plexQueueItems)
        .values({
            position,
            status: 'queued',
            ratingKey: input.ratingKey,
            type: input.type,
            title: input.title,
            showTitle: input.showTitle ?? null,
            seasonNumber: input.seasonNumber ?? null,
            episodeNumber: input.episodeNumber ?? null,
            durationMs: input.durationMs ?? null,
            thumbUrl: input.thumbUrl ?? null,
            quality: input.quality,
            subtitleMode: input.subtitleMode,
            error: null,
            createdAt: now,
            updatedAt: now,
        })
        .returning()
        .get();
}

/**
 * Removes a queue item and compacts the remaining positions.
 *
 * @param db - Drizzle client
 * @param id - Queue item id
 * @returns True when a row was deleted
 */
export function removeQueueItem(db: Db, id: number): boolean {
    const deleted = db.delete(plexQueueItems).where(eq(plexQueueItems.id, id)).run().changes;
    compactQueue(db);
    return deleted > 0;
}

/**
 * Clears the queue.
 *
 * @param db - Drizzle client
 */
export function clearQueue(db: Db): void {
    db.delete(plexQueueItems).run();
}

/**
 * Rewrites queue positions from an ordered id list.
 *
 * @param db - Drizzle client
 * @param ids - Queue item ids in the desired order
 */
export function reorderQueue(db: Db, ids: number[]): void {
    const now = Date.now();
    db.transaction(tx => {
        ids.forEach((id, index) => {
            tx.update(plexQueueItems)
                .set({ position: index + 1, updatedAt: now })
                .where(eq(plexQueueItems.id, id))
                .run();
        });
    });
}

/**
 * Marks a queue item's status and optional error.
 *
 * @param db - Drizzle client
 * @param id - Queue item id
 * @param status - New status
 * @param error - Optional error message
 */
export function setQueueItemStatus(db: Db, id: number, status: QueueStatus, error: string | null = null): void {
    db.update(plexQueueItems)
        .set({ status, error, updatedAt: Date.now() })
        .where(eq(plexQueueItems.id, id))
        .run();
}

/**
 * Returns the next queued item.
 *
 * @param db - Drizzle client
 * @returns Queue row or undefined
 */
export function nextQueuedItem(db: Db) {
    return db
        .select()
        .from(plexQueueItems)
        .where(eq(plexQueueItems.status, 'queued'))
        .orderBy(asc(plexQueueItems.position))
        .get();
}

/**
 * Resets a stale playing item back to queued after a restart.
 *
 * @param db - Drizzle client
 */
export function resetPlayingQueueItems(db: Db): void {
    db.update(plexQueueItems)
        .set({ status: 'queued', error: null, updatedAt: Date.now() })
        .where(eq(plexQueueItems.status, 'playing'))
        .run();
}

function compactQueue(db: Db): void {
    const rows = db
        .select({ id: plexQueueItems.id })
        .from(plexQueueItems)
        .orderBy(asc(plexQueueItems.position))
        .all();
    reorderQueue(
        db,
        rows.map(row => row.id)
    );
}

function parseRoleIds(value: string): string[] {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseSubtitleMode(value: string): 'auto' | 'off' | number {
    if (value === 'auto' || value === 'off') {
        return value;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : 'auto';
}
