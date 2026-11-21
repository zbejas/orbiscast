import type {
    ChannelDto,
    DiscordStatusDto,
    PlaybackStateDto,
    ProgrammeDto,
    SettingsDto,
    SetupStatusDto,
    SourceDto,
} from '@shared/types';
import { ApiError } from './api';
import type {
    AuthConfig,
    AuthSession,
    ChannelPage,
    ChannelQuery,
    DiscordTokenState,
    DiscordTokensInput,
    EnableAuthInput,
    EnableAuthResult,
    GuideResponse,
    LogPage,
    LogQuery,
    SaveSourceInput,
} from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const BOOT = Date.now();

const source: SourceDto = {
    id: 1,
    name: 'Demo IPTV',
    playlistUrl: 'https://example.net/demo.m3u',
    xmltvUrl: 'https://example.net/demo.xml',
    enabled: true,
    refreshMinutes: 60,
    lastRefreshedAt: BOOT - 20 * MINUTE,
    lastError: null,
    channelCount: 3,
    visibleCount: 2,
    refreshing: false,
};

const channels: ChannelDto[] = [
    {
        id: 1,
        sourceId: 1,
        sourceName: source.name,
        name: 'Demo News',
        logo: null,
        group: 'News',
        tvgId: 'demo.news',
        visible: true,
        kind: 'iptv',
        nowPlaying: 'Morning Brief',
        next: 'World at Six',
    },
    {
        id: 2,
        sourceId: 1,
        sourceName: source.name,
        name: 'Demo Movies',
        logo: null,
        group: 'Movies',
        tvgId: 'demo.movies',
        visible: true,
        kind: 'iptv',
        nowPlaying: 'The Long Read',
        next: 'Night Desk',
    },
    {
        id: 3,
        sourceId: 1,
        sourceName: source.name,
        name: 'Demo Sport',
        logo: null,
        group: 'Sports',
        tvgId: 'demo.sport',
        visible: false,
        kind: 'iptv',
        nowPlaying: null,
        next: null,
    },
];

const programmes: ProgrammeDto[] = channels.map(channel => ({
    id: channel.id,
    sourceId: 1,
    channelTvgId: channel.tvgId ?? '',
    title: channel.nowPlaying ?? 'Programme',
    description: 'Demo guide data for local WebUI development.',
    start: Math.floor((Date.now() - HOUR) / 1000),
    stop: Math.floor((Date.now() + HOUR) / 1000),
    category: channel.group,
}));

let settings: SettingsDto = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    logLevel: 'info',
    publicUrl: '',
    trustedOrigins: [],
    stream: {
        bitrateVideo: 5000,
        bitrateVideoMax: 7500,
        minimizeLatency: true,
        disableTranscode: false,
        defaultStreamTimeout: 10,
    },
    playback: {
        autoplayNextEpisode: false,
        autoSkipIntro: false,
    },
    auth: { enabled: false },
};

let playback: PlaybackStateDto = {
    mode: 'idle',
    title: null,
    subtitle: null,
    posterUrl: null,
    guildId: null,
    guildName: null,
    voiceChannelId: null,
    voiceChannelName: null,
    startedAt: null,
    positionMs: null,
    durationMs: null,
    positionUpdatedAt: null,
    viewers: 0,
    paused: false,
    queueItemId: null,
    sourceId: null,
    sourceName: null,
    sourceKind: null,
};

const discordStatus: DiscordStatusDto = {
    bot: 'online',
    streamer: 'online',
    botTag: 'OrbisCast#0001',
    streamerTag: 'OrbisCast Viewer',
    error: null,
    botInviteUrl:
        'https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot+applications.commands&permissions=3230721',
    streamerGuildIds: ['demo-guild'],
    streamerJoin: {
        state: 'joined',
        guildId: null,
        guildName: null,
        fallbackInviteUrl: null,
        error: null,
    },
    guilds: [
        {
            id: 'demo-guild',
            name: 'Demo Guild',
            iconUrl: null,
            allowedRoleIds: [],
            roles: [],
            voiceChannels: [
                { id: 'demo-voice', name: 'General', guildId: 'demo-guild' },
                { id: 'demo-voice-2', name: 'Cinema', guildId: 'demo-guild' },
            ],
        },
    ],
};

function filteredChannels(query: ChannelQuery): ChannelPage {
    const search = query.search.trim().toLowerCase();
    const items = channels.filter(channel => {
        if (search && !channel.name.toLowerCase().includes(search)) return false;
        if (query.group !== 'all' && channel.group !== query.group) return false;
        if (query.visibility === 'visible' && !channel.visible) return false;
        if (query.visibility === 'hidden' && channel.visible) return false;
        return true;
    });
    return {
        items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        total: items.length,
        page: query.page,
        pageSize: query.pageSize,
        visibleTotal: channels.filter(channel => channel.visible).length,
        totalAll: channels.length,
        groups: [...new Set(channels.map(channel => channel.group).filter((group): group is string => Boolean(group)))],
    };
}

