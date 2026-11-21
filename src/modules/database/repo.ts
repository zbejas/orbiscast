import { and, asc, desc, eq, gt, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
    channels,
    discordGuildSettings,
    iptvSources,
    mediaHistory,
    mediaLibraries,
    mediaQueueItems,
    mediaSources,
    plexLibraries,
    plexQueueItems,
    programmes,
} from './schema';
import type {
    ChannelDto,
    MediaHistoryDto,
    MediaLibraryDto,
    MediaLibraryType,
    MediaQuality,
    MediaSourceKind,
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

export interface MediaSourceInput {
    kind: MediaSourceKind;
    name: string;
    baseUrl: string;
    tokenEncrypted?: string;
    tokenLast4?: string;
    clientIdentifier?: string;
    userId?: string | null;
    userName?: string | null;
    channelName: string;
    idleMinutes?: number;
    emptyGraceSeconds?: number;
    defaultQuality?: MediaQuality;
    enabled?: boolean;
}

export type MediaSourceRecord = typeof mediaSources.$inferSelect;

export interface MediaQueueInput {
    sourceId: number;
    itemId: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle?: string | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    durationMs?: number | null;
    thumbUrl?: string | null;
    quality: MediaQuality;
    subtitleMode: string;
}

export interface MediaHistoryInput {
    sourceId: number;
    itemId: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle?: string | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    durationMs?: number | null;
    thumbUrl?: string | null;
    positionMs?: number;
    completed?: boolean;
    quality: MediaQuality;
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
 * Adds the current and next programme titles to channel rows.
 *
 * @param db - Drizzle client
 * @param items - Channel DTOs from {@link queryChannels}
 * @returns Channel DTOs with nowPlaying and next filled
 */
export function attachChannelGuide(db: Db, items: ChannelDto[]): ChannelDto[] {
    const tvgIds = [
        ...new Set(items.map(item => item.tvgId).filter((tvgId): tvgId is string => Boolean(tvgId))),
    ];
    if (tvgIds.length === 0) {
        return items;
    }

    const now = Math.floor(Date.now() / 1000);
    const rows = db
        .select({
            sourceId: programmes.sourceId,
            channelTvgId: programmes.channelTvgId,
            startTimestamp: programmes.startTimestamp,
            stopTimestamp: programmes.stopTimestamp,
            title: programmes.title,
        })
        .from(programmes)
        .where(
            and(
                inArray(programmes.channelTvgId, tvgIds),
                gt(programmes.stopTimestamp, now),
                lte(programmes.startTimestamp, now + 86_400)
            )
        )
        .orderBy(asc(programmes.channelTvgId), asc(programmes.startTimestamp))
        .all();

    const guide = new Map<string, { current: string | null; next: string | null }>();
    for (const row of rows) {
        const key = `${row.sourceId}:${row.channelTvgId}`;
        const entry = guide.get(key) ?? { current: null, next: null };
        if (row.startTimestamp <= now && row.stopTimestamp > now) {
            entry.current = row.title;
        } else if (row.startTimestamp > now && entry.next === null) {
            entry.next = row.title;
        }
        guide.set(key, entry);
    }

    return items.map(item => {
        const entry =
            item.sourceId !== null && item.tvgId ? guide.get(`${item.sourceId}:${item.tvgId}`) : undefined;
        return {
            ...item,
            nowPlaying: entry?.current ?? null,
            next: entry?.next ?? null,
        };
    });
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
 * Builds a stable reference for a channel in Discord autocomplete and command
 * options. The numeric id stays unique when two channels share a name.
 *
 * @param id - Channel id
 * @returns Reference such as `id:42`
 */
export function channelRef(id: number): string {
    return `id:${id}`;
}

/**
 * Resolves a channel reference from autocomplete, or a typed channel name.
 *
 * @param db - Drizzle client
 * @param ref - `id:<n>` reference or channel name
 * @returns Visible channel row or undefined
 */
export function findVisibleChannelByRef(db: Db, ref: string) {
    const value = ref.trim();
    if (value.startsWith('id:')) {
        const id = Number.parseInt(value.slice(3), 10);
        if (!Number.isInteger(id)) return undefined;
        const channel = getChannelById(db, id);
        return channel?.visible ? channel : undefined;
    }
    return findVisibleChannelByName(db, value);
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
 * Lists configured media sources.
 *
 * @param db - Drizzle client
 * @returns Media source rows ordered by name
 */
export function listMediaSources(db: Db): MediaSourceRecord[] {
    return db.select().from(mediaSources).orderBy(asc(mediaSources.name)).all();
}

/**
 * Returns one media source.
 *
 * @param db - Drizzle client
 * @param id - Media source id
 * @returns Media source row or undefined
 */
export function getMediaSource(db: Db, id: number): MediaSourceRecord | undefined {
    return db.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
}

/**
 * Creates a media source.
 *
 * @param db - Drizzle client
 * @param input - Source fields, with the token already encrypted
 * @returns The created row
 */
export function createMediaSource(db: Db, input: MediaSourceInput): MediaSourceRecord {
    const now = Date.now();
    return db
        .insert(mediaSources)
        .values({
            kind: input.kind,
            name: input.name,
            baseUrl: input.baseUrl,
            tokenEncrypted: input.tokenEncrypted ?? '',
            tokenLast4: input.tokenLast4 ?? '',
            clientIdentifier: input.clientIdentifier ?? '',
            userId: input.userId ?? null,
            userName: input.userName ?? null,
            channelName: input.channelName,
            idleMinutes: input.idleMinutes ?? 5,
            emptyGraceSeconds: input.emptyGraceSeconds ?? 30,
            defaultQuality: input.defaultQuality ?? '1080p-8',
            enabled: input.enabled ?? true,
            createdAt: now,
            updatedAt: now,
        })
        .returning()
        .get();
}

/**
 * Updates a media source.
 *
 * @param db - Drizzle client
 * @param id - Media source id
 * @param input - Changed fields
 * @returns The updated row, or undefined when it does not exist
 */
export function updateMediaSource(
    db: Db,
    id: number,
    input: Partial<Omit<MediaSourceInput, 'kind'>> & { kind?: MediaSourceKind }
): MediaSourceRecord | undefined {
    const changed = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    ) as Partial<typeof mediaSources.$inferInsert>;
    if (Object.keys(changed).length === 0) {
        return getMediaSource(db, id);
    }
    return db
        .update(mediaSources)
        .set({ ...changed, updatedAt: Date.now() })
        .where(eq(mediaSources.id, id))
        .returning()
        .get();
}

/**
 * Deletes a media source. Libraries and queue entries cascade.
 *
 * @param db - Drizzle client
 * @param id - Media source id
 * @returns True when a row was deleted
 */
export function deleteMediaSource(db: Db, id: number): boolean {
    return db.delete(mediaSources).where(eq(mediaSources.id, id)).run().changes > 0;
}

/**
 * Lists one source's libraries.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @returns Library DTOs
 */
export function listMediaLibraries(db: Db, sourceId: number): MediaLibraryDto[] {
    return db
        .select()
        .from(mediaLibraries)
        .where(eq(mediaLibraries.sourceId, sourceId))
        .orderBy(asc(mediaLibraries.title))
        .all()
        .map(row => ({
            sourceId: row.sourceId,
            key: row.libraryKey,
            title: row.title,
            type: normalizeLibraryType(row.type),
            enabled: row.enabled,
        }));
}

/**
 * Syncs one source's library list while preserving enabled flags.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @param input - Libraries reported by the server
 * @returns Number of libraries seen
 */
export function replaceMediaLibraries(
    db: Db,
    sourceId: number,
    input: Array<{ key: string; title: string; type: string }>
): number {
    const now = Date.now();
    return db.transaction(tx => {
        for (const library of input) {
            tx.insert(mediaLibraries)
                .values({
                    sourceId,
                    libraryKey: library.key,
                    title: library.title,
                    type: library.type,
                    enabled: false,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: [mediaLibraries.sourceId, mediaLibraries.libraryKey],
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
            tx.delete(mediaLibraries)
                .where(and(eq(mediaLibraries.sourceId, sourceId), notInArray(mediaLibraries.libraryKey, keys)))
                .run();
        } else {
            tx.delete(mediaLibraries).where(eq(mediaLibraries.sourceId, sourceId)).run();
        }

        return input.length;
    });
}

/**
 * Enables or disables one library.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @param key - Library key from the server
 * @param enabled - New enabled state
 * @returns Number of updated rows
 */
export function setMediaLibraryEnabled(
    db: Db,
    sourceId: number,
    key: string,
    enabled: boolean
): number {
    return db
        .update(mediaLibraries)
        .set({ enabled, updatedAt: Date.now() })
        .where(and(eq(mediaLibraries.sourceId, sourceId), eq(mediaLibraries.libraryKey, key)))
        .run().changes;
}

/**
 * Returns the global queue ordered by position.
 *
 * @param db - Drizzle client
 * @returns Queue entries with their source metadata
 */
export function listMediaQueue(db: Db): QueueItemDto[] {
    return db
        .select({
            id: mediaQueueItems.id,
            sourceId: mediaQueueItems.sourceId,
            sourceName: mediaSources.name,
            sourceKind: mediaSources.kind,
            position: mediaQueueItems.position,
            status: mediaQueueItems.status,
            itemId: mediaQueueItems.itemId,
            type: mediaQueueItems.type,
            title: mediaQueueItems.title,
            showTitle: mediaQueueItems.showTitle,
            seasonNumber: mediaQueueItems.seasonNumber,
            episodeNumber: mediaQueueItems.episodeNumber,
            durationMs: mediaQueueItems.durationMs,
            thumbUrl: mediaQueueItems.thumbUrl,
            quality: mediaQueueItems.quality,
            subtitleMode: mediaQueueItems.subtitleMode,
            error: mediaQueueItems.error,
        })
        .from(mediaQueueItems)
        .innerJoin(mediaSources, eq(mediaQueueItems.sourceId, mediaSources.id))
        .orderBy(asc(mediaQueueItems.position))
        .all()
        .map(row => ({
            ...row,
            sourceKind: row.sourceKind as MediaSourceKind,
            status: row.status as QueueStatus,
            quality: row.quality as MediaQuality,
            subtitleMode: parseSubtitleMode(row.subtitleMode),
        }));
}

/**
 * Returns one queue entry.
 *
 * @param db - Drizzle client
 * @param id - Queue entry id
 * @returns Queue entry or undefined
 */
export function getMediaQueueItem(db: Db, id: number): QueueItemDto | undefined {
    return listMediaQueue(db).find(item => item.id === id);
}

/**
 * Appends an item to the global queue.
 *
 * @param db - Drizzle client
 * @param input - Queue item fields
 * @returns The created queue entry
 */
export function addMediaQueueItem(db: Db, input: MediaQueueInput): QueueItemDto {
    const now = Date.now();
    const maxRow = db
        .select({ max: sql<number | null>`max(${mediaQueueItems.position})` })
        .from(mediaQueueItems)
        .get();
    const position = (maxRow?.max ?? 0) + 1;

    const created = db
        .insert(mediaQueueItems)
        .values({
            sourceId: input.sourceId,
            position,
            status: 'queued',
            itemId: input.itemId,
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

    const item = getMediaQueueItem(db, created.id);
    if (!item) {
        throw new Error('Could not read the created queue item');
    }
    return item;
}

/**
 * Removes a queue entry and compacts the remaining positions.
 *
 * @param db - Drizzle client
 * @param id - Queue entry id
 * @returns True when a row was deleted
 */
export function removeMediaQueueItem(db: Db, id: number): boolean {
    const deleted = db.delete(mediaQueueItems).where(eq(mediaQueueItems.id, id)).run().changes;
    compactQueue(db);
    return deleted > 0;
}

/**
 * Clears the queue, optionally keeping one item.
 *
 * @param db - Drizzle client
 * @param keepId - Queue entry id to preserve, usually the active playback
 */
export function clearMediaQueue(db: Db, keepId?: number): void {
    if (keepId === undefined) {
        db.delete(mediaQueueItems).run();
    } else {
        db.delete(mediaQueueItems).where(ne(mediaQueueItems.id, keepId)).run();
    }
    compactQueue(db);
}

/**
 * Rewrites queue positions from an ordered id list.
 *
 * @param db - Drizzle client
 * @param ids - Queue entry ids in the desired order
 */
export function reorderMediaQueue(db: Db, ids: number[]): void {
    const now = Date.now();
    db.transaction(tx => {
        ids.forEach((id, index) => {
            tx.update(mediaQueueItems)
                .set({ position: index + 1, updatedAt: now })
                .where(eq(mediaQueueItems.id, id))
                .run();
        });
    });
}

/**
 * Marks a queue entry's status and optional error.
 *
 * @param db - Drizzle client
 * @param id - Queue entry id
 * @param status - New status
 * @param error - Optional error message
 */
export function setMediaQueueStatus(db: Db, id: number, status: QueueStatus, error: string | null = null): void {
    db.update(mediaQueueItems)
        .set({ status, error, updatedAt: Date.now() })
        .where(eq(mediaQueueItems.id, id))
        .run();
}

/**
 * Updates one queue entry's subtitle preference.
 *
 * @param db - Drizzle client
 * @param id - Queue entry id
 * @param subtitleMode - Auto, off, or a stream id
 */
export function setMediaQueueSubtitleMode(db: Db, id: number, subtitleMode: string): void {
    db.update(mediaQueueItems)
        .set({ subtitleMode, updatedAt: Date.now() })
        .where(eq(mediaQueueItems.id, id))
        .run();
}

/**
 * Returns the next queued item.
 *
 * @param db - Drizzle client
 * @returns Queue entry or undefined
 */
export function nextQueuedMediaItem(db: Db): QueueItemDto | undefined {
    return listMediaQueue(db).find(item => item.status === 'queued');
}

/**
 * Resets stale playing items back to queued after a restart.
 *
 * @param db - Drizzle client
 */
export function resetPlayingMediaItems(db: Db): void {
    db.update(mediaQueueItems)
        .set({ status: 'queued', error: null, updatedAt: Date.now() })
        .where(eq(mediaQueueItems.status, 'playing'))
        .run();
}

/**
 * Returns saved playback progress, newest first.
 *
 * @param db - Drizzle client
 * @param limit - Maximum number of rows
 * @param includeCompleted - Whether finished items are returned
 * @returns History entries with their source metadata
 */
export function listMediaHistory(db: Db, limit = 20, includeCompleted = false): MediaHistoryDto[] {
    const rows = db
        .select({
            id: mediaHistory.id,
            sourceId: mediaHistory.sourceId,
            sourceName: mediaSources.name,
            sourceKind: mediaSources.kind,
            itemId: mediaHistory.itemId,
            type: mediaHistory.type,
            title: mediaHistory.title,
            showTitle: mediaHistory.showTitle,
            seasonNumber: mediaHistory.seasonNumber,
            episodeNumber: mediaHistory.episodeNumber,
            durationMs: mediaHistory.durationMs,
            thumbUrl: mediaHistory.thumbUrl,
            positionMs: mediaHistory.positionMs,
            completed: mediaHistory.completed,
            quality: mediaHistory.quality,
            subtitleMode: mediaHistory.subtitleMode,
            playedAt: mediaHistory.playedAt,
        })
        .from(mediaHistory)
        .innerJoin(mediaSources, eq(mediaHistory.sourceId, mediaSources.id))
        .where(includeCompleted ? undefined : eq(mediaHistory.completed, false))
        .orderBy(desc(mediaHistory.playedAt))
        .limit(limit)
        .all();

    return rows.map(row => normalizeHistoryRow(row));
}

/**
 * Returns saved progress for one media item.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @param itemId - Item id
 * @returns History entry or undefined
 */
export function getMediaHistoryItem(
    db: Db,
    sourceId: number,
    itemId: string
): MediaHistoryDto | undefined {
    const row = db
        .select({
            id: mediaHistory.id,
            sourceId: mediaHistory.sourceId,
            sourceName: mediaSources.name,
            sourceKind: mediaSources.kind,
            itemId: mediaHistory.itemId,
            type: mediaHistory.type,
            title: mediaHistory.title,
            showTitle: mediaHistory.showTitle,
            seasonNumber: mediaHistory.seasonNumber,
            episodeNumber: mediaHistory.episodeNumber,
            durationMs: mediaHistory.durationMs,
            thumbUrl: mediaHistory.thumbUrl,
            positionMs: mediaHistory.positionMs,
            completed: mediaHistory.completed,
            quality: mediaHistory.quality,
            subtitleMode: mediaHistory.subtitleMode,
            playedAt: mediaHistory.playedAt,
        })
        .from(mediaHistory)
        .innerJoin(mediaSources, eq(mediaHistory.sourceId, mediaSources.id))
        .where(and(eq(mediaHistory.sourceId, sourceId), eq(mediaHistory.itemId, itemId)))
        .get();

    if (!row) return undefined;
    return normalizeHistoryRow(row);
}

/**
 * Creates or updates saved playback progress for one item.
 *
 * @param db - Drizzle client
 * @param input - Item metadata and progress
 * @returns The stored history entry
 */
export function upsertMediaHistory(db: Db, input: MediaHistoryInput): MediaHistoryDto {
    const now = Date.now();
    db.insert(mediaHistory)
        .values({
            sourceId: input.sourceId,
            itemId: input.itemId,
            type: input.type,
            title: input.title,
            showTitle: input.showTitle ?? null,
            seasonNumber: input.seasonNumber ?? null,
            episodeNumber: input.episodeNumber ?? null,
            durationMs: input.durationMs ?? null,
            thumbUrl: input.thumbUrl ?? null,
            positionMs: Math.max(0, Math.round(input.positionMs ?? 0)),
            completed: input.completed ?? false,
            quality: input.quality,
            subtitleMode: input.subtitleMode,
            playedAt: now,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: [mediaHistory.sourceId, mediaHistory.itemId],
            set: {
                type: input.type,
                title: input.title,
                showTitle: input.showTitle ?? null,
                seasonNumber: input.seasonNumber ?? null,
                episodeNumber: input.episodeNumber ?? null,
                durationMs: input.durationMs ?? null,
                thumbUrl: input.thumbUrl ?? null,
                positionMs: Math.max(0, Math.round(input.positionMs ?? 0)),
                completed: input.completed ?? false,
                quality: input.quality,
                subtitleMode: input.subtitleMode,
                playedAt: now,
                updatedAt: now,
            },
        })
        .run();

    const item = getMediaHistoryItem(db, input.sourceId, input.itemId);
    if (!item) {
        throw new Error('Could not read the saved media history entry');
    }
    return item;
}

/**
 * Updates the saved position of an existing history row.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @param itemId - Item id
 * @param positionMs - New position in milliseconds
 * @param completed - Optional completed flag
 */
export function setMediaHistoryProgress(
    db: Db,
    sourceId: number,
    itemId: string,
    positionMs: number,
    completed?: boolean
): void {
    const now = Date.now();
    db.update(mediaHistory)
        .set({
            positionMs: Math.max(0, Math.round(positionMs)),
            ...(completed === undefined ? {} : { completed }),
            playedAt: now,
            updatedAt: now,
        })
        .where(and(eq(mediaHistory.sourceId, sourceId), eq(mediaHistory.itemId, itemId)))
        .run();
}

/**
 * Updates the saved subtitle preference of an existing history row.
 *
 * @param db - Drizzle client
 * @param sourceId - Media source id
 * @param itemId - Item id
 * @param subtitleMode - Auto, off, or a stream id
 */
export function setMediaHistorySubtitleMode(
    db: Db,
    sourceId: number,
    itemId: string,
    subtitleMode: string
): void {
    db.update(mediaHistory)
        .set({ subtitleMode, updatedAt: Date.now() })
        .where(and(eq(mediaHistory.sourceId, sourceId), eq(mediaHistory.itemId, itemId)))
        .run();
}

/**
 * Removes one history entry.
 *
 * @param db - Drizzle client
 * @param id - History entry id
 * @returns True when a row was deleted
 */
export function removeMediaHistory(db: Db, id: number): boolean {
    return db.delete(mediaHistory).where(eq(mediaHistory.id, id)).run().changes > 0;
}

/**
 * Reads the legacy Plex library rows for the one-time migration.
 *
 * @param db - Drizzle client
 * @returns Legacy rows
 */
export function listLegacyPlexLibraries(db: Db) {
    return db.select().from(plexLibraries).orderBy(asc(plexLibraries.title)).all();
}

/**
 * Reads the legacy Plex queue rows for the one-time migration.
 *
 * @param db - Drizzle client
 * @returns Legacy rows
 */
export function listLegacyPlexQueue(db: Db) {
    return db.select().from(plexQueueItems).orderBy(asc(plexQueueItems.position)).all();
}

function compactQueue(db: Db): void {
    const rows = db
        .select({ id: mediaQueueItems.id })
        .from(mediaQueueItems)
        .orderBy(asc(mediaQueueItems.position))
        .all();
    reorderMediaQueue(
        db,
        rows.map(row => row.id)
    );
}

function normalizeLibraryType(value: string): MediaLibraryType {
    if (value === 'movie' || value === 'show' || value === 'artist' || value === 'photo') {
        return value;
    }
    return 'unknown';
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

function normalizeHistoryRow(
    row: Omit<MediaHistoryDto, 'sourceKind' | 'quality' | 'subtitleMode'> & {
        sourceKind: string;
        quality: string;
        subtitleMode: string;
    }
): MediaHistoryDto {
    return {
        ...row,
        sourceKind: row.sourceKind as MediaSourceKind,
        quality: row.quality as MediaQuality,
        subtitleMode: parseSubtitleMode(row.subtitleMode),
    };
}
