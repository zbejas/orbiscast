import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
    ChannelDto,
    DiscordStatusDto,
    GuildDto,
    MediaHistoryDto,
    MediaItemDetailDto,
    MediaSourceDto,
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
    EnqueueSeasonInput,
    SaveSourceInput,
    StartMediaInput,
    StartPlaceholderInput,
    SubtitleMode,
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
    mediaSources: ['media', 'sources'] as const,
    mediaLibraries: (sourceId: number) => ['media', 'libraries', sourceId] as const,
    mediaItemsAll: ['media', 'items'] as const,
    mediaItems: (sourceId: number, libraryKey: string, search: string) =>
        ['media', 'items', sourceId, libraryKey, search] as const,
    mediaItem: (sourceId: number, itemId: string) => ['media', 'item', sourceId, itemId] as const,
    mediaChildren: (sourceId: number, itemId: string) =>
        ['media', 'children', sourceId, itemId] as const,
    mediaQueue: ['media', 'queue'] as const,
    mediaPlaybackItem: ['media', 'playbackItem'] as const,
    mediaHistoryAll: ['media', 'history'] as const,
    mediaHistory: (limit: number) => ['media', 'history', limit] as const,
    mediaChannels: ['media', 'channels'] as const,
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

export function useMediaSources() {
    return useQuery({
        queryKey: qk.mediaSources,
        queryFn: () => api.media.sources(),
        staleTime: 20_000,
    });
}

export function useCreateMediaSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: Parameters<typeof api.media.createSource>[0]) =>
            api.media.createSource(input),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.mediaSources });
            client.invalidateQueries({ queryKey: qk.mediaChannels });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useReorderMediaSources() {
    const client = useQueryClient();
    return useMutation<MediaSourceDto[], Error, number[], { previous?: MediaSourceDto[] }>({
        mutationFn: (ids: number[]) => api.media.reorderSources(ids),
        onMutate: async (ids) => {
            await client.cancelQueries({ queryKey: qk.mediaSources });
            const previous = client.getQueryData<MediaSourceDto[]>(qk.mediaSources);
            client.setQueryData<MediaSourceDto[]>(qk.mediaSources, (current) => {
                if (!current) return current;
                const byId = new Map(current.map((source) => [source.id, source]));
                const ordered = ids
                    .map((id) => byId.get(id))
                    .filter((source): source is MediaSourceDto => Boolean(source));
                const known = new Set(ids);
                return [...ordered, ...current.filter((source) => !known.has(source.id))];
            });
            return { previous };
        },
        onError: (_error, _ids, context) => {
            if (context?.previous) {
                client.setQueryData(qk.mediaSources, context.previous);
            }
        },
        onSuccess: (sources) => {
            client.setQueryData(qk.mediaSources, sources);
        },
        onSettled: () => {
            client.invalidateQueries({ queryKey: qk.mediaSources });
            client.invalidateQueries({ queryKey: qk.mediaChannels });
        },
    });
}

export function useUpdateMediaSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: Parameters<typeof api.media.updateSource>[0]) =>
            api.media.updateSource(input),
        onSuccess: (source) => {
            client.setQueryData<MediaSourceDto[]>(qk.mediaSources, (current) =>
                current?.map((entry) => (entry.id === source.id ? source : entry))
            );
            client.invalidateQueries({ queryKey: qk.mediaSources });
            client.invalidateQueries({ queryKey: qk.mediaLibraries(source.id) });
            client.invalidateQueries({ queryKey: qk.mediaChannels });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useDeleteMediaSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.media.removeSource(id),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.mediaSources });
            client.invalidateQueries({ queryKey: qk.mediaChannels });
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useValidateMediaSource() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.media.validateSource(id),
        onSuccess: (source) => {
            client.setQueryData<MediaSourceDto[]>(qk.mediaSources, (current) =>
                current?.map((entry) => (entry.id === source.id ? source : entry))
            );
            client.invalidateQueries({ queryKey: qk.mediaLibraries(source.id) });
            client.invalidateQueries({ queryKey: qk.setup });
        },
    });
}

export function useMediaChannels() {
    return useQuery({
        queryKey: qk.mediaChannels,
        queryFn: () => api.channels.media(),
        staleTime: 20_000,
    });
}

export function useMediaLibraries(sourceId: number) {
    return useQuery({
        queryKey: qk.mediaLibraries(sourceId),
        queryFn: () => api.media.libraries(sourceId),
        staleTime: 30_000,
        enabled: sourceId > 0,
    });
}

export function useSetMediaLibrary() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            sourceId,
            key,
            enabled,
        }: {
            sourceId: number;
            key: string;
            enabled: boolean;
        }) => api.media.setLibraryEnabled(sourceId, key, enabled),
        onSuccess: (libraries, variables) => {
            client.setQueryData(qk.mediaLibraries(variables.sourceId), libraries);
            client.invalidateQueries({ queryKey: qk.mediaItemsAll });
            client.invalidateQueries({ queryKey: qk.mediaSources });
        },
    });
}

export function useMediaItems(sourceId: number, libraryKey: string, search: string) {
    return useQuery({
        queryKey: qk.mediaItems(sourceId, libraryKey, search),
        queryFn: () => api.media.items(sourceId, libraryKey, search),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        enabled: sourceId > 0 && libraryKey.length > 0,
    });
}

export function useMediaItem(sourceId: number, itemId: string | null) {
    return useQuery({
        queryKey: qk.mediaItem(sourceId, itemId ?? ''),
        queryFn: () => api.media.item(sourceId, itemId ?? ''),
        enabled: sourceId > 0 && Boolean(itemId),
        staleTime: 60_000,
    });
}

