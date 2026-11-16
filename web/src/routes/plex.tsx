import { useDeferredValue, useEffect, useState } from 'react';
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Film,
    Library,
    ListOrdered,
    ListPlus,
    MonitorPlay,
    Pause,
    Play,
    Search,
    Shuffle,
    SkipForward,
    Square,
    Trash,
    X,
} from 'lucide-react';
import { Link } from 'react-router';
import type {
    GuildDto,
    PlexItemDetailDto,
    PlexItemDto,
    PlexLibraryDto,
    PlexQuality,
    QueueItemDto,
} from '@shared/types';
import {
    Button,
    ConfirmDialog,
    Dialog,
    EmptyState,
    ErrorState,
    Field,
    IconButton,
    Input,
    Notice,
    PageHeader,
    Poster,
    ProgressBar,
    Select,
    Skeleton,
    StatusPill,
    Switch,
    Tabs,
    buttonStyles,
    useToast,
} from '@/components';
import {
    useClearQueue,
    useDiscordStatus,
    useEnqueue,
    useMoveQueueItem,
    usePausePlayback,
    usePlayback,
    usePlayQueueItem,
    usePlexChildren,
    usePlexConfig,
    usePlexItem,
    usePlexItems,
    usePlexLibraries,
    usePlexQueue,
    useRemoveQueueItem,
    useResumePlayback,
    useSetPlexLibrary,
    useShuffleQueue,
    useSkipPlayback,
    useStartPlaceholder,
    useStartPlexPlayback,
    useStopPlayback,
    useNow,
} from '@/lib/hooks';
import type { SubtitleMode } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatDuration, formatElapsed } from '@/lib/format';

const QUALITY_OPTIONS: Array<{ value: PlexQuality; label: string }> = [
    { value: '720p-4', label: '720p · 4 Mbps' },
    { value: '1080p-8', label: '1080p · 8 Mbps' },
    { value: '1080p-12', label: '1080p · 12 Mbps' },
    { value: '4k-20', label: '4K · 20 Mbps' },
];

type View =
    | { kind: 'library' }
    | { kind: 'show'; showKey: string }
    | { kind: 'season'; showKey: string; seasonKey: string }
    | { kind: 'item'; itemKey: string; showKey?: string; seasonKey?: string };

type PlayTarget =
    | { kind: 'item'; item: PlexItemDetailDto; quality: PlexQuality; subtitleMode: SubtitleMode }
    | { kind: 'queue'; queueItem: QueueItemDto }
    | { kind: 'placeholder' };

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function toSubtitleMode(value: string): SubtitleMode {
    if (value === 'auto' || value === 'off') return value;
    return Number(value);
}

function qualityLabel(quality: PlexQuality): string {
    return QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? quality;
}

function targetTitle(target: PlayTarget | null): string {
    if (!target) return 'this item';
    if (target.kind === 'item') return target.item.title;
    if (target.kind === 'queue') return target.queueItem.title;
    return 'the Plex channel';
}

function targetMeta(target: PlayTarget): string {
    if (target.kind === 'item') {
        return target.item.type === 'episode'
            ? `${target.item.showTitle ?? 'Show'} · S${target.item.seasonNumber ?? 1} E${target.item.episodeNumber ?? 1}`
            : `${target.item.year ?? 'Plex'} · ${formatDuration(target.item.durationMs)}`;
    }
    if (target.kind === 'queue') {
        return target.queueItem.showTitle
            ? `${target.queueItem.showTitle} · S${target.queueItem.seasonNumber ?? 1} E${target.queueItem.episodeNumber ?? 1}`
            : 'Plex movie';
    }
    return 'Virtual channel · Placeholder';
}

