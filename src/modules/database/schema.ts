import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Key/value application settings. Each top-level settings section is stored as
 * one JSON row. Secrets are encrypted before they reach this table.
 */
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
});

/**
 * One IPTV provider. A source pairs one M3U playlist with an optional XMLTV
 * guide and refreshes them together.
 */
export const iptvSources = sqliteTable('iptv_sources', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    playlistUrl: text('playlist_url').notNull(),
    xmltvUrl: text('xmltv_url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    refreshMinutes: integer('refresh_minutes').notNull().default(1440),
    lastRefreshedAt: integer('last_refreshed_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
});

/**
 * Playable IPTV channels. Only playlist entries with a stream URL are stored.
 * `visible` is the operator's filter and survives refreshes.
 */
export const channels = sqliteTable(
    'channels',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sourceId: integer('source_id')
            .notNull()
            .references(() => iptvSources.id, { onDelete: 'cascade' }),
        stableKey: text('stable_key').notNull(),
        tvgId: text('tvg_id'),
        name: text('name').notNull(),
        logo: text('logo'),
        groupTitle: text('group_title'),
        streamUrl: text('stream_url').notNull(),
        country: text('country'),
        visible: integer('visible', { mode: 'boolean' }).notNull().default(false),
        lastSeenAt: integer('last_seen_at').notNull(),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        uniqueIndex('channels_source_stable_idx').on(table.sourceId, table.stableKey),
        index('channels_visible_idx').on(table.visible),
        index('channels_source_idx').on(table.sourceId),
    ]
);

/**
 * EPG programme rows. Timestamps are epoch seconds.
 */
export const programmes = sqliteTable(
    'programmes',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sourceId: integer('source_id')
            .notNull()
            .references(() => iptvSources.id, { onDelete: 'cascade' }),
        channelTvgId: text('channel_tvg_id').notNull(),
        start: text('start').notNull(),
        stop: text('stop').notNull(),
        startTimestamp: integer('start_timestamp').notNull(),
        stopTimestamp: integer('stop_timestamp').notNull(),
        title: text('title').notNull(),
        description: text('description').notNull().default(''),
        category: text('category').notNull().default(''),
        subtitle: text('subtitle'),
        episodeNum: text('episode_num'),
        season: integer('season'),
        episode: integer('episode'),
        icon: text('icon'),
        image: text('image'),
        date: text('date'),
        previouslyShown: integer('previously_shown', { mode: 'boolean' }),
        createdAt: integer('created_at').notNull(),
    },
    table => [
        index('programmes_channel_time_idx').on(table.sourceId, table.channelTvgId, table.startTimestamp),
        index('programmes_time_idx').on(table.startTimestamp),
    ]
);

/**
 * Per-guild Discord permissions. An empty allowedRoleIds array means only
 * members with Manage Server may use commands.
 */
export const discordGuildSettings = sqliteTable('discord_guild_settings', {
    guildId: text('guild_id').primaryKey(),
    allowedRoleIds: text('allowed_role_ids').notNull().default('[]'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
});

/**
 * One media server, either Plex or Jellyfin. A source owns a virtual Discord
 * channel, a library list, and the queue entries that point at it.
 */
export const mediaSources = sqliteTable(
    'media_sources',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        kind: text('kind', { enum: ['plex', 'jellyfin'] }).notNull(),
        name: text('name').notNull(),
        baseUrl: text('base_url').notNull(),
        tokenEncrypted: text('token_encrypted').notNull().default(''),
        tokenLast4: text('token_last4').notNull().default(''),
        /** Stable per-source identifier used for Plex clients and Jellyfin devices. */
        clientIdentifier: text('client_identifier').notNull().default(''),
        /** Jellyfin user id used for user-scoped metadata and playback. */
        userId: text('user_id'),
        userName: text('user_name'),
        channelName: text('channel_name').notNull(),
        idleMinutes: integer('idle_minutes').notNull().default(5),
        emptyGraceSeconds: integer('empty_grace_seconds').notNull().default(30),
        defaultQuality: text('default_quality', { enum: ['720p-4', '1080p-8', '1080p-12', '4k-20'] })
            .notNull()
            .default('1080p-8'),
        enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [index('media_sources_kind_idx').on(table.kind), index('media_sources_enabled_idx').on(table.enabled)]
);

/**
 * Libraries exposed in the WebUI for one media source. Only enabled libraries
 * are browsable.
 */
export const mediaLibraries = sqliteTable(
    'media_libraries',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sourceId: integer('source_id')
            .notNull()
            .references(() => mediaSources.id, { onDelete: 'cascade' }),
        libraryKey: text('library_key').notNull(),
        title: text('title').notNull(),
        type: text('type').notNull(),
        enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        uniqueIndex('media_libraries_source_key_idx').on(table.sourceId, table.libraryKey),
        index('media_libraries_source_idx').on(table.sourceId),
    ]
);

