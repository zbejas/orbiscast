export type PlaybackMode = 'idle' | 'placeholder' | 'iptv' | 'media';

export type MediaSourceKind = 'plex' | 'jellyfin';

export type MediaQuality = '720p-4' | '1080p-8' | '1080p-12' | '4k-20';

/** Kept as an alias for the Plex modules that still use the old name. */
export type PlexQuality = MediaQuality;

export type MediaLibraryType = 'movie' | 'show' | 'artist' | 'photo' | 'unknown';

export type MediaItemType = 'movie' | 'show' | 'season' | 'episode';

export interface PlaybackViewerDto {
    /** Discord user id. */
    id: string;
    /** Guild display name, falling back to the username. */
    displayName: string;
}

export interface PlaybackStateDto {
    mode: PlaybackMode;
    title: string | null;
    subtitle: string | null;
    posterUrl: string | null;
    guildId: string | null;
    guildName: string | null;
    voiceChannelId: string | null;
    voiceChannelName: string | null;
    startedAt: number | null;
    positionMs: number | null;
    durationMs: number | null;
    positionUpdatedAt: number | null;
    viewers: number;
    /** Non-bot members in the stream voice channel, excluding the streamer. */
    watching: PlaybackViewerDto[];
    paused: boolean;
    queueItemId: number | null;
    /** Media source that owns the active on-demand item or placeholder. */
    sourceId: number | null;
    sourceName: string | null;
    sourceKind: MediaSourceKind | null;
}

export interface SourceDto {
    id: number;
    name: string;
    playlistUrl: string;
    xmltvUrl: string | null;
    enabled: boolean;
    refreshMinutes: number;
    lastRefreshedAt: number | null;
    lastError: string | null;
    channelCount: number;
    visibleCount: number;
    refreshing: boolean;
}

export interface ChannelDto {
    id: number;
    sourceId: number | null;
    sourceName: string;
    name: string;
    logo: string | null;
    group: string | null;
    tvgId: string | null;
    visible: boolean;
    kind: 'iptv' | 'plex' | 'jellyfin';
    nowPlaying: string | null;
    next: string | null;
}

export interface ProgrammeDto {
    id: number;
    sourceId: number;
    channelTvgId: string;
    title: string;
    description: string;
    start: number;
    stop: number;
    category: string | null;
}

export interface RoleDto {
    id: string;
    name: string;
    color: number;
}

export interface VoiceChannelDto {
    id: string;
    name: string;
    guildId: string;
}

export interface GuildDto {
    id: string;
    name: string;
    iconUrl: string | null;
    allowedRoleIds: string[];
    roles: RoleDto[];
    voiceChannels: VoiceChannelDto[];
}

export type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

export type StreamerJoinState = 'idle' | 'joining' | 'partial' | 'joined' | 'error';

export interface StreamerJoinDto {
    state: StreamerJoinState;
    guildId: string | null;
    guildName: string | null;
    fallbackInviteUrl: string | null;
    error: string | null;
}

export interface DiscordStatusDto {
    bot: ConnectionState;
    streamer: ConnectionState;
    botTag: string | null;
    streamerTag: string | null;
    error: string | null;
    guilds: GuildDto[];
    /** OAuth2 URL that adds the bot to a server. Null until the bot is online. */
    botInviteUrl: string | null;
    /** Guilds the streaming account is a member of. */
    streamerGuildIds: string[];
    streamerJoin: StreamerJoinDto;
}

export interface MediaSourceDto {
    id: number;
    kind: MediaSourceKind;
    name: string;
    serverUrl: string;
    tokenSet: boolean;
    tokenLast4: string | null;
    userId: string | null;
    userName: string | null;
    channelName: string;
    idleMinutes: number;
    emptyGraceSeconds: number;
    defaultQuality: MediaQuality;
    enabled: boolean;
    connected: boolean;
    error: string | null;
    libraryCount: number;
    enabledLibraryCount: number;
}

export interface MediaLibraryDto {
    sourceId: number;
    key: string;
    title: string;
    type: MediaLibraryType;
    enabled: boolean;
}

export interface MediaItemDto {
    sourceId: number;
    itemId: string;
    libraryKey: string;
    type: MediaItemType;
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    durationMs: number | null;
    thumbUrl: string | null;
    summary: string | null;
}

/** One page of a paginated media library browse. */
export interface MediaItemPageDto {
    items: MediaItemDto[];
    total: number;
    start: number;
    size: number;
}

export interface MediaStreamDto {
    id: number;
    index: number | null;
    type: 'audio' | 'subtitle' | 'video';
    language: string | null;
    displayTitle: string | null;
    codec: string | null;
    default: boolean;
    forced: boolean;
    burnable: boolean;
}

export interface MediaItemDetailDto extends MediaItemDto {
    /** Show that owns this episode, for series navigation. */
    showItemId: string | null;
    /** Season that owns this episode. */
    seasonItemId: string | null;
    /** Intro marker when the provider exposes one. */
    intro: { startMs: number; endMs: number } | null;
    streams: MediaStreamDto[];
}

export type QueueStatus = 'queued' | 'playing' | 'played' | 'failed';

export interface QueueItemDto {
    id: number;
    sourceId: number;
    sourceName: string;
    sourceKind: MediaSourceKind;
    position: number;
    status: QueueStatus;
    itemId: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    durationMs: number | null;
    thumbUrl: string | null;
    quality: MediaQuality;
    subtitleMode: 'auto' | 'off' | number;
    error: string | null;
}

/**
 * Saved playback progress for one movie or episode. The WebUI uses this to
 * offer resume from where the operator stopped watching.
 */
export interface MediaHistoryDto {
    id: number;
    sourceId: number;
    sourceName: string;
    sourceKind: MediaSourceKind;
    itemId: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    durationMs: number | null;
    thumbUrl: string | null;
    positionMs: number;
    completed: boolean;
    quality: MediaQuality;
    subtitleMode: 'auto' | 'off' | number;
    playedAt: number;
    /** True for a synthetic next-episode recommendation, not a saved position. */
    recommended?: boolean;
}

export interface RecentVoiceChannelDto {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
}

export interface SettingsDto {
    timezone: string;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    publicUrl: string;
    trustedOrigins: string[];
    recentVoiceChannels: RecentVoiceChannelDto[];
    stream: {
        bitrateVideo: number;
        bitrateVideoMax: number;
        minimizeLatency: boolean;
        disableTranscode: boolean;
        defaultStreamTimeout: number;
    };
    playback: {
        /** Queue the next episode when the current one ends. */
        autoplayNextEpisode: boolean;
        /** Skip a Plex intro marker when playback reaches it. */
        autoSkipIntro: boolean;
    };
    auth: {
        enabled: boolean;
    };
}

export interface SetupStatusDto {
    needsSetup: boolean;
    discordConfigured: boolean;
    discordValid: boolean;
    /** True when the bot and the streaming account share at least one server. */
    guildReady: boolean;
    botInviteUrl: string | null;
    sourcesConfigured: boolean;
    mediaConfigured: boolean;
    mediaValid: boolean;
    authEnabled: boolean;
}

export interface LogLineDto {
    id: number;
    timestamp: number;
    level: string;
    message: string;
}

export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}
