import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
    ChannelDto,
    DiscordStatusDto,
    GuildDto,
    PlaybackStateDto,
    SettingsDto,
    SetupStatusDto,
    SourceDto,
} from '@shared/types';
import { api } from './api';
import { mockApi } from './mock';
import type {
    AuthSession,
    ChannelPage,
    ChannelQuery,
    DiscordTokensInput,
    EnableAuthInput,
    EnqueueInput,
    StartPlaceholderInput,
    StartPlexInput,
} from './types';

export const USE_MOCK = (import.meta.env.VITE_API_MOCKS ?? 'false') === 'true';

function source<T>(mock: () => Promise<T>, live: () => Promise<T>): () => Promise<T> {
    return USE_MOCK ? mock : live;
}

export const qk = {
    playback: ['playback'] as const,
    sources: ['sources'] as const,
    channelsAll: ['channels'] as const,
    channels: (query: ChannelQuery) => ['channels', query] as const,
    guide: (day: string) => ['guide', day] as const,
    logs: (level: string, search: string, limit: number) => ['logs', level, search, limit] as const,
    plexConfig: ['plex', 'config'] as const,
    plexLibraries: ['plex', 'libraries'] as const,
    plexItemsAll: ['plex', 'items'] as const,
    plexItems: (libraryKey: string, search: string) => ['plex', 'items', libraryKey, search] as const,
    plexItem: (ratingKey: string) => ['plex', 'item', ratingKey] as const,
    plexChildren: (ratingKey: string) => ['plex', 'children', ratingKey] as const,
    plexQueue: ['plex', 'queue'] as const,
    discord: ['discord', 'status'] as const,
    discordTokens: ['discord', 'tokens'] as const,
    settings: ['settings'] as const,
    setup: ['setup'] as const,
    authConfig: ['auth', 'config'] as const,
    session: ['auth', 'session'] as const,
};

export function usePlayback() {
    return useQuery({
        queryKey: qk.playback,
        queryFn: source(mockApi.getPlayback, api.playback.get),
        staleTime: 5_000,
        refetchInterval: 30_000,
    });
}

export function useSources() {
    return useQuery({
        queryKey: qk.sources,
        queryFn: source(mockApi.getSources, api.sources.list),
        staleTime: 10_000,
    });
}

export function useChannels(query: ChannelQuery) {
    return useQuery({
        queryKey: qk.channels(query),
        queryFn: source(
            () => mockApi.getChannels(query),
            () => api.channels.list(query)
        ),
        placeholderData: keepPreviousData,
        staleTime: 5_000,
    });
}

export function useGuide(day: string) {
    return useQuery({
        queryKey: qk.guide(day),
        queryFn: source(
            () => mockApi.getGuide(day),
            () => api.guide.get(day)
        ),
        staleTime: 60_000,
    });
}

export function usePlexConfig() {
    return useQuery({
        queryKey: qk.plexConfig,
        queryFn: source(mockApi.getPlexConfig, api.plex.config),
        staleTime: 30_000,
    });
}

export function useSavePlexConfig() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: { serverUrl: string; token?: string }) =>
            USE_MOCK ? mockApi.savePlexConfig(input) : api.plex.updateConfig(input),
        onSuccess: (config) => {
            client.setQueryData(qk.plexConfig, config);
            client.invalidateQueries({ queryKey: qk.plexLibraries });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function usePlexLibraries() {
    return useQuery({
        queryKey: qk.plexLibraries,
        queryFn: source(mockApi.getPlexLibraries, api.plex.libraries),
        staleTime: 60_000,
    });
}

export function useSetPlexLibrary() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
            USE_MOCK
                ? mockApi.setPlexLibraryEnabled(key, enabled)
                : api.plex.setLibraryEnabled(key, enabled),
        onSuccess: (libraries) => {
            client.setQueryData(qk.plexLibraries, libraries);
            client.invalidateQueries({ queryKey: qk.plexItemsAll });
        },
    });
}

export function usePlexItems(libraryKey: string, search: string) {
    return useQuery({
        queryKey: qk.plexItems(libraryKey, search),
        queryFn: source(
            () => mockApi.getPlexItems(libraryKey, search),
            () => api.plex.items(libraryKey, search)
        ),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        enabled: libraryKey.length > 0,
    });
}

