import {
    ArrowRight,
    Clock,
    Film,
    ListPlus,
    MessagesSquare,
    Pause,
    Play,
    Radio,
    RefreshCw,
    SkipForward,
    Square,
    TriangleExclamationPoint,
    Users,
    Volume2,
    type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PlaybackStateDto, QueueItemDto, SourceDto } from '@shared/types';
import {
    ChannelMark,
    EmptyState,
    ErrorState,
    Field,
    PageHeader,
    Poster,
    ProgressBar,
    SeekBar,
    Select,
    Skeleton,
    StatusPill,
    buttonStyles,
    useToast,
} from '@/components';
import {
    useDiscordStatus,
    useLogs,
    useNow,
    usePausePlayback,
    usePlayback,
    useCurrentMediaItem,
    useMediaHistory,
    useMediaQueue,
    useMediaSources,
    useResumePlayback,
    useSeekPlayback,
    useSetSubtitle,
    useSkipPlayback,
    useSources,
    useStopPlayback,
} from '@/lib/hooks';
import { cn } from '@/lib/cn';
import {
    formatClock,
    formatCount,
    formatDuration,
    formatElapsed,
    formatRelative,
    formatUptime,
} from '@/lib/format';
import { playbackPositionMs } from '@/lib/playback';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function toSubtitleMode(value: string): 'auto' | 'off' | number {
    if (value === 'auto' || value === 'off') return value;
    return Number(value);
}

type PlaybackMutation = ReturnType<typeof useStopPlayback>;

function MetaItem({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            <Icon size={14} aria-hidden="true" className="shrink-0 text-text-faint" />
            <span className="truncate">{children}</span>
        </span>
    );
}

function PosterSlot({ playback }: { playback: PlaybackStateDto }) {
    if (playback.mode === 'iptv') {
        return (
            <div className="relative flex aspect-[2/3] w-[84px] shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-raised sm:w-[124px] sm:gap-3">
                <ChannelMark name={playback.title ?? 'Live'} size="md" className="sm:h-16 sm:w-16" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-live">Live</span>
            </div>
        );
    }
    if (playback.mode === 'media') {
        return (
            <Poster
                title={playback.title ?? 'On demand'}
                seed={playback.title ?? 'media'}
                src={playback.posterUrl}
                showTitle={false}
                className="w-[84px] shrink-0 rounded-lg border border-border sm:w-[124px]"
            />
        );
    }
    if (playback.mode === 'placeholder') {
        return (
            <div className="flex aspect-[2/3] w-[84px] shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-plex/40 bg-plex/5 px-2 text-center sm:w-[124px]">
                <Film size={26} aria-hidden="true" className="text-plex" />
                <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-plex">Hold</span>
            </div>
        );
    }
    return (
        <div className="flex aspect-[2/3] w-[84px] shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-bg px-2 text-center sm:w-[124px]">
            <Radio size={22} aria-hidden="true" className="text-text-faint" />
            <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-faint">Idle</span>
        </div>
    );
}