/**
 * Persisted on-demand queue. One global queue because one self-bot means one
 * stream at a time. Entries may point at any configured media source.
 */
export const mediaQueueItems = sqliteTable(
    'media_queue_items',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sourceId: integer('source_id')
            .notNull()
            .references(() => mediaSources.id, { onDelete: 'cascade' }),
        position: integer('position').notNull(),
        status: text('status', { enum: ['queued', 'playing', 'played', 'failed'] }).notNull().default('queued'),
        itemId: text('item_id').notNull(),
        type: text('type', { enum: ['movie', 'episode'] }).notNull(),
        title: text('title').notNull(),
        showTitle: text('show_title'),
        seasonNumber: integer('season_number'),
        episodeNumber: integer('episode_number'),
        durationMs: integer('duration_ms'),
        thumbUrl: text('thumb_url'),
        quality: text('quality', { enum: ['720p-4', '1080p-8', '1080p-12', '4k-20'] })
            .notNull()
            .default('1080p-8'),
        subtitleMode: text('subtitle_mode').notNull().default('auto'),
        error: text('error'),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        index('media_queue_position_idx').on(table.position),
        index('media_queue_status_idx').on(table.status),
        index('media_queue_source_idx').on(table.sourceId),
    ]
);

/**
 * Saved playback progress for on-demand movies and episodes. One row per
 * `(source_id, item_id)`. Completed rows stay for the played history but are
 * excluded from the resume list.
 */
export const mediaHistory = sqliteTable(
    'media_history',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        sourceId: integer('source_id')
            .notNull()
            .references(() => mediaSources.id, { onDelete: 'cascade' }),
        itemId: text('item_id').notNull(),
        type: text('type', { enum: ['movie', 'episode'] }).notNull(),
        title: text('title').notNull(),
        showTitle: text('show_title'),
        seasonNumber: integer('season_number'),
        episodeNumber: integer('episode_number'),
        durationMs: integer('duration_ms'),
        thumbUrl: text('thumb_url'),
        positionMs: integer('position_ms').notNull().default(0),
        completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
        quality: text('quality', { enum: ['720p-4', '1080p-8', '1080p-12', '4k-20'] })
            .notNull()
            .default('1080p-8'),
        subtitleMode: text('subtitle_mode').notNull().default('auto'),
        playedAt: integer('played_at').notNull(),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        uniqueIndex('media_history_source_item_idx').on(table.sourceId, table.itemId),
        index('media_history_played_idx').on(table.playedAt),
        index('media_history_completed_idx').on(table.completed),
    ]
);

/**
 * Legacy Plex library table kept for the one-time migration into
 * media_libraries. New code must not write here.
 */
export const plexLibraries = sqliteTable('plex_libraries', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryKey: text('library_key').notNull().unique(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
});

/**
 * Legacy Plex queue table kept for the one-time migration into
 * media_queue_items. New code must not write here.
 */
export const plexQueueItems = sqliteTable(
    'plex_queue_items',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        position: integer('position').notNull(),
        status: text('status', { enum: ['queued', 'playing', 'played', 'failed'] }).notNull().default('queued'),
        ratingKey: text('rating_key').notNull(),
        type: text('type', { enum: ['movie', 'episode'] }).notNull(),
        title: text('title').notNull(),
        showTitle: text('show_title'),
        seasonNumber: integer('season_number'),
        episodeNumber: integer('episode_number'),
        durationMs: integer('duration_ms'),
        thumbUrl: text('thumb_url'),
        quality: text('quality', { enum: ['720p-4', '1080p-8', '1080p-12', '4k-20'] })
            .notNull()
            .default('1080p-8'),
        subtitleMode: text('subtitle_mode').notNull().default('auto'),
        error: text('error'),
        createdAt: integer('created_at').notNull(),
        updatedAt: integer('updated_at').notNull(),
    },
    table => [
        index('plex_queue_position_idx').on(table.position),
        index('plex_queue_status_idx').on(table.status),
    ]
);
