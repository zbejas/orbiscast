import {
    useDeferredValue,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import {
    ArrowLeft,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Film,
    GripVertical,
    History,
    Library,
    ListOrdered,
    ListPlus,
    MonitorPlay,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Search,
    Server,
    Shuffle,
    SkipForward,
    Square,
    Trash,
    X,
} from 'lucide-react';
import { Link } from 'react-router';
import type {
    GuildDto,
    MediaHistoryDto,
    MediaItemDetailDto,
    MediaItemDto,
    MediaQuality,
    MediaSourceDto,
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
    SeekBar,
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
    useCurrentMediaItem,
    useDiscordStatus,
    useEnqueue,
    useMoveQueueItem,
    usePausePlayback,
    usePlayback,
    usePlayQueueItem,
    useMediaChildren,
    useMediaHistory,
    useMediaItem,
    useMediaItems,
    useMediaLibraries,
    useMediaQueue,
    useMediaSources,
    useRemoveMediaHistory,
    useRemoveQueueItem,
    useReorderMediaSources,
    useResumePlayback,
    useSeekPlayback,
    useSetSubtitle,
    useSettings,
    useShuffleQueue,
    useSkipPlayback,
    useStartPlaceholder,
    useStartMediaPlayback,
    useStopPlayback,
    useUpdatePlaybackPreferences,
    useValidateMediaSource,
    useNow,
} from '@/lib/hooks';
import type { SubtitleMode } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatDuration, formatElapsed, formatPercent } from '@/lib/format';
import { isPlayableLibrary, QUALITY_OPTIONS, qualityLabel } from '@/lib/media';
import { playbackPositionMs } from '@/lib/playback';

type View =
    | { kind: 'library' }
    | { kind: 'show'; showKey: string }
    | { kind: 'season'; showKey: string; seasonKey: string }
    | { kind: 'item'; itemKey: string; showKey?: string; seasonKey?: string };

type PlayTarget =
    | { kind: 'item'; item: MediaItemDetailDto; quality: MediaQuality; subtitleMode: SubtitleMode; startOver?: boolean }
    | { kind: 'history'; entry: MediaHistoryDto }
    | { kind: 'queue'; queueItem: QueueItemDto }
    | { kind: 'placeholder'; sourceId: number };

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function toSubtitleMode(value: string): SubtitleMode {
    if (value === 'auto' || value === 'off') return value;
    return Number(value);
}

function targetTitle(target: PlayTarget | null): string {
    if (!target) return 'this item';
    if (target.kind === 'item') return target.item.title;
    if (target.kind === 'history') return target.entry.title;
    if (target.kind === 'queue') return target.queueItem.title;
    return 'the media channel';
}

function targetMeta(target: PlayTarget): string {
    if (target.kind === 'item') {
        return target.item.type === 'episode'
            ? `${target.item.showTitle ?? 'Show'} · S${target.item.seasonNumber ?? 1} E${target.item.episodeNumber ?? 1}`
            : `${target.item.year ?? 'Media'} · ${formatDuration(target.item.durationMs)}`;
    }
    if (target.kind === 'history') {
        return target.entry.type === 'episode'
            ? `${target.entry.showTitle ?? 'Show'} · S${target.entry.seasonNumber ?? 1} E${target.entry.episodeNumber ?? 1} · ${formatElapsed(target.entry.positionMs)} watched`
            : `${target.entry.sourceName} · ${formatElapsed(target.entry.positionMs)} watched`;
    }
    if (target.kind === 'queue') {
        return target.queueItem.showTitle
            ? `${target.queueItem.showTitle} · S${target.queueItem.seasonNumber ?? 1} E${target.queueItem.episodeNumber ?? 1}`
            : 'Media movie';
    }
    return 'Virtual channel · Placeholder';
}

