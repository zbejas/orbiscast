import type {
    ChannelDto,
    DiscordStatusDto,
    GuildDto,
    LogLineDto,
    PlaybackStateDto,
    PlexConfigDto,
    PlexItemDetailDto,
    PlexItemDto,
    PlexLibraryDto,
    QueueItemDto,
    SettingsDto,
    SetupStatusDto,
    SourceDto,
} from '@shared/types';
import type {
    AuthConfig,
    AuthSession,
    ChannelPage,
    ChannelQuery,
    DiscordTokenState,
    DiscordTokensInput,
    EnableAuthInput,
    EnableAuthResult,
    EnqueueInput,
    GuideResponse,
    LogPage,
    LogQuery,
    SavePlexConfigInput,
    SaveSourceInput,
    StartPlaceholderInput,
    StartPlexInput,
} from './types';

const API_BASE = '/api';

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

interface ErrorBody {
    error?: {
        code?: string;
        message?: string;
        details?: unknown;
    };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers,
    });

    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
        try {
            body = JSON.parse(text);
        } catch {
            body = null;
        }
    }

    if (!response.ok) {
        const errorBody = (body ?? {}) as ErrorBody;
        throw new ApiError(
            response.status,
            errorBody.error?.code ?? 'request_failed',
            errorBody.error?.message ?? `Request failed with status ${response.status}.`,
            errorBody.error?.details
        );
    }

    return body as T;
}

function channelQueryString(query: ChannelQuery): string {
    const params = new URLSearchParams();
    params.set('page', String(query.page));
    params.set('pageSize', String(query.pageSize));
    if (query.search.trim()) params.set('search', query.search.trim());
    if (query.sourceId !== 'all') params.set('sourceId', String(query.sourceId));
    if (query.group !== 'all') params.set('group', query.group);
    if (query.visibility !== 'all') params.set('visibility', query.visibility);
    return params.toString();
}

function logQueryString(query: LogQuery): string {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit));
    if (query.level !== 'all') params.set('level', query.level);
    if (query.search.trim()) params.set('q', query.search.trim());
    return params.toString();
}