export function usePlexItem(ratingKey: string | null) {
    return useQuery({
        queryKey: qk.plexItem(ratingKey ?? ''),
        queryFn: source(
            () => mockApi.getPlexItem(ratingKey ?? ''),
            () => api.plex.item(ratingKey ?? '')
        ),
        enabled: Boolean(ratingKey),
        staleTime: 60_000,
    });
}

export function usePlexChildren(ratingKey: string | null) {
    return useQuery({
        queryKey: qk.plexChildren(ratingKey ?? ''),
        queryFn: source(
            () => mockApi.getPlexChildren(ratingKey ?? ''),
            () => api.plex.children(ratingKey ?? '')
        ),
        enabled: Boolean(ratingKey),
        staleTime: 60_000,
    });
}

export function usePlexQueue() {
    return useQuery({
        queryKey: qk.plexQueue,
        queryFn: source(mockApi.getQueue, api.plex.queue),
        staleTime: 5_000,
    });
}

export function useDiscordStatus() {
    return useQuery({
        queryKey: qk.discord,
        queryFn: source(mockApi.getDiscordStatus, api.discord.status),
        staleTime: 15_000,
        refetchInterval: 60_000,
    });
}

export function useDiscordTokens() {
    return useQuery({
        queryKey: qk.discordTokens,
        queryFn: source(mockApi.getDiscordTokens, api.discord.tokens),
        staleTime: 60_000,
    });
}

export function useLogs(limit = 250) {
    return useQuery({
        queryKey: qk.logs('all', '', limit),
        queryFn: source(
            () => mockApi.getLogs({ level: 'all', search: '', limit }),
            () => api.logs.list({ level: 'all', search: '', limit })
        ),
        staleTime: 5_000,
    });
}

export function useSettings() {
    return useQuery({
        queryKey: qk.settings,
        queryFn: source(mockApi.getSettings, api.settings.get),
        staleTime: 30_000,
    });
}

export function useSetup() {
    return useQuery({
        queryKey: qk.setup,
        queryFn: source(mockApi.getSetup, api.setup.get),
        staleTime: 10_000,
    });
}

export function useSession() {
    return useQuery({
        queryKey: qk.session,
        queryFn: source(mockApi.getSession, api.auth.session),
        staleTime: 30_000,
    });
}

export function useAuthConfig() {
    return useQuery({
        queryKey: qk.authConfig,
        queryFn: source(mockApi.getAuthConfig, api.auth.config),
        staleTime: 30_000,
    });
}

export function useEnableAuth() {
    return useMutation({
        mutationFn: (input: EnableAuthInput) =>
            USE_MOCK ? mockApi.enableAuth(input) : api.auth.enable(input),
    });
}

export function useUpdateSettings() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (settings: SettingsDto) =>
            USE_MOCK ? mockApi.updateSettings(settings) : api.settings.update(settings),
        onSuccess: (settings) => {
            client.setQueryData(qk.settings, settings);
            client.invalidateQueries({ queryKey: qk.setup });
            client.invalidateQueries({ queryKey: qk.plexConfig });
            client.invalidateQueries({ queryKey: qk.playback });
            client.invalidateQueries({ queryKey: qk.authConfig });
        },
    });
}

export function useStopPlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.stopPlayback() : api.playback.stop()),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.plexQueue });
        },
    });
}

export function useSkipPlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.skipPlayback() : api.playback.skip()),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.plexQueue });
        },
    });
}

export function usePausePlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.pausePlayback() : api.playback.pause()),
        onSuccess: (playback) => client.setQueryData(qk.playback, playback),
    });
}

export function useResumePlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.resumePlayback() : api.playback.resume()),
        onSuccess: (playback) => client.setQueryData(qk.playback, playback),
    });
}