function idlePlayback(): PlaybackStateDto {
    return {
        ...playback,
        mode: 'idle',
        title: null,
        subtitle: null,
        posterUrl: null,
        guildId: null,
        guildName: null,
        voiceChannelId: null,
        voiceChannelName: null,
        startedAt: null,
        positionMs: null,
        durationMs: null,
        positionUpdatedAt: null,
        paused: false,
        queueItemId: null,
        sourceId: null,
        sourceName: null,
        sourceKind: null,
    };
}

export const mockApi = {
    getPlayback: async () => playback,
    stopPlayback: async () => {
        playback = idlePlayback();
        return playback;
    },
    skipPlayback: async () => playback,
    pausePlayback: async () => {
        playback = { ...playback, paused: true };
        return playback;
    },
    resumePlayback: async () => {
        playback = { ...playback, paused: false };
        return playback;
    },
    seekPlayback: async (seconds: number) => {
        playback = { ...playback, positionMs: seconds * 1000, positionUpdatedAt: Date.now() };
        return playback;
    },

    getSources: async () => [source],
    createSource: async (input: Omit<SaveSourceInput, 'id'>) => ({
        ...source,
        ...input,
        xmltvUrl: input.xmltvUrl ?? null,
        id: source.id + 1,
        channelCount: 0,
        visibleCount: 0,
        lastRefreshedAt: null,
        lastError: null,
        refreshing: false,
    }),
    updateSource: async (input: SaveSourceInput) => ({ ...source, ...input }),
    deleteSource: async (_id: number) => undefined,
    refreshSource: async (_id: number) => source,

    getChannels: async (query: ChannelQuery) => filteredChannels(query),
    setChannelVisible: async (id: number, visible: boolean) => {
        const channel = channels.find(item => item.id === id);
        if (!channel) throw new ApiError(404, 'not_found', 'Channel not found');
        channel.visible = visible;
        return channel;
    },
    setBulkChannelVisible: async (ids: number[], visible: boolean) => {
        for (const channel of channels) {
            if (ids.includes(channel.id)) channel.visible = visible;
        }
        return { updated: ids.length };
    },
    getGuide: async (_day: string): Promise<GuideResponse> => {
        const dayStart = new Date(`${_day}T00:00:00`).getTime();
        return {
            dayStart,
            dayEnd: dayStart + 24 * HOUR,
            channels: channels.filter(channel => channel.visible),
            programmes,
        };
    },

    getDiscordStatus: async () => discordStatus,
    getDiscordTokens: async (): Promise<DiscordTokenState> => ({
        botTokenSet: true,
        userTokenSet: true,
        botLast4: '0001',
        userLast4: '0002',
    }),
    saveDiscordTokens: async (_input: DiscordTokensInput) => discordStatus,
    validateDiscord: async () => discordStatus,
    reconnectDiscord: async () => discordStatus,
    joinStreamer: async (_guildId?: string) => discordStatus,
    setGuildRoles: async (guildId: string, roleIds: string[]) => {
        const guild = discordStatus.guilds.find(item => item.id === guildId);
        if (!guild) throw new ApiError(404, 'not_found', 'Guild not found');
        guild.allowedRoleIds = roleIds;
        return guild;
    },

    getLogs: async (_query: LogQuery): Promise<LogPage> => ({
        items: [
            {
                id: 1,
                timestamp: Date.now(),
                level: 'info',
                message: 'Mock mode is enabled. Media sources require the real API.',
            },
        ],
        total: 1,
    }),

    getSettings: async () => settings,
    updateSettings: async (next: SettingsDto) => {
        settings = next;
        return settings;
    },
    getSetup: async (): Promise<SetupStatusDto> => ({
        needsSetup: false,
        discordConfigured: true,
        discordValid: true,
        guildReady: true,
        botInviteUrl: discordStatus.botInviteUrl,
        sourcesConfigured: true,
        mediaConfigured: false,
        mediaValid: false,
        authEnabled: false,
    }),

    getAuthConfig: async (): Promise<AuthConfig> => ({ enabled: false, hasUser: false }),
    getSession: async (): Promise<AuthSession> => ({ user: null }),
    login: async (_username: string, _password: string): Promise<AuthSession> => ({ user: null }),
    logout: async () => undefined,
    enableAuth: async (_input: EnableAuthInput): Promise<EnableAuthResult> => ({
        enabled: true,
        createdAdmin: true,
    }),
};

/** One synthetic log line for the mock live-log feed. */
export function createMockLogLine() {
    return {
        id: Date.now(),
        timestamp: Date.now(),
        level: 'info',
        message: 'Mock mode is enabled. Media sources require the real API.',
    };
}
