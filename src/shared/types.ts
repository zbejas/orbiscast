export type PlaybackMode = 'idle' | 'placeholder' | 'iptv' | 'plex';

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
    paused: boolean;
    queueItemId: number | null;
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
    kind: 'iptv' | 'plex';
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

export interface DiscordStatusDto {
    bot: ConnectionState;
    streamer: ConnectionState;
    botTag: string | null;
    streamerTag: string | null;
    error: string | null;
    guilds: GuildDto[];
}

export type PlexQuality = '720p-4' | '1080p-8' | '1080p-12' | '4k-20';

export interface PlexConfigDto {
    serverUrl: string;
    tokenSet: boolean;
    tokenLast4: string | null;
    channelName: string;
    idleMinutes: number;
    emptyGraceSeconds: number;
    defaultQuality: PlexQuality;
    connected: boolean;
    error: string | null;
}

export interface PlexLibraryDto {
    key: string;
    title: string;
    type: string;
    enabled: boolean;
}

export interface PlexItemDto {
    ratingKey: string;
    key: string;
    libraryKey: string;
    type: 'movie' | 'show' | 'season' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    durationMs: number | null;
    thumbUrl: string | null;
    summary: string | null;
}

export interface PlexStreamDto {
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

export interface PlexItemDetailDto extends PlexItemDto {
    streams: PlexStreamDto[];
}

export type QueueStatus = 'queued' | 'playing' | 'played' | 'failed';

export interface QueueItemDto {
    id: number;
    position: number;
    status: QueueStatus;
    ratingKey: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    durationMs: number | null;
    thumbUrl: string | null;
    quality: PlexQuality;
    subtitleMode: 'auto' | 'off' | number;
    error: string | null;
}

export interface SettingsDto {
    timezone: string;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    publicUrl: string;
    trustedOrigins: string[];
    stream: {
        bitrateVideo: number;
        bitrateVideoMax: number;
        minimizeLatency: boolean;
        disableTranscode: boolean;
        defaultStreamTimeout: number;
    };
    plex: {
        channelName: string;
        idleMinutes: number;
        emptyGraceSeconds: number;
        defaultQuality: PlexQuality;
    };
    auth: {
        enabled: boolean;
    };
}

export interface SetupStatusDto {
    needsSetup: boolean;
    discordConfigured: boolean;
    discordValid: boolean;
    sourcesConfigured: boolean;
    plexConfigured: boolean;
    plexValid: boolean;
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