export function useSetChannelVisibility() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ id, visible }: { id: number; visible: boolean }) =>
            USE_MOCK ? mockApi.setChannelVisible(id, visible) : api.channels.setVisible(id, visible),
        onMutate: async ({ id, visible }) => {
            await client.cancelQueries({ queryKey: qk.channelsAll });
            const snapshots = client.getQueriesData<ChannelPage>({ queryKey: qk.channelsAll });
            client.setQueriesData<ChannelPage>({ queryKey: qk.channelsAll }, (current) => {
                if (!current) return current;
                const target = current.items.find((channel) => channel.id === id);
                if (!target || target.visible === visible) return current;
                const delta = visible ? 1 : -1;
                return {
                    ...current,
                    items: current.items.map((channel) =>
                        channel.id === id ? { ...channel, visible } : channel
                    ),
                    visibleTotal: Math.max(0, current.visibleTotal + delta),
                };
            });
            return { snapshots };
        },
        onError: (_error, _variables, context) => {
            for (const [key, data] of context?.snapshots ?? []) {
                client.setQueryData(key, data);
            }
        },
        onSettled: () => {
            client.invalidateQueries({ queryKey: qk.channelsAll });
            client.invalidateQueries({ queryKey: qk.sources });
            client.invalidateQueries({ queryKey: ['guide'] });
        },
    });
}

export function useBulkChannelVisibility() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ ids, visible }: { ids: number[]; visible: boolean }) =>
            USE_MOCK ? mockApi.setBulkChannelVisible(ids, visible) : api.channels.setBulkVisible(ids, visible),
        onMutate: async ({ ids, visible }) => {
            await client.cancelQueries({ queryKey: qk.channelsAll });
            const idSet = new Set(ids);
            const snapshots = client.getQueriesData<ChannelPage>({ queryKey: qk.channelsAll });
            client.setQueriesData<ChannelPage>({ queryKey: qk.channelsAll }, (current) => {
                if (!current) return current;
                let changed = 0;
                const items = current.items.map((channel) => {
                    if (!idSet.has(channel.id) || channel.visible === visible) return channel;
                    changed += 1;
                    return { ...channel, visible };
                });
                if (changed === 0) return current;
                return {
                    ...current,
                    items,
                    visibleTotal: Math.max(0, current.visibleTotal + (visible ? changed : -changed)),
                };
            });
            return { snapshots };
        },
        onError: (_error, _variables, context) => {
            for (const [key, data] of context?.snapshots ?? []) {
                client.setQueryData(key, data);
            }
        },
        onSettled: () => {
            client.invalidateQueries({ queryKey: qk.channelsAll });
            client.invalidateQueries({ queryKey: qk.sources });
            client.invalidateQueries({ queryKey: ['guide'] });
        },
    });
}

export function useSaveSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: Parameters<typeof mockApi.createSource>[0]) =>
            USE_MOCK
                ? input.id
                    ? mockApi.updateSource(input)
                    : mockApi.createSource(input)
                : input.id
                  ? api.sources.update(input)
                  : api.sources.create(input),
        onSuccess: (saved) => {
            client.setQueryData<SourceDto[]>(qk.sources, (current) => {
                if (!current) return current;
                const exists = current.some((source) => source.id === saved.id);
                return exists ? current.map((source) => (source.id === saved.id ? saved : source)) : [...current, saved];
            });
            client.invalidateQueries({ queryKey: qk.channelsAll });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useDeleteSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => (USE_MOCK ? mockApi.deleteSource(id) : api.sources.remove(id)),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.sources });
            client.invalidateQueries({ queryKey: qk.channelsAll });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useRefreshSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => (USE_MOCK ? mockApi.refreshSource(id) : api.sources.refresh(id)),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.sources });
            client.invalidateQueries({ queryKey: qk.channelsAll });
        },
    });
}

export function useSetSourceEnabled() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ source, enabled }: { source: SourceDto; enabled: boolean }) =>
            USE_MOCK
                ? mockApi.updateSource({
                      id: source.id,
                      name: source.name,
                      playlistUrl: source.playlistUrl,
                      xmltvUrl: source.xmltvUrl,
                      refreshMinutes: source.refreshMinutes,
                      enabled,
                  })
                : api.sources.update({
                      id: source.id,
                      name: source.name,
                      playlistUrl: source.playlistUrl,
                      xmltvUrl: source.xmltvUrl,
                      refreshMinutes: source.refreshMinutes,
                      enabled,
                  }),
        onMutate: async ({ source, enabled }) => {
            await client.cancelQueries({ queryKey: qk.sources });
            const previous = client.getQueryData<SourceDto[]>(qk.sources);
            client.setQueryData<SourceDto[]>(qk.sources, (current) =>
                current?.map((entry) => (entry.id === source.id ? { ...entry, enabled } : entry))
            );
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) client.setQueryData(qk.sources, context.previous);
        },
        onSettled: () => {
            client.invalidateQueries({ queryKey: qk.sources });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useEnqueue() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: EnqueueInput) => (USE_MOCK ? mockApi.enqueue(input) : api.plex.enqueue(input)),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.plexQueue });
        },
    });
}