function LivePlaybackCard() {
    const playback = usePlayback();
    const queue = useMediaQueue();
    const mediaSources = useMediaSources();
    const stop = useStopPlayback();
    const pause = usePausePlayback();
    const resume = useResumePlayback();
    const seek = useSeekPlayback();
    const skip = useSkipPlayback();
    const setSubtitle = useSetSubtitle();
    const currentItem = useCurrentMediaItem(
        playback.data?.mode === 'media',
        playback.data?.queueItemId ?? null
    );
    const toast = useToast();
    const now = useNow(1_000);

    if (playback.isPending) {
        return (
            <section className="rounded-xl border border-border bg-surface p-5">
                <div className="flex gap-4">
                    <Skeleton className="h-[170px] w-[124px]" />
                    <div className="flex-1 space-y-3">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-8 w-2/3" />
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-8 w-48" />
                    </div>
                </div>
            </section>
        );
    }
    if (playback.isError || !playback.data) {
        return (
            <section className="rounded-xl border border-border bg-surface">
                <ErrorState
                    compact
                    title="Playback state unavailable"
                    error={playback.error}
                    onRetry={() => void playback.refetch()}
                />
            </section>
        );
    }

    const state = playback.data;
    const queueItem: QueueItemDto | undefined = queue.data?.find(
        (item) => item.id === state.queueItemId
    );
    const activeSource = mediaSources.data?.find((source) => source.id === state.sourceId);
    const elapsed = playbackPositionMs(state, now);
    const duration = state.durationMs ?? queueItem?.durationMs ?? 0;
    const shownElapsed = duration > 0 ? Math.min(elapsed, duration) : elapsed;
    const subtitleStreams =
        currentItem.data?.streams.filter((stream) => stream.type === 'subtitle') ?? [];
    const subtitleValue = queueItem ? String(queueItem.subtitleMode) : 'auto';
    const tone = state.mode === 'iptv' ? 'live' : state.mode === 'media' ? 'plex' : 'neutral';

    const run = (action: PlaybackMutation, title: string, description?: string) => {
        action.mutate(undefined, {
            onSuccess: () => toast({ title, description, tone: 'success' }),
            onError: (error) =>
                toast({
                    title: 'Playback did not change',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    const seekTo = (seconds: number) => {
        seek.mutate(seconds, {
            onSuccess: () => toast({ title: 'Playback seeked', tone: 'success' }),
            onError: (error) =>
                toast({
                    title: 'Seek failed',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className={cn(
                            'size-1.5 rounded-full',
                            state.mode === 'iptv' || state.mode === 'media'
                                ? state.paused
                                    ? 'bg-warn'
                                    : 'oc-live-dot bg-live'
                                : state.mode === 'placeholder'
                                  ? 'bg-plex'
                                  : 'bg-text-faint'
                        )}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                        {state.mode === 'idle' ? 'Playback' : 'Now playing'}
                    </span>
                    <StatusPill tone={tone} pulse={state.mode === 'iptv' || (state.mode === 'media' && !state.paused)}>
                        {state.mode === 'iptv'
                            ? 'IPTV'
                            : state.mode === 'media'
                              ? state.paused
                                  ? 'Paused'
                                  : 'On demand'
                              : state.mode === 'placeholder'
                                ? 'Placeholder'
                                : 'Idle'}
                    </StatusPill>
                </div>
                {state.mode !== 'idle' ? (
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                        {formatUptime(state.startedAt, now)}
                    </span>
                ) : null}
            </div>

            <div className="p-4 sm:p-5">
                <div className="flex items-start gap-4 sm:gap-5">
                    <PosterSlot playback={state} />
                    <div className="min-w-0 flex-1">
                        {state.mode === 'idle' ? (
                            <>
                                <h2 className="text-[clamp(1.4rem,1.15rem+1.1vw,1.95rem)] font-semibold leading-tight tracking-[-0.02em] text-text">
                                    Nothing is playing
                                </h2>
                                <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-text-muted">
                                    The streamer is connected and waiting. Start a media item or open the guide to find
                                    something to watch.
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Link to="/media" className={buttonStyles({ variant: 'primary' })}>
                                        <Film size={15} aria-hidden="true" />
                                        Open media
                                    </Link>
                                    <Link to="/channels" className={buttonStyles({ variant: 'secondary' })}>
                                        Browse channels
                                    </Link>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="text-[clamp(1.4rem,1.15rem+1.1vw,1.95rem)] font-semibold leading-tight tracking-[-0.02em] text-text">
                                    {state.title ?? 'Playback'}
                                </h2>
                                <p className="mt-1 truncate text-sm text-text-muted">{state.subtitle}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted">
                                    {state.guildName ? (
                                        <MetaItem icon={MessagesSquare}>{state.guildName}</MetaItem>
                                    ) : null}
                                    {state.voiceChannelName ? (
                                        <MetaItem icon={Volume2}>{state.voiceChannelName}</MetaItem>
                                    ) : null}
                                    <MetaItem icon={Users}>
                                        {formatCount(state.viewers)} {state.viewers === 1 ? 'viewer' : 'viewers'}
                                    </MetaItem>
                                    {state.mode === 'placeholder' ? (
                                        <MetaItem icon={Clock}>
                                            Leaves after {activeSource?.idleMinutes ?? 20} min idle
                                        </MetaItem>
                                    ) : null}
                                </div>

                                {state.mode === 'media' && duration > 0 ? (
                                    <div className="mt-4 max-w-xl">
                                        <SeekBar
                                            positionMs={shownElapsed}
                                            durationMs={duration}
                                            onSeek={seekTo}
                                            disabled={seek.isPending}
                                            label="Seek playback"
                                        />
                                        <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-text-muted">
                                            <span>{formatElapsed(shownElapsed)}</span>
                                            <span>{formatDuration(duration)}</span>
                                        </div>
                                    </div>
                                ) : null}

                                {state.mode === 'media' ? (
                                    <Field
                                        label="Subtitles"
                                        htmlFor="dashboard-subtitles"
                                        className="mt-3 max-w-xs"
                                        hint="Changes apply to the live stream."
                                    >
                                        <Select
                                            id="dashboard-subtitles"
                                            value={subtitleValue}
                                            disabled={setSubtitle.isPending}
                                            onChange={(event) =>
                                                setSubtitle.mutate(
                                                    toSubtitleMode(event.target.value),
                                                    {
                                                        onSuccess: () =>
                                                            toast({
                                                                title: 'Subtitles changed',
                                                                tone: 'success',
                                                            }),
                                                        onError: (error) =>
                                                            toast({
                                                                title: 'Subtitle change failed',
                                                                description: errorMessage(error),
                                                                tone: 'error',
                                                            }),
                                                    }
                                                )
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
                                ) : null}

                                {state.mode === 'placeholder' ? (
                                    <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-muted">
                                        This virtual channel shows the OrbisCast placeholder until you queue a media
                                        item. It is replaceable at any time.
                                    </p>
                                ) : null}

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {state.mode === 'media' ? (
                                        <>
                                            {state.paused ? (
                                                <button
                                                    type="button"
                                                    className={buttonStyles({ variant: 'primary' })}
                                                    onClick={() => run(resume, 'Playback resumed')}
                                                    disabled={resume.isPending}
                                                >
                                                    <Play size={15} aria-hidden="true" />
                                                    Resume
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={buttonStyles({ variant: 'secondary' })}
                                                    onClick={() => run(pause, 'Playback paused')}
                                                    disabled={pause.isPending}
                                                >
                                                    <Pause size={15} aria-hidden="true" />
                                                    Pause
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className={buttonStyles({ variant: 'secondary' })}
                                                onClick={() => run(skip, 'Skipped to the next item')}
                                                disabled={skip.isPending}
                                            >
                                                <SkipForward size={15} aria-hidden="true" />
                                                Skip
                                            </button>
                                        </>
                                    ) : null}
                                    <button
                                        type="button"
                                        className={buttonStyles({ variant: 'secondary' })}
                                        onClick={() => run(stop, 'Playback stopped')}
                                        disabled={stop.isPending}
                                    >
                                        <Square size={14} aria-hidden="true" />
                                        Stop
                                    </button>
                                    {state.mode === 'iptv' ? (
                                        <Link to="/iptv?tab=guide" className={buttonStyles({ variant: 'ghost' })}>
                                            Open guide
                                            <ArrowRight size={14} aria-hidden="true" />
                                        </Link>
                                    ) : null}
                                    {state.mode === 'placeholder' ? (
                                        <Link to="/media" className={buttonStyles({ variant: 'secondary' })}>
                                            Open queue
                                        </Link>
                                    ) : null}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

function UpNextCard() {
    const queue = useMediaQueue();
    const pending = queue.data
        ?.filter((item) => item.status === 'queued')
        .sort((a, b) => a.position - b.position) ?? [];
    const failed = queue.data?.filter((item) => item.status === 'failed') ?? [];

    return (
        <section className="flex flex-col rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-text">Up next</h2>
                    {queue.data ? (
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                            {pending.length}
                        </span>
                    ) : null}
                </div>
                <Link
                    to="/media"
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-blurple-text hover:text-[#a5acff]"
                >
                    Open queue
                    <ArrowRight size={13} aria-hidden="true" />
                </Link>
            </div>
            <div className="min-h-0 flex-1 px-4 py-3">
                {queue.isPending ? (
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="flex items-center gap-3">
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
                ) : pending.length === 0 ? (
                    <EmptyState
                        compact
                        icon={ListPlus}
                        title="The queue is empty"
                        description="Choose a movie or episode in the media library and add it to the queue."
                        action={
                            <Link to="/media" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                Browse media
                            </Link>
                        }
                    />
                ) : (
                    <ol className="divide-y divide-border">
                        {pending.slice(0, 3).map((item, index) => (
                            <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                                <span className="w-3 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-faint">
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
                                    <p className="truncate text-sm font-medium text-text">{item.title}</p>
                                    <p className="truncate text-xs text-text-muted">
                                        {item.showTitle
                                            ? `${item.showTitle} · S${item.seasonNumber} E${item.episodeNumber}`
                                            : 'Movie'}
                                    </p>
                                </div>
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
                                    {formatDuration(item.durationMs)}
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
                {failed.length > 0 ? (
                    <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-3 text-[11px] leading-relaxed text-danger">
                        <TriangleExclamationPoint size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {failed.length} queue item{failed.length === 1 ? '' : 's'} failed in the media library. Open the queue to
                        review.
                    </p>
                ) : null}
            </div>
            {pending.length > 3 ? (
                <div className="border-t border-border px-4 py-2 text-[11px] text-text-muted">
                    {pending.length - 3} more in the queue
                </div>
            ) : null}
        </section>
    );
}

function ContinueWatchingCard() {
    const history = useMediaHistory(4);
    const entries = history.data ?? [];

    if (!history.isPending && entries.length === 0) {
        return null;
    }

    return (
        <section className="rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-text">
                        <Clock size={14} aria-hidden="true" className="text-plex" />
                        Continue watching
                    </h2>
                    {history.data ? (
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                            {entries.length}
                        </span>
                    ) : null}
                </div>
                <Link
                    to="/media"
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-blurple-text hover:text-[#a5acff]"
                >
                    Open media
                    <ArrowRight size={13} aria-hidden="true" />
                </Link>
            </div>
            {history.isPending ? (
                <div className="space-y-3 px-4 py-4" aria-hidden="true">
                    {[0, 1].map((index) => (
                        <div key={index} className="flex items-center gap-3">
                            <Skeleton className="h-12 w-8 shrink-0" />
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-2/3" />
                                <Skeleton className="h-3 w-1/2" />
                                <Skeleton className="h-1 w-full" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : history.isError ? (
                <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
            ) : (
                <ul className="divide-y divide-border">
                    {entries.map((entry) => {
                        const duration = entry.durationMs ?? 0;
                        const recommended = entry.recommended === true;
                        return (
                            <li key={entry.id}>
                                <Link
                                    to={`/media?source=${entry.sourceId}&item=${encodeURIComponent(entry.itemId)}&play=1`}
                                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blurple/60"
                                >
                                    <Poster
                                        title={entry.title}
                                        seed={entry.itemId}
                                        src={entry.thumbUrl}
                                        showTitle={false}
                                        className="h-12 w-8 shrink-0 rounded border border-border"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-text">
                                            {entry.title}
                                            {recommended ? (
                                                <span className="ml-2 inline-flex rounded-full border border-plex/40 bg-plex/10 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-[0.08em] text-plex">
                                                    Up next
                                                </span>
                                            ) : null}
                                        </p>
                                        <p className="truncate text-[11px] text-text-muted">
                                            {entry.type === 'episode'
                                                ? `${entry.showTitle ?? 'Show'} · S${entry.seasonNumber ?? 1} E${entry.episodeNumber ?? 1}`
                                                : `Movie · ${entry.sourceName}`}
                                        </p>
                                        {duration > 0 && !recommended ? (
                                            <div className="mt-1.5 flex items-center gap-2">
                                                <ProgressBar
                                                    value={entry.positionMs}
                                                    max={duration}
                                                    tone="plex"
                                                    label={`${entry.title} progress`}
                                                    className="h-1"
                                                />
                                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                                                    {formatElapsed(entry.positionMs)}
                                                </span>
                                            </div>
                                        ) : recommended ? (
                                            <p className="mt-1 text-[10px] text-text-faint">
                                                Next episode · starts from the beginning
                                            </p>
                                        ) : null}
                                    </div>
                                    <span className="shrink-0 text-xs font-medium text-blurple-text">
                                        {recommended ? 'Play next' : 'Resume'}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function ConnectionBar() {
    const discord = useDiscordStatus();
    const media = useMediaSources();

    if (discord.isError || media.isError) {
        return (
            <section className="rounded-xl border border-border bg-surface">
                <ErrorState
                    compact
                    title="Connection status unavailable"
                    error={discord.error ?? media.error}
                    onRetry={() => {
                        void discord.refetch();
                        void media.refetch();
                    }}
                />
            </section>
        );
    }

    const botTone =
        discord.data?.bot === 'online' ? 'live' : discord.data?.bot === 'error' ? 'danger' : 'neutral';
    const streamerTone =
        discord.data?.streamer === 'online'
            ? 'live'
            : discord.data?.streamer === 'error'
              ? 'danger'
              : 'neutral';
    const mediaSource = media.data?.find((source) => source.enabled) ?? media.data?.[0];
    const mediaTone = mediaSource?.connected ? 'plex' : mediaSource?.error ? 'danger' : 'neutral';

    return (
        <section className="rounded-xl border border-border bg-surface">
            <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                            Bot
                        </dt>
                        <dd className="mt-1 truncate text-sm text-text">
                            {discord.isPending ? 'Checking' : (discord.data?.botTag ?? 'Not connected')}
                        </dd>
                        <dd className="mt-1 text-[11px] text-text-muted">
                            {discord.data ? `${discord.data.guilds.length} servers` : 'No status'}
                        </dd>
                    </div>
                    <StatusPill tone={botTone}>{discord.data?.bot ?? 'offline'}</StatusPill>
                </div>
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                            Streamer
                        </dt>
                        <dd className="mt-1 truncate text-sm text-text">
                            {discord.isPending ? 'Checking' : (discord.data?.streamerTag ?? 'Not connected')}
                        </dd>
                        <dd className="mt-1 text-[11px] text-text-muted">Sends video to Discord</dd>
                    </div>
                    <StatusPill tone={streamerTone}>{discord.data?.streamer ?? 'offline'}</StatusPill>
                </div>
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
                            Media
                        </dt>
                        <dd className="mt-1 truncate text-sm text-text">
                            {media.isPending
                                ? 'Checking'
                                : mediaSource
                                  ? `${mediaSource.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'} · ${mediaSource.name}`
                                  : 'Not configured'}
                        </dd>
                        <dd className="mt-1 truncate text-[11px] text-text-muted">
                            {mediaSource?.serverUrl ?? 'Add a source on the media page'}
                        </dd>
                    </div>
                    <StatusPill tone={mediaTone}>
                        {mediaSource?.connected ? 'connected' : mediaSource?.error ? 'error' : 'offline'}
                    </StatusPill>
                </div>
            </dl>
        </section>
    );
}

function sourceState(source: SourceDto): { label: string; tone: 'live' | 'danger' | 'warn' | 'neutral' } {
    if (!source.enabled) return { label: 'Disabled', tone: 'neutral' };
    if (source.lastError) return { label: 'Error', tone: 'danger' };
    if (source.refreshing) return { label: 'Refreshing', tone: 'warn' };
    return { label: 'Healthy', tone: 'live' };
}

function SourceHealthCard() {
    const sources = useSources();

    return (
        <section className="rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Source health</h2>
                <Link
                    to="/iptv"
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-blurple-text hover:text-[#a5acff]"
                >
                    Manage
                    <ArrowRight size={13} aria-hidden="true" />
                </Link>
            </div>
            {sources.isPending ? (
                <div className="space-y-3 px-4 py-4" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                        <div key={index} className="flex items-center justify-between gap-3">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-4 w-1/4" />
                        </div>
                    ))}
                </div>
            ) : sources.isError ? (
                <ErrorState compact error={sources.error} onRetry={() => void sources.refetch()} />
            ) : sources.data.length === 0 ? (
                <EmptyState
                    compact
                    icon={RefreshCw}
                    title="No sources yet"
                    description="Add an M3U playlist to start building the channel list."
                    action={
                        <Link to="/iptv" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                            Add a source
                        </Link>
                    }
                />
            ) : (
                <ul className="divide-y divide-border">
                    {sources.data.map((source) => {
                        const state = sourceState(source);
                        return (
                            <li key={source.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-text">{source.name}</p>
                                        <p className="mt-0.5 text-[11px] text-text-muted">
                                            {formatCount(source.channelCount)} channels ·{' '}
                                            {formatCount(source.visibleCount)} visible
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                                        <span className="text-[11px] text-text-faint">
                                            {formatRelative(source.lastRefreshedAt)}
                                        </span>
                                    </div>
                                </div>
                                {source.lastError ? (
                                    <p className="mt-2 line-clamp-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
                                        <TriangleExclamationPoint
                                            size={13}
                                            aria-hidden="true"
                                            className="mt-0.5 shrink-0"
                                        />
                                        {source.lastError}
                                    </p>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function RecentLogsCard() {
    const logs = useLogs(6);
    const items = logs.data?.items ?? [];

    return (
        <section className="rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-text">Recent logs</h2>
                <Link
                    to="/logs"
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-blurple-text hover:text-[#a5acff]"
                >
                    Open logs
                    <ArrowRight size={13} aria-hidden="true" />
                </Link>
            </div>
            {logs.isPending ? (
                <div className="space-y-2.5 px-4 py-4" aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                        <Skeleton key={index} className="h-3.5 w-full" />
                    ))}
                </div>
            ) : logs.isError ? (
                <ErrorState compact error={logs.error} onRetry={() => void logs.refetch()} />
            ) : items.length === 0 ? (
                <EmptyState compact title="No log lines yet" description="The bot has not written anything yet." />
            ) : (
                <ol className="divide-y divide-border">
                    {items.map((line) => (
                        <li key={line.id} className="flex items-baseline gap-2 px-4 py-2">
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-faint">
                                {formatClock(line.timestamp)}
                            </span>
                            <span
                                className={cn(
                                    'w-9 shrink-0 font-mono text-[10px] uppercase',
                                    line.level === 'error'
                                        ? 'text-danger'
                                        : line.level === 'warn'
                                          ? 'text-warn'
                                          : line.level === 'debug'
                                            ? 'text-text-faint'
                                            : 'text-text-muted'
                                )}
                            >
                                {line.level}
                            </span>
                            <span
                                title={line.message}
                                className={cn(
                                    'min-w-0 flex-1 truncate font-mono text-[11px]',
                                    line.level === 'error' ? 'text-danger' : 'text-text-muted'
                                )}
                            >
                                {line.message}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

export default function DashboardPage() {
    return (
        <>
            <PageHeader
                title="Dashboard"
                meta="One streamer, one stream"
                actions={
                    <span className="hidden sm:inline-flex">
                        <Link to="/media" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                            <Film size={14} aria-hidden="true" />
                            Open media
                        </Link>
                    </span>
                }
            />
            <div className="oc-page-enter mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-5 xl:p-6">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.9fr)]">
                    <LivePlaybackCard />
                    <UpNextCard />
                </div>
                <ContinueWatchingCard />
                <ConnectionBar />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <SourceHealthCard />
                    <RecentLogsCard />
                </div>
            </div>
        </>
    );
}