function QueuePanel({
    open,
    onClose,
    onRequestQueuePlay,
    onRequestPlaceholder,
    onBrowse,
}: {
    open: boolean;
    onClose: () => void;
    onRequestQueuePlay: (item: QueueItemDto) => void;
    onRequestPlaceholder: () => void;
    onBrowse: () => void;
}) {
    const queue = usePlexQueue();
    const playback = usePlayback();
    const now = useNow(1_000);
    const remove = useRemoveQueueItem();
    const move = useMoveQueueItem();
    const shuffle = useShuffleQueue();
    const clear = useClearQueue();
    const pause = usePausePlayback();
    const resume = useResumePlayback();
    const skip = useSkipPlayback();
    const stop = useStopPlayback();
    const toast = useToast();
    const [confirmClear, setConfirmClear] = useState(false);

    const queued = (queue.data ?? [])
        .filter((item) => item.status === 'queued')
        .sort((a, b) => a.position - b.position);
    const failed = (queue.data ?? []).filter((item) => item.status === 'failed');
    const currentQueueItem = queue.data?.find((item) => item.id === playback.data?.queueItemId);
    const elapsed = playback.data?.startedAt ? now - playback.data.startedAt : 0;
    const duration = currentQueueItem?.durationMs ?? 0;

    if (!open) return null;

    const reportError = (error: unknown) =>
        toast({
            title: 'Queue action failed',
            description: errorMessage(error),
            tone: 'error',
        });

    return (
        <aside
            id="plex-queue"
            aria-labelledby="plex-queue-title"
            className="oc-panel-enter min-w-0 scroll-mt-20 rounded-xl border border-border bg-surface xl:sticky xl:top-[68px] xl:max-h-[calc(100dvh-5.25rem)] xl:overflow-y-auto"
        >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-baseline gap-2">
                    <h2 id="plex-queue-title" className="text-sm font-semibold text-text">
                        Queue
                    </h2>
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                        {queued.length}
                    </span>
                </div>
                <IconButton label="Close queue panel" size="sm" onClick={onClose}>
                    <X size={15} aria-hidden="true" />
                </IconButton>
            </div>

            {playback.data?.mode === 'plex' && currentQueueItem ? (
                <div className="border-b border-border px-4 py-3">
                    <div className="flex items-start gap-3">
                        <Poster
                            title={currentQueueItem.title}
                            seed={currentQueueItem.ratingKey}
                            src={currentQueueItem.thumbUrl}
                            showTitle={false}
                            className="h-14 w-9 shrink-0 rounded border border-border"
                        />
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-plex">
                                {playback.data.paused ? 'Paused' : 'Playing now'}
                            </p>
                            <p className="mt-0.5 truncate text-sm font-medium text-text">
                                {currentQueueItem.title}
                            </p>
                            <p className="truncate text-[11px] text-text-muted">
                                {currentQueueItem.showTitle
                                    ? `${currentQueueItem.showTitle} · S${currentQueueItem.seasonNumber} E${currentQueueItem.episodeNumber}`
                                    : 'Movie'}
                            </p>
                        </div>
                    </div>
                    {duration > 0 ? (
                        <div className="mt-3">
                            <ProgressBar
                                value={Math.min(elapsed, duration)}
                                max={duration}
                                tone="plex"
                                label="Current Plex item progress"
                            />
                            <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-text-muted">
                                <span>{formatElapsed(Math.min(elapsed, duration))}</span>
                                <span>{formatDuration(duration)}</span>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="px-4 py-3">
                {queue.isPending ? (
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="flex gap-2">
                                <Skeleton className="h-12 w-8" />
                                <div className="flex-1 space-y-1.5">
                                    <Skeleton className="h-3.5 w-3/4" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : queue.isError ? (
                    <ErrorState compact error={queue.error} onRetry={() => void queue.refetch()} />
                ) : queued.length === 0 && failed.length === 0 ? (
                    <EmptyState
                        compact
                        icon={ListOrdered}
                        title="Queue is empty"
                        description="Add a movie or episode to line it up for the Plex channel."
                        action={
                            <Button size="sm" variant="secondary" onClick={onBrowse}>
                                Browse library
                            </Button>
                        }
                    />
                ) : (
                    <ol className="divide-y divide-border">
                        {queued.map((item, index) => (
                            <li key={item.id} className="flex items-start gap-2 py-2.5 first:pt-0 last:pb-0">
                                <span className="mt-1 w-4 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-faint">
                                    {index + 1}
                                </span>
                                <Poster
                                    title={item.title}
                                    seed={item.ratingKey}
                                    src={item.thumbUrl}
                                    showTitle={false}
                                    className="h-12 w-8 shrink-0 rounded border border-border"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium text-text">{item.title}</p>
                                    <p className="truncate text-[11px] text-text-muted">
                                        {item.showTitle
                                            ? `${item.showTitle} · S${item.seasonNumber} E${item.episodeNumber}`
                                            : 'Movie'}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[10px] text-text-faint">
                                        {formatDuration(item.durationMs)} · {qualityLabel(item.quality)}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-center">
                                    <IconButton
                                        label={`Move ${item.title} up`}
                                        size="sm"
                                        disabled={index === 0}
                                        onClick={() =>
                                            move.mutate(
                                                { id: item.id, direction: 'up' },
                                                { onError: reportError }
                                            )
                                        }
                                    >
                                        <ChevronUp size={13} aria-hidden="true" />
                                    </IconButton>
                                    <IconButton
                                        label={`Move ${item.title} down`}
                                        size="sm"
                                        disabled={index === queued.length - 1}
                                        onClick={() =>
                                            move.mutate(
                                                { id: item.id, direction: 'down' },
                                                { onError: reportError }
                                            )
                                        }
                                    >
                                        <ChevronDown size={13} aria-hidden="true" />
                                    </IconButton>
                                    <IconButton
                                        label={`Remove ${item.title} from the queue`}
                                        size="sm"
                                        onClick={() => remove.mutate(item.id, { onError: reportError })}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </IconButton>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}

                {failed.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                        {failed.map((item) => (
                            <div
                                key={item.id}
                                className="rounded-md border border-danger/25 bg-danger/[0.06] px-2.5 py-2"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <StatusPill tone="danger">Failed</StatusPill>
                                    <IconButton
                                        label={`Remove ${item.title} from the queue`}
                                        size="sm"
                                        onClick={() => remove.mutate(item.id, { onError: reportError })}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </IconButton>
                                </div>
                                <p className="mt-1 text-xs font-medium text-text">{item.title}</p>
                                <p className="mt-0.5 text-[11px] leading-relaxed text-danger">
                                    {item.error ?? 'Plex could not start this item.'}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="space-y-2 border-t border-border p-3">
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        icon={<Play size={13} aria-hidden="true" />}
                        disabled={queued.length === 0}
                        onClick={() => queued[0] && onRequestQueuePlay(queued[0])}
                    >
                        Play queue
                    </Button>
                    {playback.data?.mode === 'plex' ? (
                        playback.data.paused ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<Play size={13} aria-hidden="true" />}
                                onClick={() =>
                                    resume.mutate(undefined, {
                                        onError: reportError,
                                        onSuccess: () => toast({ title: 'Playback resumed', tone: 'success' }),
                                    })
                                }
                            >
                                Resume
                            </Button>
                        ) : (
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<Pause size={13} aria-hidden="true" />}
                                onClick={() =>
                                    pause.mutate(undefined, {
                                        onError: reportError,
                                        onSuccess: () => toast({ title: 'Playback paused', tone: 'success' }),
                                    })
                                }
                            >
                                Pause
                            </Button>
                        )
                    ) : null}
                    <IconButton
                        label="Skip to the next queue item"
                        size="sm"
                        disabled={playback.data?.mode !== 'plex'}
                        onClick={() =>
                            skip.mutate(undefined, {
                                onError: reportError,
                                onSuccess: (state) =>
                                    toast({
                                        title: state.mode === 'plex' ? 'Skipped to the next item' : 'Queue finished',
                                        tone: 'success',
                                    }),
                            })
                        }
                    >
                        <SkipForward size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label="Stop Plex playback"
                        size="sm"
                        disabled={playback.data?.mode !== 'plex'}
                        onClick={() =>
                            stop.mutate(undefined, {
                                onError: reportError,
                                onSuccess: () => toast({ title: 'Playback stopped', tone: 'success' }),
                            })
                        }
                    >
                        <Square size={13} aria-hidden="true" />
                    </IconButton>
                </div>
                <div className="flex flex-wrap items-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Shuffle size={13} aria-hidden="true" />}
                        disabled={queued.length < 2}
                        onClick={() =>
                            shuffle.mutate(undefined, {
                                onError: reportError,
                                onSuccess: () => toast({ title: 'Queue shuffled', tone: 'success' }),
                            })
                        }
                    >
                        Shuffle
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash size={13} aria-hidden="true" />}
                        disabled={queued.length === 0}
                        onClick={() => setConfirmClear(true)}
                    >
                        Clear
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<MonitorPlay size={13} aria-hidden="true" />}
                        onClick={onRequestPlaceholder}
                    >
                        Open channel
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                onConfirm={() =>
                    clear.mutate(undefined, {
                        onError: reportError,
                        onSuccess: () => toast({ title: 'Queue cleared', tone: 'success' }),
                    })
                }
                title="Clear the queue?"
                description="Queued items are removed. The current Plex playback keeps running."
                confirmLabel="Clear queue"
            />
        </aside>
    );
}

function VoicePromptDialog({
    open,
    onClose,
    target,
    guilds,
    defaultGuildId,
    defaultChannelId,
    busy,
    error,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    target: PlayTarget | null;
    guilds: GuildDto[];
    defaultGuildId: string | null;
    defaultChannelId: string | null;
    busy: boolean;
    error: string | null;
    onConfirm: (guildId: string, voiceChannelId: string) => void;
}) {
    const channels = guilds.flatMap((guild) =>
        guild.voiceChannels.map((channel) => ({ ...channel, guildName: guild.name }))
    );
    const channelKey = channels.map((channel) => channel.id).join('|');
    const fallback = channels.find((channel) => channel.id === defaultChannelId)?.id ?? channels[0]?.id ?? '';
    const [selected, setSelected] = useState(fallback);

    useEffect(() => {
        if (open) setSelected(fallback);
    }, [open, fallback, channelKey]);

    const selectedChannel = channels.find((channel) => channel.id === selected);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={target?.kind === 'placeholder' ? 'Open the Plex channel' : 'Start playback'}
            description={
                target?.kind === 'placeholder'
                    ? 'Choose the Discord voice channel for the placeholder.'
                    : 'Choose the Discord voice channel for this session.'
            }
            size="md"
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (selectedChannel) onConfirm(selectedChannel.guildId, selectedChannel.id);
                }}
            >
                {target ? (
                    <div className="flex items-start gap-3">
                        {target.kind === 'placeholder' ? (
                            <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-md border border-plex/30 bg-plex/10">
                                <Film size={20} aria-hidden="true" className="text-plex" />
                            </div>
                        ) : (
                            <Poster
                                title={target.kind === 'item' ? target.item.title : target.queueItem.title}
                                seed={
                                    target.kind === 'item'
                                        ? target.item.ratingKey
                                        : target.queueItem.ratingKey
                                }
                                src={target.kind === 'item' ? target.item.thumbUrl : target.queueItem.thumbUrl}
                                showTitle={false}
                                className="h-16 w-11 shrink-0 rounded border border-border"
                            />
                        )}
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-text">{targetTitle(target)}</p>
                            <p className="mt-0.5 text-xs text-text-muted">{targetMeta(target)}</p>
                            {target.kind === 'item' ? (
                                <p className="mt-1 text-[11px] text-text-faint">
                                    {qualityLabel(target.quality)}
                                </p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {channels.length === 0 ? (
                    <Notice
                        tone="warn"
                        title="No voice channels available"
                        className="mt-4"
                        action={
                            <Link to="/discord" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                Open Discord
                            </Link>
                        }
                    >
                        The bot needs to be in a server with at least one voice channel before playback can start.
                    </Notice>
                ) : (
                    <fieldset className="mt-4">
                        <legend className="mb-2 text-xs font-medium text-text-muted">Voice channel</legend>
                        <div className="space-y-3">
                            {guilds.map((guild) =>
                                guild.voiceChannels.length === 0 ? null : (
                                    <div key={guild.id}>
                                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-faint">
                                            {guild.name}
                                        </p>
                                        <div className="space-y-1.5">
                                            {guild.voiceChannels.map((channel, index) => {
                                                const checked = selected === channel.id;
                                                const isDefaultGuild = guild.id === defaultGuildId && checked;
                                                return (
                                                    <label
                                                        key={channel.id}
                                                        className={cn(
                                                            'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
                                                            checked
                                                                ? 'border-blurple bg-blurple/[0.08] text-text'
                                                                : 'border-border bg-bg text-text-muted hover:border-border-strong'
                                                        )}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="voice-channel"
                                                            value={channel.id}
                                                            checked={checked}
                                                            data-autofocus={
                                                                channels[0]?.id === channel.id ? 'true' : undefined
                                                            }
                                                            onChange={() => setSelected(channel.id)}
                                                            className="size-4 accent-blurple"
                                                        />
                                                        <span className="min-w-0 flex-1 truncate">
                                                            {channel.name}
                                                        </span>
                                                        {isDefaultGuild ? (
                                                            <StatusPill tone="plex" dot={false}>
                                                                Current
                                                            </StatusPill>
                                                        ) : null}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </fieldset>
                )}

                {error ? (
                    <Notice tone="danger" title="Playback did not start" className="mt-4">
                        {error}
                    </Notice>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                    <Button variant="secondary" onClick={onClose} data-autofocus="true">
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={busy}
                        disabled={!selectedChannel}
                        icon={<Play size={14} aria-hidden="true" />}
                    >
                        {target?.kind === 'placeholder' ? 'Open channel' : 'Start playback'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function isPlayableLibrary(library: PlexLibraryDto): boolean {
    return library.type === 'movie' || library.type === 'show';
}

function libraryTypeLabel(type: string): string {
    switch (type) {
        case 'movie':
            return 'Movies';
        case 'show':
            return 'TV shows';
        case 'artist':
            return 'Music';
        case 'photo':
            return 'Photos';
        default:
            return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown';
    }
}

function LibrariesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const libraries = usePlexLibraries();
    const setLibrary = useSetPlexLibrary();
    const toast = useToast();
    const list = libraries.data ?? [];
    const pendingKey = setLibrary.isPending ? setLibrary.variables?.key : undefined;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Plex libraries"
            description="Choose the libraries OrbisCast can browse. Only movie and TV show libraries are playable."
            footer={
                <Button variant="secondary" onClick={onClose} data-autofocus="true">
                    Done
                </Button>
            }
        >
            {libraries.isPending ? (
                <div className="space-y-3" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                        <div key={index} className="flex items-center justify-between gap-4">
                            <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                            <Skeleton className="h-6 w-10 rounded-full" />
                        </div>
                    ))}
                </div>
            ) : libraries.isError ? (
                <ErrorState
                    compact
                    title="Plex libraries could not load"
                    error={libraries.error}
                    onRetry={() => void libraries.refetch()}
                />
            ) : list.length === 0 ? (
                <EmptyState
                    compact
                    icon={Library}
                    title="No libraries discovered"
                    description="Check the Plex connection, then reopen this dialog."
                />
            ) : (
                <ul className="divide-y divide-border">
                    {list.map((library) => {
                        const playable = isPlayableLibrary(library);
                        return (
                            <li
                                key={library.key}
                                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-text">
                                        {library.title}
                                    </p>
                                    <p className="mt-0.5 text-[11px] uppercase tracking-[0.06em] text-text-faint">
                                        {libraryTypeLabel(library.type)}
                                        {playable
                                            ? library.enabled
                                                ? ' · Shown'
                                                : ' · Hidden'
                                            : ' · Not playable'}
                                    </p>
                                </div>
                                <Switch
                                    checked={library.enabled}
                                    disabled={!playable || pendingKey === library.key}
                                    onChange={(event) =>
                                        setLibrary.mutate(
                                            { key: library.key, enabled: event.target.checked },
                                            {
                                                onError: (error) =>
                                                    toast({
                                                        title: 'Could not update the library',
                                                        description: errorMessage(error),
                                                        tone: 'error',
                                                    }),
                                            }
                                        )
                                    }
                                    label={
                                        <span className="sr-only">
                                            Show {library.title} in OrbisCast
                                        </span>
                                    }
                                    className="shrink-0"
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </Dialog>
    );
}

export default function PlexPage() {
    const [libraryKey, setLibraryKey] = useState('');
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [view, setView] = useState<View>({ kind: 'library' });
    const [queueOpen, setQueueOpen] = useState(true);
    const [librariesOpen, setLibrariesOpen] = useState(false);
    const [prompt, setPrompt] = useState<PlayTarget | null>(null);
    const [conflict, setConflict] = useState<PlayTarget | null>(null);
    const [promptError, setPromptError] = useState<string | null>(null);
    const [promptBusy, setPromptBusy] = useState(false);
    const [quality, setQuality] = useState<PlexQuality>('1080p-8');
    const [subtitle, setSubtitle] = useState('auto');

    const libraries = usePlexLibraries();
    const config = usePlexConfig();
    const discord = useDiscordStatus();
    const items = usePlexItems(libraryKey, deferredSearch);
    const queue = usePlexQueue();
    const playback = usePlayback();
    const detail = usePlexItem(
        view.kind === 'show'
            ? view.showKey
            : view.kind === 'season'
              ? view.seasonKey
              : view.kind === 'item'
                ? view.itemKey
                : null
    );
    const show = usePlexItem(
        view.kind === 'show'
            ? view.showKey
            : view.kind === 'season'
              ? view.showKey
              : view.kind === 'item'
                ? (view.showKey ?? null)
                : null
    );
    const season = usePlexItem(
        view.kind === 'season'
            ? view.seasonKey
            : view.kind === 'item'
              ? (view.seasonKey ?? null)
              : null
    );
    const children = usePlexChildren(
        view.kind === 'show' ? view.showKey : view.kind === 'season' ? view.seasonKey : null
    );

    const itemDetail = detail.data ?? null;
    const libraryList = libraries.data ?? [];
    const playableLibraries = libraryList.filter(isPlayableLibrary);
    const enabledLibraries = playableLibraries.filter((library) => library.enabled);
    const itemList = items.data ?? [];
    const childItems = children.data ?? [];

    const enqueue = useEnqueue();
    const stop = useStopPlayback();
    const startPlex = useStartPlexPlayback();
    const playQueue = usePlayQueueItem();
    const placeholder = useStartPlaceholder();
    const toast = useToast();

    const activeLibrary = libraries.data?.find((library) => library.key === libraryKey);
    const queuedCount = queue.data?.filter((item) => item.status === 'queued').length ?? 0;
    const currentQueueItem = queue.data?.find((item) => item.id === playback.data?.queueItemId);
    const isCurrentItem = Boolean(itemDetail && currentQueueItem?.ratingKey === itemDetail.ratingKey);
    const busy = playback.data?.mode === 'iptv' || playback.data?.mode === 'plex';

    useEffect(() => {
        if (!libraries.data) return;
        const enabled = libraries.data.filter(isPlayableLibrary).filter((library) => library.enabled);
        if (enabled.length === 0) {
            if (libraryKey !== '') {
                setLibraryKey('');
                setSearch('');
                setView({ kind: 'library' });
            }
            return;
        }
        if (!enabled.some((library) => library.key === libraryKey)) {
            setLibraryKey(enabled[0].key);
            setSearch('');
            setView({ kind: 'library' });
        }
    }, [libraries.data, libraryKey]);

    useEffect(() => {
        if (itemDetail) {
            setQuality(config.data?.defaultQuality ?? '1080p-8');
            setSubtitle('auto');
        }
    }, [itemDetail?.ratingKey, config.data?.defaultQuality]);

    const resetToLibrary = () => {
        setView({ kind: 'library' });
    };

    const back = () => {
        if (view.kind === 'item') {
            if (view.seasonKey && view.showKey) {
                setView({ kind: 'season', showKey: view.showKey, seasonKey: view.seasonKey });
            } else if (view.showKey) {
                setView({ kind: 'show', showKey: view.showKey });
            } else {
                setView({ kind: 'library' });
            }
            return;
        }
        if (view.kind === 'season') {
            setView({ kind: 'show', showKey: view.showKey });
            return;
        }
        setView({ kind: 'library' });
    };

    const requestPlay = (target: PlayTarget) => {
        setPromptError(null);
        if (busy) {
            setConflict(target);
            return;
        }
        setPrompt(target);
    };

    const addToQueue = () => {
        if (!itemDetail || (itemDetail.type !== 'movie' && itemDetail.type !== 'episode')) return;
        enqueue.mutate(
            {
                ratingKey: itemDetail.ratingKey,
                type: itemDetail.type,
                title: itemDetail.title,
                showTitle: itemDetail.showTitle,
                seasonNumber: itemDetail.seasonNumber,
                episodeNumber: itemDetail.episodeNumber,
                durationMs: itemDetail.durationMs,
                quality,
                subtitleMode: toSubtitleMode(subtitle),
            },
            {
                onSuccess: () => {
                    toast({ title: 'Added to queue', description: itemDetail?.title, tone: 'success' });
                    setQueueOpen(true);
                    if (window.innerWidth < 1280) {
                        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth';
                        window.setTimeout(() => {
                            document
                                .getElementById('plex-queue')
                                ?.scrollIntoView({ block: 'start', behavior });
                        }, 60);
                    }
                },
                onError: (error) =>
                    toast({
                        title: 'Could not add to the queue',
                        description: errorMessage(error),
                        tone: 'error',
                    }),
            }
        );
    };

    const playNow = () => {
        if (!itemDetail) return;
        requestPlay({
            kind: 'item',
            item: itemDetail,
            quality,
            subtitleMode: toSubtitleMode(subtitle),
        });
    };

    const confirmPlayback = async (guildId: string, voiceChannelId: string) => {
        if (!prompt) return;
        setPromptBusy(true);
        setPromptError(null);
        try {
            let title = 'Plex On Demand';
            if (prompt.kind === 'item') {
                await startPlex.mutateAsync({
                    ratingKey: prompt.item.ratingKey,
                    quality: prompt.quality,
                    subtitleMode: prompt.subtitleMode,
                    guildId,
                    voiceChannelId,
                });
                title = prompt.item.title;
            } else if (prompt.kind === 'queue') {
                await playQueue.mutateAsync({ id: prompt.queueItem.id, guildId, voiceChannelId });
                title = prompt.queueItem.title;
            } else {
                await placeholder.mutateAsync({ guildId, voiceChannelId });
                title = 'Plex On Demand';
            }
            const channelName = discord.data?.guilds
                .flatMap((guild) => guild.voiceChannels)
                .find((channel) => channel.id === voiceChannelId)?.name;
            toast({
                title: prompt.kind === 'placeholder' ? 'Plex channel opened' : `Playing ${title}`,
                description: channelName ? `Started in ${channelName}` : undefined,
                tone: 'success',
            });
            setPrompt(null);
        } catch (error) {
            setPromptError(errorMessage(error));
        } finally {
            setPromptBusy(false);
        }
    };

    const breadcrumbs: Array<{ label: string; onClick?: () => void; current?: boolean }> = [
        {
            label: activeLibrary?.title ?? 'Library',
            onClick: view.kind === 'library' ? undefined : resetToLibrary,
        },
    ];
    if (view.kind === 'show' && itemDetail) {
        breadcrumbs.push({ label: itemDetail.title, current: true });
    }
    if (view.kind === 'season' && show.data) {
        breadcrumbs.push({
            label: show.data.title,
            onClick: () => setView({ kind: 'show', showKey: view.showKey }),
        });
    }
    if (view.kind === 'season' && season.data) {
        breadcrumbs.push({ label: season.data.title, current: true });
    }
    if (view.kind === 'item' && show.data) {
        breadcrumbs.push({
            label: show.data.title,
            onClick: () => setView({ kind: 'show', showKey: view.showKey! }),
        });
    }
    if (view.kind === 'item' && season.data) {
        breadcrumbs.push({
            label: season.data.title,
            onClick: () =>
                setView({ kind: 'season', showKey: view.showKey!, seasonKey: view.seasonKey! }),
        });
    }
    if (view.kind === 'item' && itemDetail) {
        breadcrumbs.push({ label: itemDetail.title, current: true });
    }

    return (
        <>
            <PageHeader
                title="Plex"
                meta={
                    libraries.data
                        ? `${enabledLibraries.length} of ${playableLibraries.length} playable libraries · ${config.data?.connected ? 'Connected' : 'Not connected'}`
                        : 'Plex on demand'
                }
                actions={
                    <>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Library size={14} aria-hidden="true" />}
                            onClick={() => setLibrariesOpen(true)}
                        >
                            Libraries
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<ListOrdered size={14} aria-hidden="true" />}
                            onClick={() => setQueueOpen((current) => !current)}
                        >
                            Queue
                            <span className="ml-0.5 rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                                {queuedCount}
                            </span>
                        </Button>
                    </>
                }
            />
            <div className="oc-page-enter mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-5 xl:p-6">
                {config.data && (!config.data.connected || config.data.error) ? (
                    <Notice
                        tone="warn"
                        title="Plex needs attention"
                        action={
                            <Link to="/settings#plex-connection" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                Open Plex settings
                            </Link>
                        }
                    >
                        {config.data.error ?? 'The Plex server is not reachable. Check the server URL and token.'}
                    </Notice>
                ) : null}

                <div className={cn('grid min-w-0 grid-cols-1 gap-4', queueOpen && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
                    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
                        {view.kind === 'library' ? (
                            <div className="p-3 sm:p-4">
                                {libraries.isPending ? (
                                    <div className="space-y-4" aria-hidden="true">
                                        <Skeleton className="h-9 w-72" />
                                        <Skeleton className="h-9 w-full max-w-sm" />
                                    </div>
                                ) : libraries.isError ? (
                                    <ErrorState
                                        compact
                                        title="Plex libraries could not load"
                                        error={libraries.error}
                                        onRetry={() => void libraries.refetch()}
                                    />
                                ) : libraryList.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={Film}
                                        title="No Plex libraries"
                                        description="Check that the Plex token can see at least one movie or show library."
                                        action={
                                            <Link to="/settings#plex-connection" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                                Open Plex settings
                                            </Link>
                                        }
                                    />
                                ) : enabledLibraries.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={Library}
                                        title="No playable libraries enabled"
                                        description="Enable at least one movie or TV show library to browse and play Plex content."
                                        action={
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => setLibrariesOpen(true)}
                                            >
                                                Choose libraries
                                            </Button>
                                        }
                                    />
                                ) : (
                                    <Tabs
                                        label="Plex libraries"
                                        items={enabledLibraries.map((library) => ({
                                            id: library.key,
                                            label: library.title,
                                        }))}
                                        value={libraryKey}
                                        onChange={(key) => {
                                            setLibraryKey(key);
                                            setSearch('');
                                            setView({ kind: 'library' });
                                        }}
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="relative w-full sm:max-w-xs">
                                                <label htmlFor="plex-search" className="sr-only">
                                                    Search this library
                                                </label>
                                                <Search
                                                    size={14}
                                                    aria-hidden="true"
                                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                                                />
                                                <Input
                                                    id="plex-search"
                                                    type="search"
                                                    value={search}
                                                    onChange={(event) => setSearch(event.target.value)}
                                                    placeholder={`Search ${activeLibrary?.title.toLowerCase() ?? 'library'}`}
                                                    className="pl-8"
                                                />
                                            </div>
                                            <p className="text-xs text-text-muted">
                                                {items.data
                                                    ? `${itemList.length} item${itemList.length === 1 ? '' : 's'}`
                                                    : 'Loading library'}
                                            </p>
                                        </div>

                                        <div className="mt-4">
                                            {items.isPending ? (
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                                                    {Array.from({ length: 12 }).map((_, index) => (
                                                        <div key={index} className="space-y-2" aria-hidden="true">
                                                            <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                                                            <Skeleton className="h-3.5 w-3/4" />
                                                            <Skeleton className="h-3 w-1/2" />
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : items.isError ? (
                                                <ErrorState
                                                    compact
                                                    title="This library could not load"
                                                    error={items.error}
                                                    onRetry={() => void items.refetch()}
                                                />
                                            ) : itemList.length === 0 ? (
                                                <EmptyState
                                                    compact
                                                    icon={Film}
                                                    title={search.trim() ? 'No matching titles' : 'This library is empty'}
                                                    description={
                                                        search.trim()
                                                            ? 'Try a shorter search, or switch libraries.'
                                                            : 'Plex returned no playable items for this library.'
                                                    }
                                                    action={
                                                        search.trim() ? (
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => setSearch('')}
                                                            >
                                                                Clear search
                                                            </Button>
                                                        ) : undefined
                                                    }
                                                />
                                            ) : (
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                                                    {itemList.map((item) => (
                                                        <PlexCard
                                                            key={item.ratingKey}
                                                            item={item}
                                                            onOpen={() => {
                                                                if (item.type === 'show') {
                                                                    setView({ kind: 'show', showKey: item.ratingKey });
                                                                } else {
                                                                    setView({ kind: 'item', itemKey: item.ratingKey });
                                                                }
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </Tabs>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<ArrowLeft size={14} aria-hidden="true" />}
                                        onClick={back}
                                    >
                                        Back
                                    </Button>
                                    <nav aria-label="Breadcrumb" className="min-w-0">
                                        <ol className="flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
                                            {breadcrumbs.map((crumb, index) => (
                                                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                                                    {index > 0 ? (
                                                        <ChevronRight
                                                            size={11}
                                                            aria-hidden="true"
                                                            className="text-text-faint"
                                                        />
                                                    ) : null}
                                                    {crumb.onClick ? (
                                                        <button
                                                            type="button"
                                                            onClick={crumb.onClick}
                                                            className="rounded text-blurple-text hover:text-[#a5acff]"
                                                        >
                                                            {crumb.label}
                                                        </button>
                                                    ) : (
                                                        <span
                                                            aria-current={crumb.current ? 'page' : undefined}
                                                            className={crumb.current ? 'truncate text-text' : 'truncate'}
                                                        >
                                                            {crumb.label}
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ol>
                                    </nav>
                                </div>

                                {detail.isPending ? (
                                    <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-[180px_minmax(0,1fr)]" aria-hidden="true">
                                        <Skeleton className="aspect-[2/3] w-full max-w-[180px] rounded-lg" />
                                        <div className="space-y-3">
                                            <Skeleton className="h-7 w-2/3" />
                                            <Skeleton className="h-4 w-1/3" />
                                            <Skeleton className="h-4 w-full" />
                                            <Skeleton className="h-4 w-5/6" />
                                            <Skeleton className="h-9 w-48" />
                                        </div>
                                    </div>
                                ) : detail.isError ? (
                                    <ErrorState
                                        error={detail.error}
                                        onRetry={() => void detail.refetch()}
                                        title="This Plex item could not load"
                                    />
                                ) : itemDetail ? (
                                    <div className="p-4 sm:p-5">
                                        <div className="grid grid-cols-1 gap-5 md:grid-cols-[160px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)]">
                                            <Poster
                                                title={itemDetail.title}
                                                seed={itemDetail.ratingKey}
                                                src={itemDetail.thumbUrl}
                                                className="w-full max-w-[180px] rounded-lg border border-border"
                                            />
                                            <div className="min-w-0">
                                                <h2 className="text-[clamp(1.35rem,1.1rem+1.2vw,2rem)] font-semibold leading-tight tracking-[-0.02em] text-text">
                                                    {itemDetail.title}
                                                </h2>
                                                <p className="mt-1 text-sm text-text-muted">
                                                    {itemDetail.type === 'episode'
                                                        ? `${itemDetail.showTitle ?? 'Show'} · Season ${itemDetail.seasonNumber ?? 1}, Episode ${itemDetail.episodeNumber ?? 1}`
                                                        : itemDetail.type === 'season'
                                                          ? `${itemDetail.showTitle ?? 'Show'} · Season ${itemDetail.seasonNumber ?? 1}`
                                                          : itemDetail.type === 'show'
                                                            ? `${itemDetail.year ?? 'Unknown year'} · Series`
                                                            : `${itemDetail.year ?? 'Unknown year'} · ${formatDuration(itemDetail.durationMs)}`}
                                                </p>
                                                <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-muted">
                                                    {itemDetail.summary}
                                                </p>

                                                {itemDetail.type === 'movie' || itemDetail.type === 'episode' ? (
                                                    <>
                                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                            <Field label="Subtitles" htmlFor="item-subtitles">
                                                                <Select
                                                                    id="item-subtitles"
                                                                    value={subtitle}
                                                                    onChange={(event) => setSubtitle(event.target.value)}
                                                                >
                                                                    <option value="auto">Auto (match the file)</option>
                                                                    <option value="off">Off</option>
                                                                    {itemDetail.streams
                                                                        .filter((stream) => stream.type === 'subtitle')
                                                                        .map((stream) => (
                                                                            <option
                                                                                key={stream.id}
                                                                                value={stream.id}
                                                                                disabled={!stream.burnable}
                                                                            >
                                                                                {stream.displayTitle ??
                                                                                    stream.language ??
                                                                                    `Track ${stream.id}`}
                                                                                {stream.burnable ? '' : ' (unavailable)'}
                                                                            </option>
                                                                        ))}
                                                                </Select>
                                                            </Field>
                                                            <Field label="Quality" htmlFor="item-quality">
                                                                <Select
                                                                    id="item-quality"
                                                                    value={quality}
                                                                    onChange={(event) =>
                                                                        setQuality(event.target.value as PlexQuality)
                                                                    }
                                                                >
                                                                    {QUALITY_OPTIONS.map((option) => (
                                                                        <option key={option.value} value={option.value}>
                                                                            {option.label}
                                                                        </option>
                                                                    ))}
                                                                </Select>
                                                            </Field>
                                                        </div>
                                                        {isCurrentItem ? (
                                                            <Notice tone="plex" title="Playing now" className="mt-4">
                                                                This item is streaming in{' '}
                                                                {playback.data?.voiceChannelName ?? 'Discord'}. Use the
                                                                queue panel to pause, skip, or stop.
                                                            </Notice>
                                                        ) : busy && playback.data ? (
                                                            <Notice tone="warn" title="Playback is busy" className="mt-4">
                                                                {playback.data.title} is streaming. Playing this item will
                                                                ask you to stop the current stream first.
                                                            </Notice>
                                                        ) : null}
                                                        <div className="mt-4 flex flex-wrap gap-2">
                                                            <Button
                                                                variant="primary"
                                                                icon={<Play size={14} aria-hidden="true" />}
                                                                onClick={playNow}
                                                            >
                                                                Play now
                                                            </Button>
                                                            <Button
                                                                variant="secondary"
                                                                icon={<ListPlus size={14} aria-hidden="true" />}
                                                                onClick={addToQueue}
                                                                loading={enqueue.isPending}
                                                            >
                                                                Add to queue
                                                            </Button>
                                                        </div>
                                                        <p className="mt-2 text-[11px] text-text-faint">
                                                            Playback starts in a Discord voice channel you choose next.
                                                        </p>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>

                                        {itemDetail.type === 'show' || itemDetail.type === 'season' ? (
                                            <div className="mt-6 border-t border-border pt-4">
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <h3 className="text-sm font-semibold text-text">
                                                        {itemDetail.type === 'show' ? 'Seasons' : 'Episodes'}
                                                    </h3>
                                                    {children.data ? (
                                                        <span className="text-[11px] text-text-muted">
                                                            {childItems.length} items
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {children.isPending ? (
                                                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
                                                        {[0, 1, 2, 3].map((index) => (
                                                            <Skeleton key={index} className="aspect-[2/3] rounded-lg" />
                                                        ))}
                                                    </div>
                                                ) : children.isError ? (
                                                    <ErrorState
                                                        compact
                                                        error={children.error}
                                                        onRetry={() => void children.refetch()}
                                                    />
                                                ) : childItems.length === 0 ? (
                                                    <EmptyState
                                                        compact
                                                        title={
                                                            itemDetail.type === 'show'
                                                                ? 'No seasons found'
                                                                : 'No episodes found'
                                                        }
                                                        description="Plex returned no children for this item."
                                                    />
                                                ) : itemDetail.type === 'show' ? (
                                                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                                                        {childItems.map((seasonItem) => (
                                                            <button
                                                                key={seasonItem.ratingKey}
                                                                type="button"
                                                                onClick={() =>
                                                                    setView({
                                                                        kind: 'season',
                                                                        showKey: view.kind === 'show' ? view.showKey : itemDetail.ratingKey,
                                                                        seasonKey: seasonItem.ratingKey,
                                                                    })
                                                                }
                                                                className="group min-w-0 text-left"
                                                            >
                                                                <Poster
                                                                    title={seasonItem.title}
                                                                    seed={seasonItem.ratingKey}
                                                                    src={seasonItem.thumbUrl}
                                                                    className="w-full rounded-lg border border-border transition-colors group-hover:border-border-strong"
                                                                />
                                                                <p className="mt-2 truncate text-sm font-medium text-text">
                                                                    {seasonItem.title}
                                                                </p>
                                                                <p className="text-[11px] text-text-muted">
                                                                    {seasonItem.summary}
                                                                </p>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <ol className="mt-3 divide-y divide-border border-t border-border">
                                                        {childItems.map((episode) => (
                                                            <li key={episode.ratingKey}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setView({
                                                                            kind: 'item',
                                                                            itemKey: episode.ratingKey,
                                                                            showKey: view.kind === 'season' ? view.showKey : show.data?.ratingKey,
                                                                            seasonKey: view.kind === 'season' ? view.seasonKey : undefined,
                                                                        })
                                                                    }
                                                                    className="flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-white/[0.02]"
                                                                >
                                                                    <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums text-text-faint">
                                                                        {episode.episodeNumber ?? '—'}
                                                                    </span>
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate text-sm font-medium text-text">
                                                                            {episode.title}
                                                                        </span>
                                                                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-text-muted">
                                                                            {episode.summary}
                                                                        </span>
                                                                    </span>
                                                                    <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-text-muted">
                                                                        {formatDuration(episode.durationMs)}
                                                                    </span>
                                                                    <ChevronRight
                                                                        size={14}
                                                                        aria-hidden="true"
                                                                        className="mt-0.5 shrink-0 text-text-faint"
                                                                    />
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </section>

                    <QueuePanel
                        open={queueOpen}
                        onClose={() => setQueueOpen(false)}
                        onRequestQueuePlay={(item) => requestPlay({ kind: 'queue', queueItem: item })}
                        onRequestPlaceholder={() => requestPlay({ kind: 'placeholder' })}
                        onBrowse={() => {
                            setQueueOpen(false);
                            setView({ kind: 'library' });
                        }}
                    />
                </div>
            </div>

            <LibrariesDialog open={librariesOpen} onClose={() => setLibrariesOpen(false)} />

            <VoicePromptDialog
                open={prompt !== null}
                onClose={() => {
                    setPrompt(null);
                    setPromptError(null);
                }}
                target={prompt}
                guilds={discord.data?.guilds ?? []}
                defaultGuildId={playback.data?.guildId ?? null}
                defaultChannelId={playback.data?.voiceChannelId ?? null}
                busy={promptBusy}
                error={promptError}
                onConfirm={(guildId, voiceChannelId) => void confirmPlayback(guildId, voiceChannelId)}
            />

            <ConfirmDialog
                open={conflict !== null}
                onClose={() => setConflict(null)}
                onConfirm={() => {
                    const target = conflict;
                    if (!target) return;
                    stop.mutate(undefined, {
                        onSuccess: () => {
                            setConflict(null);
                            setPromptError(null);
                            setPrompt(target);
                        },
                        onError: (error) =>
                            toast({
                                title: 'Could not stop the current stream',
                                description: errorMessage(error),
                                tone: 'error',
                            }),
                    });
                }}
                title="Playback is busy"
                description={`${playback.data?.title ?? 'The current stream'} is already streaming. OrbisCast runs one stream at a time. Stop it before starting ${targetTitle(conflict)}.`}
                confirmLabel="Stop and continue"
                cancelLabel="Keep watching"
            />
        </>
    );
}

function PlexCard({ item, onOpen }: { item: PlexItemDto; onOpen: () => void }) {
    return (
        <button type="button" onClick={onOpen} className="group min-w-0 text-left">
            <div className="relative overflow-hidden rounded-lg border border-border transition-colors group-hover:border-border-strong">
                <Poster
                    title={item.title}
                    seed={item.ratingKey}
                    src={item.thumbUrl}
                    className="w-full"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-semibold text-black shadow">
                        <Play size={13} aria-hidden="true" />
                        Open
                    </span>
                </div>
                {item.type === 'show' ? (
                    <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-white/90">
                        Series
                    </span>
                ) : null}
            </div>
            <p className="mt-2 truncate text-sm font-medium leading-5 text-text">{item.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
                {item.year ?? 'Unknown'} · {item.type === 'show' ? 'Series' : formatDuration(item.durationMs)}
            </p>
        </button>
    );
}