export function useRemoveQueueItem() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => (USE_MOCK ? mockApi.removeQueueItem(id) : api.plex.remove(id)),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.plexQueue }),
    });
}

export function useMoveQueueItem() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ id, direction }: { id: number; direction: 'up' | 'down' }) =>
            USE_MOCK ? mockApi.moveQueueItem(id, direction) : api.plex.move(id, direction),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.plexQueue }),
    });
}

export function useShuffleQueue() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.shuffleQueue() : api.plex.shuffle()),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.plexQueue }),
    });
}

export function useClearQueue() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.clearQueue() : api.plex.clear()),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.plexQueue });
            client.invalidateQueries({ queryKey: qk.playback });
        },
    });
}

export function usePlayQueueItem() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            guildId,
            voiceChannelId,
        }: {
            id: number;
            guildId: string;
            voiceChannelId: string;
        }) =>
            USE_MOCK
                ? mockApi.playQueueItem(id, guildId, voiceChannelId)
                : api.plex.play(id, { guildId, voiceChannelId }),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.plexQueue });
        },
    });
}

export function useStartPlexPlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: StartPlexInput) =>
            USE_MOCK ? mockApi.startPlex(input) : api.plex.start(input),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.plexQueue });
        },
    });
}

export function useStartPlaceholder() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: StartPlaceholderInput) =>
            USE_MOCK ? mockApi.startPlaceholder(input) : api.plex.placeholder(input),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
        },
    });
}

export function useSaveDiscordTokens() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: DiscordTokensInput) =>
            USE_MOCK ? mockApi.saveDiscordTokens(input) : api.discord.saveTokens(input),
        onSuccess: (status) => {
            client.setQueryData(qk.discord, status);
            client.invalidateQueries({ queryKey: qk.discordTokens });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useValidateDiscord() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.validateDiscord() : api.discord.validate()),
        onSuccess: (status) => {
            client.setQueryData(qk.discord, status);
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useReconnectDiscord() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.reconnectDiscord() : api.discord.reconnect()),
        onSuccess: (status) => {
            client.setQueryData(qk.discord, status);
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useSetGuildRoles() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ guildId, roleIds }: { guildId: string; roleIds: string[] }) =>
            USE_MOCK ? mockApi.setGuildRoles(guildId, roleIds) : api.discord.setRoles(guildId, roleIds),
        onMutate: async ({ guildId, roleIds }) => {
            await client.cancelQueries({ queryKey: qk.discord });
            const previous = client.getQueryData<DiscordStatusDto>(qk.discord);
            client.setQueryData<DiscordStatusDto>(qk.discord, (current) => {
                if (!current) return current;
                return {
                    ...current,
                    guilds: current.guilds.map((guild) =>
                        guild.id === guildId ? { ...guild, allowedRoleIds: roleIds } : guild
                    ),
                };
            });
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) client.setQueryData(qk.discord, context.previous);
        },
        onSettled: () => {
            client.invalidateQueries({ queryKey: qk.discord });
        },
    });
}

export function useLogin() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ username, password }: { username: string; password: string }): Promise<AuthSession> =>
            USE_MOCK ? mockApi.login(username, password) : api.auth.login(username, password),
        onSuccess: (session) => {
            client.setQueryData(qk.session, session);
        },
    });
}

export function useLogout() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.logout() : api.auth.logout()),
        onSuccess: () => {
            client.setQueryData<AuthSession>(qk.session, { user: null });
            client.invalidateQueries({ queryKey: qk.session });
        },
    });
}

export function useNow(intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(timer);
    }, [intervalMs]);
    return now;
}

export function usePageTitle(title: string): void {
    useEffect(() => {
        document.title = `${title} · OrbisCast`;
    }, [title]);
}

export type { GuildDto, PlaybackStateDto, SetupStatusDto, SourceDto, ChannelDto };