export const api = {
    playback: {
        get: () => request<PlaybackStateDto>('/playback'),
        stop: async () => {
            await request<{ ok: boolean; message: string }>('/playback/stop', { method: 'POST' });
            return request<PlaybackStateDto>('/playback');
        },
        skip: async () => {
            await request<{ ok: boolean; message: string }>('/playback/skip', { method: 'POST' });
            return request<PlaybackStateDto>('/playback');
        },
        pause: async () => {
            await request<{ ok: boolean; message: string }>('/playback/pause', { method: 'POST' });
            return request<PlaybackStateDto>('/playback');
        },
        resume: async () => {
            await request<{ ok: boolean; message: string }>('/playback/resume', { method: 'POST' });
            return request<PlaybackStateDto>('/playback');
        },
        seek: async (seconds: number) => {
            await request<{ ok: boolean; message: string }>('/playback/seek', {
                method: 'POST',
                body: JSON.stringify({ seconds }),
            });
            return request<PlaybackStateDto>('/playback');
        },
    },

    channels: {
        list: (query: ChannelQuery) => request<ChannelPage>(`/channels?${channelQueryString(query)}`),
        setVisible: (id: number, visible: boolean) =>
            request<ChannelDto>(`/channels/${id}/visibility`, {
                method: 'PATCH',
                body: JSON.stringify({ visible }),
            }),
        setBulkVisible: (ids: number[], visible: boolean) =>
            request<{ updated: number }>('/channels/visibility', {
                method: 'PATCH',
                body: JSON.stringify({ ids, visible }),
            }),
    },

    guide: {
        get: (day: string) => request<GuideResponse>(`/guide?day=${encodeURIComponent(day)}`),
    },

    sources: {
        list: () => request<SourceDto[]>('/sources'),
        create: (input: SaveSourceInput) =>
            request<SourceDto>('/sources', { method: 'POST', body: JSON.stringify(input) }),
        update: (input: SaveSourceInput) =>
            request<SourceDto>(`/sources/${input.id}`, { method: 'PATCH', body: JSON.stringify(input) }),
        remove: (id: number) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
        refresh: async (id: number) => {
            const result = await request<{ ok: boolean; source: SourceDto | null }>(
                `/sources/${id}/refresh`,
                { method: 'POST' }
            );
            if (!result.source) {
                throw new ApiError(502, 'source_refresh_failed', 'The source refresh did not return a source.');
            }
            return result.source;
        },
    },

    plex: {
        config: () => request<PlexConfigDto>('/plex/config'),
        updateConfig: (input: SavePlexConfigInput) =>
            request<PlexConfigDto>('/plex/config', { method: 'PUT', body: JSON.stringify(input) }),
        libraries: () => request<PlexLibraryDto[]>('/plex/libraries'),
        setLibraryEnabled: (key: string, enabled: boolean) =>
            request<PlexLibraryDto[]>(`/plex/libraries/${encodeURIComponent(key)}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled }),
            }),
        items: (libraryKey: string, search: string) => {
            const params = new URLSearchParams({ library: libraryKey });
            if (search.trim()) params.set('search', search.trim());
            return request<PlexItemDto[]>(`/plex/items?${params.toString()}`);
        },
        item: (ratingKey: string) => request<PlexItemDetailDto>(`/plex/items/${encodeURIComponent(ratingKey)}`),
        children: (ratingKey: string) =>
            request<PlexItemDto[]>(`/plex/items/${encodeURIComponent(ratingKey)}/children`),
        queue: () => request<QueueItemDto[]>('/plex/queue'),
        enqueue: (input: EnqueueInput) =>
            request<QueueItemDto>('/plex/queue', { method: 'POST', body: JSON.stringify(input) }),
        remove: (id: number) => request<void>(`/plex/queue/${id}`, { method: 'DELETE' }),
        move: (id: number, direction: 'up' | 'down') =>
            request<QueueItemDto[]>(`/plex/queue/${id}/move`, {
                method: 'POST',
                body: JSON.stringify({ direction }),
            }),
        shuffle: () => request<QueueItemDto[]>('/plex/queue/shuffle', { method: 'POST' }),
        clear: () => request<void>('/plex/queue', { method: 'DELETE' }),
        play: (id: number, input: { guildId: string; voiceChannelId: string }) =>
            request<PlaybackStateDto>(`/plex/queue/${id}/play`, {
                method: 'POST',
                body: JSON.stringify(input),
            }),
        start: (input: StartPlexInput) =>
            request<PlaybackStateDto>('/plex/play', { method: 'POST', body: JSON.stringify(input) }),
        placeholder: (input: StartPlaceholderInput) =>
            request<PlaybackStateDto>('/plex/placeholder', { method: 'POST', body: JSON.stringify(input) }),
    },

    discord: {
        status: () => request<DiscordStatusDto>('/discord/status'),
        tokens: () => request<DiscordTokenState>('/discord/tokens'),
        saveTokens: (input: DiscordTokensInput) =>
            request<DiscordStatusDto>('/discord/tokens', { method: 'PUT', body: JSON.stringify(input) }),
        validate: () => request<DiscordStatusDto>('/discord/validate', { method: 'POST' }),
        reconnect: () => request<DiscordStatusDto>('/discord/reconnect', { method: 'POST' }),
        setRoles: (guildId: string, roleIds: string[]) =>
            request<GuildDto>(`/discord/guilds/${encodeURIComponent(guildId)}/roles`, {
                method: 'PUT',
                body: JSON.stringify({ roleIds }),
            }),
    },

    logs: {
        list: async (query: LogQuery): Promise<LogPage> => {
            const result = await request<{ lines: LogLineDto[] }>(`/logs?${logQueryString(query)}`);
            return { items: result.lines, total: result.lines.length };
        },
    },

    settings: {
        get: () => request<SettingsDto>('/settings'),
        update: (settings: SettingsDto) =>
            request<SettingsDto>('/settings', {
                method: 'PATCH',
                body: JSON.stringify({
                    stream: settings.stream,
                    plex: settings.plex,
                    auth: settings.auth,
                    ui: {
                        timezone: settings.timezone,
                        logLevel: settings.logLevel,
                        publicUrl: settings.publicUrl,
                        trustedOrigins: settings.trustedOrigins,
                    },
                }),
            }),
    },

    setup: {
        get: () => request<SetupStatusDto>('/setup/status'),
    },

    auth: {
        config: () => request<AuthConfig>('/auth/config'),
        enable: (input: EnableAuthInput) =>
            request<EnableAuthResult>('/auth/enable', {
                method: 'POST',
                body: JSON.stringify(input),
            }),
        session: () => request<AuthSession>('/auth/session'),
        login: (username: string, password: string) =>
            request<AuthSession>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            }),
        logout: () => request<void>('/auth/logout', { method: 'POST' }),
    },
};

export type LogLine = LogLineDto;