function SourceTabs({
    sources,
    value,
    onChange,
    onReorder,
}: {
    sources: MediaSourceDto[];
    value: number;
    onChange: (id: number) => void;
    onReorder: (ids: number[]) => void;
}) {
    const baseId = useId();
    const tabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
    const [dragId, setDragId] = useState<number | null>(null);
    const [overId, setOverId] = useState<number | null>(null);
    const [announcement, setAnnouncement] = useState('');

    if (sources.length === 0) return null;

    const ids = sources.map((source) => source.id);
    const active = sources.find((source) => source.id === value) ?? sources[0]!;
    const activeIndex = sources.findIndex((source) => source.id === active.id);

    const announceMove = (fromIndex: number, toIndex: number) => {
        const moved = sources[fromIndex];
        if (!moved) return;
        setAnnouncement(`${moved.name} moved to position ${toIndex + 1} of ${sources.length}.`);
    };

    const focusTab = (index: number) => {
        const next = sources[index];
        if (!next) return;
        onChange(next.id);
        tabRefs.current[next.id]?.focus();
    };

    const moveTab = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= ids.length) return;
        const next = [...ids];
        const [moved] = next.splice(fromIndex, 1);
        if (moved === undefined) return;
        next.splice(toIndex, 0, moved);
        announceMove(fromIndex, toIndex);
        onReorder(next);
    };

    const dropOn = (targetId: number) => {
        if (dragId === null || dragId === targetId) return;
        const fromIndex = ids.indexOf(dragId);
        const targetIndex = ids.indexOf(targetId);
        if (fromIndex < 0 || targetIndex < 0) return;
        const next = ids.filter((id) => id !== dragId);
        const insertAt =
            fromIndex < targetIndex ? next.indexOf(targetId) + 1 : next.indexOf(targetId);
        next.splice(insertAt, 0, dragId);
        announceMove(fromIndex, next.indexOf(dragId));
        onReorder(next);
    };

    const handleKeyDown = (
        event: KeyboardEvent<HTMLButtonElement>,
        source: MediaSourceDto,
        index: number
    ) => {
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            moveTab(index, index + (event.key === 'ArrowRight' ? 1 : -1));
            window.requestAnimationFrame(() => tabRefs.current[source.id]?.focus());
            return;
        }

        let target = index;
        if (event.key === 'ArrowRight') target = (index + 1) % sources.length;
        else if (event.key === 'ArrowLeft') target = (index - 1 + sources.length) % sources.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = sources.length - 1;
        else return;
        event.preventDefault();
        focusTab(target);
    };

    return (
        <div className="min-w-0">
            <div className="flex items-end justify-between gap-3 border-b border-border">
                <div
                    role="tablist"
                    aria-label="Media sources"
                    aria-describedby={`${baseId}-hint`}
                    className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden"
                >
                    {sources.map((source, index) => {
                        const selected = source.id === active.id;
                        const status = !source.enabled
                            ? 'Disabled'
                            : source.connected
                              ? 'Connected'
                              : source.error
                                ? 'Connection error'
                                : 'Offline';
                        return (
                            <button
                                key={source.id}
                                ref={(element) => {
                                    tabRefs.current[source.id] = element;
                                }}
                                type="button"
                                role="tab"
                                id={`${baseId}-tab-${source.id}`}
                                aria-selected={selected}
                                tabIndex={selected ? 0 : -1}
                                draggable
                                onDragStart={(event) => {
                                    setDragId(source.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', String(source.id));
                                }}
                                onDragOver={(event) => {
                                    if (dragId === null) return;
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = 'move';
                                    setOverId(source.id);
                                }}
                                onDragLeave={() =>
                                    setOverId((current) =>
                                        current === source.id ? null : current
                                    )
                                }
                                onDrop={(event) => {
                                    event.preventDefault();
                                    dropOn(source.id);
                                    setDragId(null);
                                    setOverId(null);
                                }}
                                onDragEnd={() => {
                                    setDragId(null);
                                    setOverId(null);
                                }}
                                onClick={() => onChange(source.id)}
                                onKeyDown={(event) => handleKeyDown(event, source, index)}
                                title={`${source.name} · ${status}. Drag to reorder.`}
                                className={cn(
                                    'oc-control group -mb-px inline-flex min-h-10 shrink-0 cursor-grab items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors active:cursor-grabbing',
                                    selected
                                        ? 'border-blurple text-text'
                                        : 'border-transparent text-text-muted hover:text-text',
                                    dragId === source.id && 'opacity-40',
                                    overId === source.id &&
                                        dragId !== source.id &&
                                        'bg-white/[0.05]'
                                )}
                            >
                                <GripVertical
                                    size={12}
                                    aria-hidden="true"
                                    className="shrink-0 text-text-faint opacity-60 group-hover:opacity-100"
                                />
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'size-1.5 shrink-0 rounded-full',
                                        source.enabled
                                            ? source.connected
                                                ? 'bg-live'
                                                : source.error
                                                  ? 'bg-danger'
                                                  : 'bg-text-faint'
                                            : 'bg-text-faint/60'
                                    )}
                                />
                                {source.name}
                                <span className="sr-only">, {status}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex shrink-0 items-center gap-1 pb-1">
                    <span
                        aria-hidden="true"
                        className="hidden pr-1 text-[11px] text-text-faint sm:inline"
                    >
                        Drag to reorder
                    </span>
                    <IconButton
                        label={`Move ${active.name} left`}
                        size="sm"
                        disabled={activeIndex <= 0}
                        onClick={() => moveTab(activeIndex, activeIndex - 1)}
                    >
                        <ChevronLeft size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label={`Move ${active.name} right`}
                        size="sm"
                        disabled={activeIndex < 0 || activeIndex >= sources.length - 1}
                        onClick={() => moveTab(activeIndex, activeIndex + 1)}
                    >
                        <ChevronRight size={14} aria-hidden="true" />
                    </IconButton>
                </div>
            </div>
            <p id={`${baseId}-hint`} className="sr-only">
                Drag a source tab to reorder it. With a keyboard, press Alt plus Left or Right
                Arrow to move the focused tab. The arrow buttons move the selected tab.
            </p>
            <p role="status" aria-live="polite" className="sr-only">
                {announcement}
            </p>
        </div>
    );
}

function historyMeta(entry: MediaHistoryDto): string {
    if (entry.type === 'episode') {
        return `${entry.showTitle ?? 'Show'} · S${entry.seasonNumber ?? 1} E${
            entry.episodeNumber ?? 1
        } · ${entry.sourceName}`;
    }
    return `Movie · ${entry.sourceName}`;
}

function ContinueWatching({
    entries,
    sources,
    pending,
    onResume,
    onOpen,
    onRemove,
}: {
    entries: MediaHistoryDto[];
    sources: MediaSourceDto[];
    pending: boolean;
    onResume: (entry: MediaHistoryDto) => void;
    onOpen: (entry: MediaHistoryDto) => void;
    onRemove: (entry: MediaHistoryDto) => void;
}) {
    if (!pending && entries.length === 0) return null;

    return (
        <section aria-labelledby="continue-watching-title" className="mb-4 border-b border-border pb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                    <h2
                        id="continue-watching-title"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text"
                    >
                        <History size={14} aria-hidden="true" className="text-plex" />
                        Continue watching
                    </h2>
                    {pending ? null : (
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                            {entries.length}
                        </span>
                    )}
                </div>
                <p className="text-[11px] text-text-muted">
                    Resume a saved position or start the next episode
                </p>
            </div>

            {pending ? (
                <div className="mt-3 space-y-3" aria-hidden="true">
                    {[0, 1].map((index) => (
                        <div key={index} className="flex items-center gap-3">
                            <Skeleton className="h-14 w-9 shrink-0" />
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-2/3" />
                                <Skeleton className="h-3 w-1/2" />
                                <Skeleton className="h-1 w-full" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <ul className="mt-3 divide-y divide-border">
                    {entries.map(entry => {
                        const source = sources.find(item => item.id === entry.sourceId);
                        const unavailable = !source || !source.enabled || !source.connected;
                        const duration = entry.durationMs ?? 0;
                        const progress = duration > 0 ? entry.positionMs / duration : 0;
                        const remaining = duration > 0 ? Math.max(0, duration - entry.positionMs) : null;
                        const recommended = entry.recommended === true;
                        return (
                            <li key={entry.id} className="py-3 first:pt-1 last:pb-1">
                                <div className="flex items-start gap-3">
                                    <button
                                        type="button"
                                        onClick={() => onOpen(entry)}
                                        className="flex min-w-0 flex-1 items-center gap-3 rounded text-left transition-colors hover:text-blurple-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple/60"
                                        aria-label={`Open ${entry.title}`}
                                    >
                                        <Poster
                                            title={entry.title}
                                            seed={entry.itemId}
                                            src={entry.thumbUrl}
                                            showTitle={false}
                                            className="h-14 w-9 shrink-0 rounded border border-border"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-text">
                                                {entry.title}
                                                {recommended ? (
                                                    <span className="ml-2 inline-flex rounded-full border border-plex/40 bg-plex/10 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-[0.08em] text-plex">
                                                        Up next
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                                                {recommended ? 'Next episode · ' : ''}
                                                {historyMeta(entry)}
                                            </span>
                                            <span className="mt-0.5 block text-[11px] text-text-faint">
                                                {recommended
                                                    ? 'Starts from the beginning'
                                                    : `${formatElapsed(entry.positionMs)} watched${
                                                          remaining === null
                                                              ? ''
                                                              : ` · ${formatDuration(remaining)} left`
                                                      }`}
                                                {unavailable ? ' · source offline' : ''}
                                            </span>
                                        </span>
                                    </button>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<Play size={12} aria-hidden="true" />}
                                        disabled={unavailable}
                                        onClick={() => onResume(entry)}
                                    >
                                        {recommended ? 'Play next' : 'Resume'}
                                    </Button>
                                    {recommended ? null : (
                                        <IconButton
                                            label={`Remove ${entry.title} from Continue watching`}
                                            size="sm"
                                            onClick={() => onRemove(entry)}
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </IconButton>
                                    )}
                                </div>
                                {duration > 0 && !recommended ? (
                                    <div className="mt-2 flex items-center gap-2 pl-12">
                                        <ProgressBar
                                            value={entry.positionMs}
                                            max={duration}
                                            tone="plex"
                                            label={`${entry.title} progress`}
                                            className="h-1"
                                        />
                                        <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-muted">
                                            {formatPercent(progress)}
                                        </span>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
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
    const queue = useMediaQueue();
    const playback = usePlayback();
    const now = useNow(1_000);
    const remove = useRemoveQueueItem();
    const move = useMoveQueueItem();
    const shuffle = useShuffleQueue();
    const clear = useClearQueue();
    const pause = usePausePlayback();
    const resume = useResumePlayback();
    const seek = useSeekPlayback();
    const skip = useSkipPlayback();
    const stop = useStopPlayback();
    const settings = useSettings();
    const updatePlayback = useUpdatePlaybackPreferences();
    const setSubtitle = useSetSubtitle();
    const currentItem = useCurrentMediaItem(
        playback.data?.mode === 'media',
        playback.data?.queueItemId ?? null
    );
    const toast = useToast();
    const [confirmClear, setConfirmClear] = useState(false);

    const queued = (queue.data ?? [])
        .filter((item) => item.status === 'queued')
        .sort((a, b) => a.position - b.position);
    const failed = (queue.data ?? []).filter((item) => item.status === 'failed');
    const currentQueueItem = queue.data?.find((item) => item.id === playback.data?.queueItemId);
    const elapsed = playbackPositionMs(playback.data, now);
    const duration = playback.data?.durationMs ?? currentQueueItem?.durationMs ?? 0;
    const subtitleStreams =
        currentItem.data?.streams.filter((stream) => stream.type === 'subtitle') ?? [];
    const subtitleValue = currentQueueItem ? String(currentQueueItem.subtitleMode) : 'auto';

    if (!open) return null;

    const reportError = (error: unknown) =>
        toast({
            title: 'Queue action failed',
            description: errorMessage(error),
            tone: 'error',
        });

    const seekTo = (seconds: number) =>
        seek.mutate(seconds, {
            onError: reportError,
            onSuccess: () => toast({ title: 'Playback seeked', tone: 'success' }),
        });

    return (
        <aside
            id="media-queue"
            aria-labelledby="media-queue-title"
            className="oc-panel-enter min-w-0 scroll-mt-20 rounded-xl border border-border bg-surface xl:sticky xl:top-[68px] xl:max-h-[calc(100dvh-5.25rem)] xl:overflow-y-auto"
        >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-baseline gap-2">
                    <h2 id="media-queue-title" className="text-sm font-semibold text-text">
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

            {playback.data?.mode === 'media' && currentQueueItem ? (
                <div className="border-b border-border px-4 py-3">
                    <div className="flex items-start gap-3">
                        <Poster
                            title={currentQueueItem.title}
                            seed={currentQueueItem.itemId}
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
                            <SeekBar
                                positionMs={Math.min(elapsed, duration)}
                                durationMs={duration}
                                onSeek={seekTo}
                                disabled={seek.isPending}
                                label="Seek current Media item"
                            />
                            <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-text-muted">
                                <span>{formatElapsed(Math.min(elapsed, duration))}</span>
                                <span>{formatDuration(duration)}</span>
                            </div>
                        </div>
                    ) : null}
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <Field
                            label="Subtitles"
                            htmlFor="current-subtitles"
                            hint="Changes apply to the live stream."
                        >
                            <Select
                                id="current-subtitles"
                                value={subtitleValue}
                                disabled={setSubtitle.isPending}
                                onChange={(event) =>
                                    setSubtitle.mutate(toSubtitleMode(event.target.value), {
                                        onSuccess: () =>
                                            toast({ title: 'Subtitles changed', tone: 'success' }),
                                        onError: reportError,
                                    })
                                }
                            >
                                <option value="auto">Auto (match the file)</option>
                                <option value="off">Off</option>
                                {subtitleStreams.map((stream) => (
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
                    </div>
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
                        description="Add a movie or episode to line it up for the on-demand channel."
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
                                    seed={item.itemId}
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
                                    {item.error ?? 'The media source could not start this item.'}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="space-y-3 border-t border-border px-4 py-3">
                <Switch
                    checked={settings.data?.playback.autoplayNextEpisode ?? false}
                    disabled={!settings.data || updatePlayback.isPending}
                    onChange={(event) =>
                        updatePlayback.mutate(
                            { autoplayNextEpisode: event.target.checked },
                            { onError: reportError }
                        )
                    }
                    label="Autoplay next episode"
                    description="Queue the next episode when this one ends."
                />
                <Switch
                    checked={settings.data?.playback.autoSkipIntro ?? false}
                    disabled={!settings.data || updatePlayback.isPending}
                    onChange={(event) =>
                        updatePlayback.mutate(
                            { autoSkipIntro: event.target.checked },
                            { onError: reportError }
                        )
                    }
                    label="Skip intros"
                    description="Jump past Plex intro markers."
                />
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
                    {playback.data?.mode === 'media' ? (
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
                        disabled={playback.data?.mode !== 'media' || skip.isPending}
                        onClick={() =>
                            skip.mutate(undefined, {
                                onError: reportError,
                                onSuccess: (state) =>
                                    toast({
                                        title: state.mode === 'media' ? 'Skipped to the next item' : 'Queue finished',
                                        tone: 'success',
                                    }),
                            })
                        }
                    >
                        <SkipForward size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label="Stop Media playback"
                        size="sm"
                        disabled={playback.data?.mode !== 'media' || stop.isPending}
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
                description="Queued items are removed. The current Media playback keeps running."
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
            title={target?.kind === 'placeholder' ? 'Open the media channel' : 'Start playback'}
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
                                title={
                                    target.kind === 'item'
                                        ? target.item.title
                                        : target.kind === 'history'
                                          ? target.entry.title
                                          : target.queueItem.title
                                }
                                seed={
                                    target.kind === 'item'
                                        ? target.item.itemId
                                        : target.kind === 'history'
                                          ? target.entry.itemId
                                          : target.queueItem.itemId
                                }
                                src={
                                    target.kind === 'item'
                                        ? target.item.thumbUrl
                                        : target.kind === 'history'
                                          ? target.entry.thumbUrl
                                          : target.queueItem.thumbUrl
                                }
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
                            ) : target.kind === 'history' ? (
                                <p className="mt-1 text-[11px] text-text-faint">
                                    {qualityLabel(target.entry.quality)}
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

export default function MediaPage() {
    const [libraryKey, setLibraryKey] = useState('');
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [view, setView] = useState<View>(() => {
        const params = new URLSearchParams(window.location.search);
        const requestedSource = Number(params.get('source'));
        const requestedItem = params.get('item');
        return requestedItem && Number.isInteger(requestedSource) && requestedSource > 0
            ? { kind: 'item', itemKey: requestedItem }
            : { kind: 'library' };
    });
    const skipViewReset = useRef(true);
    const [queueOpen, setQueueOpen] = useState(true);
    const [prompt, setPrompt] = useState<PlayTarget | null>(null);
    const [conflict, setConflict] = useState<PlayTarget | null>(null);
    const [promptError, setPromptError] = useState<string | null>(null);
    const [promptBusy, setPromptBusy] = useState(false);
    const [quality, setQuality] = useState<MediaQuality>('1080p-8');
    const [subtitle, setSubtitle] = useState('auto');

    const mediaSources = useMediaSources();
    const sourceList = mediaSources.data ?? [];
    const [selectedSourceId, setSelectedSourceId] = useState(() => {
        const requested = Number(new URLSearchParams(window.location.search).get('source'));
        return Number.isInteger(requested) && requested > 0 ? requested : 0;
    });
    const selectedSource = sourceList.find((source) => source.id === selectedSourceId) ?? sourceList[0] ?? null;
    const sourceId = selectedSource?.id ?? 0;

    const libraries = useMediaLibraries(sourceId);
    const discord = useDiscordStatus();
    const items = useMediaItems(sourceId, libraryKey, deferredSearch);
    const queue = useMediaQueue();
    const history = useMediaHistory(12);
    const playback = usePlayback();
    const detail = useMediaItem(
        sourceId,
        view.kind === 'show'
            ? view.showKey
            : view.kind === 'season'
              ? view.seasonKey
              : view.kind === 'item'
                ? view.itemKey
                : null
    );
    const show = useMediaItem(
        sourceId,
        view.kind === 'show'
            ? view.showKey
            : view.kind === 'season'
              ? view.showKey
              : view.kind === 'item'
                ? (view.showKey ?? null)
                : null
    );
    const season = useMediaItem(
        sourceId,
        view.kind === 'season'
            ? view.seasonKey
            : view.kind === 'item'
              ? (view.seasonKey ?? null)
              : null
    );
    const children = useMediaChildren(
        sourceId,
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
    const startMedia = useStartMediaPlayback();
    const playQueue = usePlayQueueItem();
    const placeholder = useStartPlaceholder();
    const validateSource = useValidateMediaSource();
    const removeHistory = useRemoveMediaHistory();
    const reorderSources = useReorderMediaSources();
    const toast = useToast();

    useEffect(() => {
        if (sourceList.length > 0 && !sourceList.some((source) => source.id === selectedSourceId)) {
            setSelectedSourceId(sourceList[0]?.id ?? 0);
        }
    }, [mediaSources.data, selectedSourceId]);

    useEffect(() => {
        setLibraryKey('');
        setSearch('');
        if (skipViewReset.current) {
            skipViewReset.current = false;
            return;
        }
        setView({ kind: 'library' });
    }, [selectedSourceId]);

    const activeLibrary = libraries.data?.find((library) => library.key === libraryKey);
    const queuedCount = queue.data?.filter((item) => item.status === 'queued').length ?? 0;
    const currentQueueItem = queue.data?.find((item) => item.id === playback.data?.queueItemId);
    const isCurrentItem = Boolean(
        itemDetail && currentQueueItem?.itemId === itemDetail.itemId && currentQueueItem.sourceId === sourceId
    );
    const busy = playback.data?.mode === 'iptv' || playback.data?.mode === 'media';
    const historyEntry =
        itemDetail && history.data
            ? (history.data.find(
                  (entry) =>
                      entry.sourceId === sourceId &&
                      entry.itemId === itemDetail.itemId &&
                      !entry.recommended
              ) ?? null)
            : null;

    useEffect(() => {
        if (!libraries.data) return;
        const enabled = libraries.data.filter(isPlayableLibrary).filter((library) => library.enabled);
        if (enabled.length === 0) {
            if (libraryKey !== '') {
                setLibraryKey('');
                setSearch('');
            }
            return;
        }
        if (!enabled.some((library) => library.key === libraryKey)) {
            setLibraryKey(enabled[0].key);
            setSearch('');
        }
    }, [libraries.data, libraryKey]);

    useEffect(() => {
        if (itemDetail) {
            setQuality(selectedSource?.defaultQuality ?? '1080p-8');
            setSubtitle('auto');
        }
    }, [itemDetail?.itemId, selectedSource?.defaultQuality]);

    const resetToLibrary = () => {
        setView({ kind: 'library' });
    };

    const back = () => {
        if (view.kind === 'item') {
            if (view.seasonKey && view.showKey) {
                setView({ kind: 'season', showKey: view.showKey, seasonKey: view.seasonKey });
            } else if (view.showKey) {
                setView({ kind: 'show', showKey: view.showKey });
            } else if (itemDetail?.showItemId) {
                setView({ kind: 'show', showKey: itemDetail.showItemId });
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
                sourceId,
                itemId: itemDetail.itemId,
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
                                .getElementById('media-queue')
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

    const playNow = (startOver = false) => {
        if (!itemDetail) return;
        requestPlay({
            kind: 'item',
            item: itemDetail,
            quality,
            subtitleMode: toSubtitleMode(subtitle),
            startOver,
        });
    };

    const openHistoryItem = (entry: MediaHistoryDto) => {
        if (entry.sourceId !== selectedSourceId) {
            skipViewReset.current = true;
            setSelectedSourceId(entry.sourceId);
        }
        setView({ kind: 'item', itemKey: entry.itemId });
    };

    const autoPlay = useRef(
        new URLSearchParams(window.location.search).get('play') === '1'
    );

    useEffect(() => {
        if (!autoPlay.current || !itemDetail || history.isPending) return;
        if (itemDetail.type !== 'movie' && itemDetail.type !== 'episode') return;
        autoPlay.current = false;
        const saved =
            history.data?.find(
                (entry) => entry.sourceId === sourceId && entry.itemId === itemDetail.itemId
            ) ?? null;
        requestPlay(
            saved
                ? { kind: 'history', entry: saved }
                : {
                      kind: 'item',
                      item: itemDetail,
                      quality,
                      subtitleMode: toSubtitleMode(subtitle),
                      startOver: false,
                  }
        );
        const url = new URL(window.location.href);
        url.searchParams.delete('play');
        window.history.replaceState(window.history.state, '', url);
    }, [itemDetail, history.isPending, history.data, quality, subtitle, sourceId]);

    const confirmPlayback = async (guildId: string, voiceChannelId: string) => {
        if (!prompt) return;
        setPromptBusy(true);
        setPromptError(null);
        try {
            let title = 'On demand';
            if (prompt.kind === 'item') {
                await startMedia.mutateAsync({
                    sourceId: prompt.item.sourceId,
                    itemId: prompt.item.itemId,
                    quality: prompt.quality,
                    subtitleMode: prompt.subtitleMode,
                    guildId,
                    voiceChannelId,
                    startOver: prompt.startOver ?? false,
                });
                title = prompt.item.title;
            } else if (prompt.kind === 'history') {
                await startMedia.mutateAsync({
                    sourceId: prompt.entry.sourceId,
                    itemId: prompt.entry.itemId,
                    quality: prompt.entry.quality,
                    subtitleMode: prompt.entry.subtitleMode,
                    guildId,
                    voiceChannelId,
                    startOver: false,
                });
                title = prompt.entry.title;
            } else if (prompt.kind === 'queue') {
                await playQueue.mutateAsync({ id: prompt.queueItem.id, guildId, voiceChannelId });
                title = prompt.queueItem.title;
            } else {
                await placeholder.mutateAsync({ sourceId: prompt.sourceId, guildId, voiceChannelId });
                title = 'On demand';
            }
            const channelName = discord.data?.guilds
                .flatMap((guild) => guild.voiceChannels)
                .find((channel) => channel.id === voiceChannelId)?.name;
            toast({
                title: prompt.kind === 'placeholder' ? 'Media channel opened' : `Playing ${title}`,
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
    } else if (view.kind === 'item' && itemDetail?.showItemId) {
        breadcrumbs.push({
            label: itemDetail.showTitle ?? 'Series',
            onClick: () => setView({ kind: 'show', showKey: itemDetail.showItemId! }),
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
                title="Media"
                meta={
                    sourceList.length > 0
                        ? `${sourceList.length} source${sourceList.length === 1 ? '' : 's'} · ${
                              sourceList.filter((source) => source.connected).length
                          } connected`
                        : 'Plex and Jellyfin on demand'
                }
                actions={
                    <>
                        <Link
                            to="/media/sources"
                            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                        >
                            <Server size={14} aria-hidden="true" />
                            Manage sources
                        </Link>
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
                {sourceList.length > 0 ? (
                    <SourceTabs
                        sources={sourceList}
                        value={sourceId}
                        onChange={setSelectedSourceId}
                        onReorder={(ids) =>
                            reorderSources.mutate(ids, {
                                onError: (error) =>
                                    toast({
                                        title: 'Could not reorder sources',
                                        description: errorMessage(error),
                                        tone: 'error',
                                    }),
                            })
                        }
                    />
                ) : null}
                {selectedSource && (!selectedSource.connected || selectedSource.error) ? (
                    <Notice
                        tone="warn"
                        title={`${selectedSource.name} needs attention`}
                        action={
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<RefreshCw size={13} aria-hidden="true" />}
                                loading={validateSource.isPending}
                                onClick={() =>
                                    validateSource.mutate(selectedSource.id, {
                                        onSuccess: (source) =>
                                            toast({
                                                title: source.connected ? 'Connection is healthy' : 'Connection failed',
                                                description: source.error ?? undefined,
                                                tone: source.connected ? 'success' : 'error',
                                            }),
                                    })
                                }
                            >
                                Retry
                            </Button>
                        }
                    >
                        {selectedSource.error ??
                            `${selectedSource.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'} is not reachable. Check the server URL and token.`}
                    </Notice>
                ) : null}

                <div className={cn('grid min-w-0 grid-cols-1 gap-4', queueOpen && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
                    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
                        {view.kind === 'library' ? (
                            <div className="p-3 sm:p-4">
                                <ContinueWatching
                                    entries={history.data ?? []}
                                    sources={sourceList}
                                    pending={history.isPending && sourceList.length > 0}
                                    onResume={(entry) => requestPlay({ kind: 'history', entry })}
                                    onOpen={openHistoryItem}
                                    onRemove={(entry) =>
                                        removeHistory.mutate(entry.id, {
                                            onSuccess: () =>
                                                toast({
                                                    title: 'Removed from Continue watching',
                                                    description: entry.title,
                                                    tone: 'success',
                                                }),
                                            onError: (error) =>
                                                toast({
                                                    title: 'Could not remove the entry',
                                                    description: errorMessage(error),
                                                    tone: 'error',
                                                }),
                                        })
                                    }
                                />
                                {mediaSources.isPending ? (
                                    <div className="space-y-4" aria-hidden="true">
                                        <Skeleton className="h-9 w-72" />
                                        <Skeleton className="h-9 w-full max-w-sm" />
                                    </div>
                                ) : sourceList.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={Server}
                                        title="No media sources"
                                        description="Add a Plex or Jellyfin server to browse libraries and open a virtual channel in Discord."
                                        action={
                                            <Link
                                                to="/media/sources"
                                                className={buttonStyles({ variant: 'primary', size: 'sm' })}
                                            >
                                                <Plus size={13} aria-hidden="true" />
                                                Add media source
                                            </Link>
                                        }
                                    />
                                ) : libraries.isPending ? (
                                    <div className="space-y-4" aria-hidden="true">
                                        <Skeleton className="h-9 w-72" />
                                        <Skeleton className="h-9 w-full max-w-sm" />
                                    </div>
                                ) : libraries.isError ? (
                                    <ErrorState
                                        compact
                                        title="Libraries could not load"
                                        error={libraries.error}
                                        onRetry={() => void libraries.refetch()}
                                    />
                                ) : libraryList.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={Film}
                                        title="No media libraries"
                                        description="Check that the token can see at least one movie or show library, then validate the source again."
                                        action={
                                            <Link
                                                to="/media/sources"
                                                className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                                            >
                                                Edit source
                                            </Link>
                                        }
                                    />
                                ) : enabledLibraries.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={Library}
                                        title="No playable libraries enabled"
                                        description="Enable at least one movie or TV show library to browse and play media content."
                                        action={
                                            <Link
                                                to="/media/sources"
                                                className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                                            >
                                                Choose libraries
                                            </Link>
                                        }
                                    />
                                ) : (
                                    <Tabs
                                        label="Media libraries"
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
                                                <label htmlFor="media-search" className="sr-only">
                                                    Search this library
                                                </label>
                                                <Search
                                                    size={14}
                                                    aria-hidden="true"
                                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                                                />
                                                <Input
                                                    id="media-search"
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
                                                            : 'The media source returned no playable items for this library.'
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
                                                        <MediaCard
                                                            key={item.itemId}
                                                            item={item}
                                                            onOpen={() => {
                                                                if (item.type === 'show') {
                                                                    setView({ kind: 'show', showKey: item.itemId });
                                                                } else {
                                                                    setView({ kind: 'item', itemKey: item.itemId });
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
                                        title="This Media item could not load"
                                    />
                                ) : itemDetail ? (
                                    <div className="p-4 sm:p-5">
                                        <div className="grid grid-cols-1 gap-5 md:grid-cols-[160px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)]">
                                            <Poster
                                                title={itemDetail.title}
                                                seed={itemDetail.itemId}
                                                src={itemDetail.thumbUrl}
                                                className="w-full max-w-[180px] rounded-lg border border-border"
                                            />
                                            <div className="min-w-0">
                                                <h2 className="text-[clamp(1.35rem,1.1rem+1.2vw,2rem)] font-semibold leading-tight tracking-[-0.02em] text-text">
                                                    {itemDetail.title}
                                                </h2>
                                                <p className="mt-1 text-sm text-text-muted">
                                                    {itemDetail.type === 'episode' ? (
                                                        <>
                                                            {itemDetail.showItemId ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setView({
                                                                            kind: 'show',
                                                                            showKey: itemDetail.showItemId!,
                                                                        })
                                                                    }
                                                                    className="rounded font-medium text-blurple-text transition-colors hover:text-[#a5acff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple/60"
                                                                >
                                                                    {itemDetail.showTitle ?? 'Show'}
                                                                </button>
                                                            ) : (
                                                                (itemDetail.showTitle ?? 'Show')
                                                            )}
                                                            {` · Season ${itemDetail.seasonNumber ?? 1}, Episode ${itemDetail.episodeNumber ?? 1}`}
                                                        </>
                                                    ) : itemDetail.type === 'season' ? (
                                                        `${itemDetail.showTitle ?? 'Show'} · Season ${itemDetail.seasonNumber ?? 1}`
                                                    ) : itemDetail.type === 'show' ? (
                                                        `${itemDetail.year ?? 'Unknown year'} · Series`
                                                    ) : (
                                                        `${itemDetail.year ?? 'Unknown year'} · ${formatDuration(itemDetail.durationMs)}`
                                                    )}
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
                                                                        setQuality(event.target.value as MediaQuality)
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
                                                                onClick={() => playNow(false)}
                                                            >
                                                                {historyEntry
                                                                    ? `Resume from ${formatElapsed(historyEntry.positionMs)}`
                                                                    : 'Play now'}
                                                            </Button>
                                                            {historyEntry ? (
                                                                <Button
                                                                    variant="secondary"
                                                                    onClick={() => playNow(true)}
                                                                >
                                                                    Start over
                                                                </Button>
                                                            ) : null}
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
                                                            {historyEntry
                                                                ? `Saved progress: ${formatElapsed(historyEntry.positionMs)}. Playback starts in a Discord voice channel you choose next.`
                                                                : 'Playback starts in a Discord voice channel you choose next.'}
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
                                                        description="The media source returned no children for this item."
                                                    />
                                                ) : itemDetail.type === 'show' ? (
                                                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                                                        {childItems.map((seasonItem) => (
                                                            <button
                                                                key={seasonItem.itemId}
                                                                type="button"
                                                                onClick={() =>
                                                                    setView({
                                                                        kind: 'season',
                                                                        showKey: view.kind === 'show' ? view.showKey : itemDetail.itemId,
                                                                        seasonKey: seasonItem.itemId,
                                                                    })
                                                                }
                                                                className="group min-w-0 text-left"
                                                            >
                                                                <Poster
                                                                    title={seasonItem.title}
                                                                    seed={seasonItem.itemId}
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
                                                            <li key={episode.itemId}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setView({
                                                                            kind: 'item',
                                                                            itemKey: episode.itemId,
                                                                            showKey: view.kind === 'season' ? view.showKey : show.data?.itemId,
                                                                            seasonKey: view.kind === 'season' ? view.seasonKey : undefined,
                                                                        })
                                                                    }
                                                                    className="flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-white/[0.02]"
                                                                >
                                                                    <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums text-text-faint">
                                                                        {episode.episodeNumber ?? '-'}
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
                        onRequestPlaceholder={() => requestPlay({ kind: 'placeholder', sourceId })}
                        onBrowse={() => {
                            setQueueOpen(false);
                            setView({ kind: 'library' });
                        }}
                    />
                </div>
            </div>

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

function MediaCard({ item, onOpen }: { item: MediaItemDto; onOpen: () => void }) {
    return (
        <button type="button" onClick={onOpen} className="group min-w-0 text-left">
            <div className="relative overflow-hidden rounded-lg border border-border transition-colors group-hover:border-border-strong">
                <Poster
                    title={item.title}
                    seed={item.itemId}
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
