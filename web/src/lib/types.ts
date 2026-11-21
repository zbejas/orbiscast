import type { ChannelDto, LogLineDto, MediaQuality, ProgrammeDto, SettingsDto } from '@shared/types';

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
    sourceId: number;
    itemId: string;
    quality: MediaQuality;
    subtitleMode: SubtitleMode;
}

export interface StartMediaInput {
    sourceId: number;
    itemId: string;
    quality: MediaQuality;
    subtitleMode: SubtitleMode;
    guildId: string;
    voiceChannelId: string;
    /** Present when the item is already in the queue. */
    queueItemId?: number | null;
    /** Ignore saved progress and start from the beginning. */
    startOver?: boolean;
}

export interface StartPlaceholderInput {
    sourceId: number;
    guildId: string;
    voiceChannelId: string;
}

export type MediaSourceKind = 'plex' | 'jellyfin';

export interface SaveMediaSourceInput {
    id?: number;
    kind: MediaSourceKind;
    name: string;
    serverUrl: string;
    token?: string;
    channelName: string;
    idleMinutes: number;
    emptyGraceSeconds: number;
    defaultQuality: MediaQuality;
    enabled: boolean;
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
