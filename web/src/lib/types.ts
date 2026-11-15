import type { ChannelDto, LogLineDto, PlexQuality, ProgrammeDto, SettingsDto } from '@shared/types';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogLevelFilter = LogLevel | 'all';
export type ChannelVisibilityFilter = 'all' | 'visible' | 'hidden';
export type SubtitleMode = 'auto' | 'off' | number;

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ChannelQuery {
    page: number;
    pageSize: number;
    search: string;
    sourceId: number | 'all';
    group: string;
    visibility: ChannelVisibilityFilter;
}

export interface ChannelPage extends Paginated<ChannelDto> {
    /** Visible IPTV channels across every source, independent of the active filters. */
    visibleTotal: number;
    /** Every IPTV channel across every source, independent of the active filters. */
    totalAll: number;
    /** Every group present in the current channel set. */
    groups: string[];
}

export interface GuideResponse {
    dayStart: number;
    dayEnd: number;
    channels: ChannelDto[];
    programmes: ProgrammeDto[];
}

export interface LogQuery {
    level: LogLevelFilter;
    search: string;
    limit: number;
}

export interface LogPage {
    items: LogLineDto[];
    total: number;
}

export interface SaveSourceInput {
    id?: number;
    name: string;
    playlistUrl: string;
    xmltvUrl: string | null;
    refreshMinutes: number;
    enabled: boolean;
}

export interface EnqueueInput {
    ratingKey: string;
    type: 'movie' | 'episode';
    title: string;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    durationMs: number | null;
    quality: PlexQuality;
    subtitleMode: SubtitleMode;
}

export interface StartPlexInput {
    ratingKey: string;
    quality: PlexQuality;
    subtitleMode: SubtitleMode;
    guildId: string;
    voiceChannelId: string;
    /** Present when the item is already in the queue. */
    queueItemId?: number | null;
}

export interface StartPlaceholderInput {
    guildId: string;
    voiceChannelId: string;
}

export interface SavePlexConfigInput {
    serverUrl: string;
    token?: string;
}

export interface DiscordTokensInput {
    botToken?: string;
    userToken?: string;
}

export interface DiscordTokenState {
    botTokenSet: boolean;
    userTokenSet: boolean;
    botLast4: string | null;
    userLast4: string | null;
}

export interface LoginInput {
    username: string;
    password: string;
}

export interface AuthSession {
    user: {
        id: string;
        name: string;
    } | null;
}

export interface AuthConfig {
    enabled: boolean;
    hasUser: boolean;
}

export interface EnableAuthInput {
    username: string;
    password: string;
}

export interface EnableAuthResult {
    enabled: boolean;
    createdAdmin: boolean;
}

export interface UpdateSettingsInput {
    settings: SettingsDto;
}