export function useMediaChildren(sourceId: number, itemId: string | null) {
    return useQuery({
        queryKey: qk.mediaChildren(sourceId, itemId ?? ''),
        queryFn: () => api.media.children(sourceId, itemId ?? ''),
        enabled: sourceId > 0 && Boolean(itemId),
        staleTime: 60_000,
    });
}

export function useMediaQueue() {
    return useQuery({
        queryKey: qk.mediaQueue,
        queryFn: () => api.media.queue(),
        staleTime: 5_000,
    });
}

/**
 * Recently played media with saved resume progress.
 *
 * @param limit - Maximum number of entries
 */
export function useMediaHistory(limit = 12) {
    return useQuery<MediaHistoryDto[]>({
        queryKey: qk.mediaHistory(limit),
        queryFn: () => api.media.history(limit),
        staleTime: 15_000,
    });
}

export function useRemoveMediaHistory() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.media.removeHistory(id),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.mediaHistoryAll }),
    });
}

/**
 * Loads the streams of the item that is currently playing.
 *
 * @param enabled - Only fetch while a media item is active
 */
export function useCurrentMediaItem(enabled: boolean, queueItemId: number | null) {
    return useQuery<MediaItemDetailDto | null>({
        queryKey: [...qk.mediaPlaybackItem, queueItemId],
        queryFn: () => api.media.currentItem(),
        enabled: enabled && queueItemId !== null,
        staleTime: 10_000,
    });
}

export function useSetSubtitle() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (mode: SubtitleMode) => api.media.setSubtitle(mode),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: qk.mediaQueue });
            void client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
            void client.invalidateQueries({ queryKey: qk.mediaPlaybackItem });
            void client.invalidateQueries({ queryKey: qk.playback });
        },
    });
}

export function useUpdatePlaybackPreferences() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (playback: Partial<SettingsDto['playback']>) =>
            api.settings.updatePlayback(playback),
        onSuccess: (settings) => {
            client.setQueryData(qk.settings, settings);
        },
    });
}

export function useUpdateRecentVoiceChannels() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (channels: SettingsDto['recentVoiceChannels']) =>
            api.settings.updateRecentVoiceChannels(channels),
        onSuccess: (settings) => {
            client.setQueryData(qk.settings, settings);
        },
    });
}

export function useDiscordStatus() {
    return useQuery<DiscordStatusDto>({
        queryKey: qk.discord,
        queryFn: source(mockApi.getDiscordStatus, api.discord.status),
        staleTime: 15_000,
        refetchInterval: (query) => (query.state.data?.streamerJoin.state === 'joining' ? 2_000 : 60_000),
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
            client.invalidateQueries({ queryKey: qk.mediaSources });
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
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
    });
}

export function useSkipPlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.skipPlayback() : api.playback.skip()),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
    });
}

export function usePausePlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.pausePlayback() : api.playback.pause()),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
    });
}

export function useResumePlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => (USE_MOCK ? mockApi.resumePlayback() : api.playback.resume()),
        onSuccess: (playback) => client.setQueryData(qk.playback, playback),
    });
}

export function useSeekPlayback() {
    const client = useQueryClient();
    return useMutation<PlaybackStateDto, Error, number, { previous?: PlaybackStateDto }>({
        mutationFn: (seconds: number) =>
            USE_MOCK ? mockApi.seekPlayback(seconds) : api.playback.seek(seconds),
        onMutate: async (seconds) => {
            await client.cancelQueries({ queryKey: qk.playback });
            const previous = client.getQueryData<PlaybackStateDto>(qk.playback);
            if (previous) {
                client.setQueryData<PlaybackStateDto>(qk.playback, {
                    ...previous,
                    positionMs: seconds * 1000,
                    positionUpdatedAt: Date.now(),
                    paused: false,
                });
            }
            return { previous };
        },
        onError: (_error, _seconds, context) => {
            if (context?.previous) {
                client.setQueryData(qk.playback, context.previous);
            }
        },
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
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
        mutationFn: (input: SaveSourceInput) =>
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
        mutationFn: (input: EnqueueInput) => api.media.enqueue(input),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.mediaQueue });
        },
    });
}

export function useEnqueueSeason() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: EnqueueSeasonInput) => api.media.enqueueSeason(input),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.mediaQueue });
        },
    });
}

export function useRemoveQueueItem() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.media.remove(id),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.mediaQueue }),
    });
}

export function useMoveQueueItem() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ id, direction }: { id: number; direction: 'up' | 'down' }) =>
            api.media.move(id, direction),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.mediaQueue }),
    });
}

export function useShuffleQueue() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api.media.shuffle(),
        onSuccess: () => client.invalidateQueries({ queryKey: qk.mediaQueue }),
    });
}

export function useClearQueue() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api.media.clear(),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: qk.mediaQueue });
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
        }) => api.media.play(id, { guildId, voiceChannelId }),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
    });
}

export function useStartMediaPlayback() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: StartMediaInput) => api.media.start(input),
        onSuccess: (playback) => {
            client.setQueryData(qk.playback, playback);
            client.invalidateQueries({ queryKey: qk.mediaQueue });
            client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
        },
    });
}

export function useStartPlaceholder() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (input: StartPlaceholderInput) => api.media.placeholder(input),
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

export function useJoinStreamer() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (guildId?: string) =>
            USE_MOCK ? mockApi.joinStreamer(guildId) : api.discord.joinStreamer(guildId),
        onSuccess: (status) => {
            client.setQueryData(qk.discord, status);
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
