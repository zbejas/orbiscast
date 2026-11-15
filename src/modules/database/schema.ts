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
 * Plex libraries exposed in the WebUI. Only enabled libraries are browsable.
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
 * Persisted Plex queue. One global queue because one self-bot means one
 * stream at a time.
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
