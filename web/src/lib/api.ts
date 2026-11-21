import type {
    ChannelDto,
    DiscordStatusDto,
    GuildDto,
    LogLineDto,
    MediaHistoryDto,
    MediaItemDetailDto,
    MediaItemDto,
    MediaLibraryDto,
    MediaSourceDto,
    PlaybackStateDto,
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
    SaveMediaSourceInput,
    SaveSourceInput,
    StartMediaInput,
    StartPlaceholderInput,
    SubtitleMode,
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
        media: () => request<ChannelDto[]>('/channels/media'),
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

    media: {
        sources: () => request<MediaSourceDto[]>('/media/sources'),
        reorderSources: (ids: number[]) =>
            request<MediaSourceDto[]>('/media/sources/order', {
                method: 'POST',
                body: JSON.stringify({ ids }),
            }),
        createSource: (input: SaveMediaSourceInput) =>
            request<MediaSourceDto>('/media/sources', { method: 'POST', body: JSON.stringify(input) }),
        updateSource: (input: SaveMediaSourceInput) =>
            request<MediaSourceDto>(`/media/sources/${input.id}`, {
                method: 'PATCH',
                body: JSON.stringify(input),
            }),
        removeSource: (id: number) => request<void>(`/media/sources/${id}`, { method: 'DELETE' }),
        validateSource: (id: number) =>
            request<MediaSourceDto>(`/media/sources/${id}/validate`, { method: 'POST' }),
        libraries: (sourceId: number) =>
            request<MediaLibraryDto[]>(`/media/sources/${sourceId}/libraries`),
        setLibraryEnabled: (sourceId: number, key: string, enabled: boolean) =>
            request<MediaLibraryDto[]>(
                `/media/sources/${sourceId}/libraries/${encodeURIComponent(key)}`,
                { method: 'PATCH', body: JSON.stringify({ enabled }) }
            ),
        items: (sourceId: number, libraryKey: string, search: string) => {
            const params = new URLSearchParams({ library: libraryKey });
            if (search.trim()) params.set('search', search.trim());
            return request<MediaItemDto[]>(`/media/sources/${sourceId}/items?${params.toString()}`);
        },
        item: (sourceId: number, itemId: string) =>
            request<MediaItemDetailDto>(
                `/media/items/${sourceId}/${encodeURIComponent(itemId)}`
            ),
        children: (sourceId: number, itemId: string) =>
            request<MediaItemDto[]>(
                `/media/items/${sourceId}/${encodeURIComponent(itemId)}/children`
            ),
        queue: () => request<QueueItemDto[]>('/media/queue'),
        currentItem: () => request<MediaItemDetailDto | null>('/media/playback/item'),
        setSubtitle: (mode: SubtitleMode) =>
            request<{ ok: boolean; message: string }>('/media/playback/subtitle', {
                method: 'POST',
                body: JSON.stringify({ mode }),
            }),
        history: (limit = 12) => request<MediaHistoryDto[]>(`/media/history?limit=${limit}`),
        removeHistory: (id: number) => request<void>(`/media/history/${id}`, { method: 'DELETE' }),
        enqueue: (input: EnqueueInput) =>
            request<QueueItemDto>('/media/queue', { method: 'POST', body: JSON.stringify(input) }),
        remove: (id: number) => request<void>(`/media/queue/${id}`, { method: 'DELETE' }),
        move: (id: number, direction: 'up' | 'down') =>
            request<QueueItemDto[]>(`/media/queue/${id}/move`, {
                method: 'POST',
                body: JSON.stringify({ direction }),
            }),
        shuffle: () => request<QueueItemDto[]>('/media/queue/shuffle', { method: 'POST' }),
        clear: () => request<void>('/media/queue', { method: 'DELETE' }),
        play: (id: number, input: { guildId: string; voiceChannelId: string }) =>
            request<PlaybackStateDto>(`/media/queue/${id}/play`, {
                method: 'POST',
                body: JSON.stringify(input),
            }),
        start: (input: StartMediaInput) =>
            request<PlaybackStateDto>('/media/play', { method: 'POST', body: JSON.stringify(input) }),
        placeholder: (input: StartPlaceholderInput) =>
            request<PlaybackStateDto>(`/media/sources/${input.sourceId}/placeholder`, {
                method: 'POST',
                body: JSON.stringify({
                    guildId: input.guildId,
                    voiceChannelId: input.voiceChannelId,
                }),
            }),
        enqueueSeason: (input: {
            sourceId: number;
            seasonId: string;
            quality: string;
            subtitleMode: string | number;
        }) =>
            request<{ items: QueueItemDto[] }>('/media/queue/season', {
                method: 'POST',
                body: JSON.stringify(input),
            }),
        enqueueShow: (input: {
            sourceId: number;
            showId: string;
            quality: string;
            subtitleMode: string | number;
        }) =>
            request<{ items: QueueItemDto[] }>('/media/queue/show', {
                method: 'POST',
                body: JSON.stringify(input),
            }),
    },

    discord: {
        status: () => request<DiscordStatusDto>('/discord/status'),
        tokens: () => request<DiscordTokenState>('/discord/tokens'),
        saveTokens: (input: DiscordTokensInput) =>
            request<DiscordStatusDto>('/discord/tokens', { method: 'PUT', body: JSON.stringify(input) }),
        validate: () => request<DiscordStatusDto>('/discord/validate', { method: 'POST' }),
        reconnect: () => request<DiscordStatusDto>('/discord/reconnect', { method: 'POST' }),
        joinStreamer: (guildId?: string) =>
            request<DiscordStatusDto>('/discord/streamer/join', {
                method: 'POST',
                body: JSON.stringify(guildId ? { guildId } : {}),
            }),
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
                    playback: settings.playback,
                    auth: settings.auth,
                    ui: {
                        timezone: settings.timezone,
                        logLevel: settings.logLevel,
                        publicUrl: settings.publicUrl,
                        trustedOrigins: settings.trustedOrigins,
                    },
                }),
            }),
        updatePlayback: (playback: Partial<SettingsDto['playback']>) =>
            request<SettingsDto>('/settings', {
                method: 'PATCH',
                body: JSON.stringify({ playback }),
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
