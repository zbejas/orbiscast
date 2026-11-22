import { useMemo, useState } from 'react';
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Clock,
    Info,
    Tv,
} from 'lucide-react';
import { Link } from 'react-router';
import type { ProgrammeDto } from '@shared/types';
import {
    ChannelMark,
    Dialog,
    EmptyState,
    ErrorState,
    Skeleton,
    StatusPill,
    buttonStyles,
} from '@/components';
import { useGuide, useNow } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import {
    clamp,
    formatDay,
    formatDuration,
    formatTime,
    formatTimeRange,
    parseDateKey,
    shiftDateKey,
    toDateKey,
} from '@/lib/format';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function programmeAt(programmes: ProgrammeDto[], timestamp: number): ProgrammeDto | undefined {
    return programmes.find((programme) => programme.start <= timestamp && programme.stop > timestamp);
}

function programmeAfter(
    programmes: ProgrammeDto[],
    current: ProgrammeDto | undefined,
    timestamp: number
): ProgrammeDto | undefined {
    if (!current) return programmes.find((programme) => programme.start > timestamp);
    return programmes.find((programme) => programme.start >= current.stop);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The guide did not load. Try again.';
}

export function GuidePanel() {
    const todayKey = toDateKey();
    const [day, setDay] = useState(todayKey);
    const [selected, setSelected] = useState<{ programme: ProgrammeDto; channelName: string } | null>(null);
    const guide = useGuide(day);
    const now = useNow(30_000);
    const isToday = day === todayKey;

    const dayStart = guide.data?.dayStart ?? parseDateKey(day);
    const dayEnd = guide.data?.dayEnd ?? dayStart + DAY_MS;
    const nowRatio = clamp((now - dayStart) / (dayEnd - dayStart), 0, 1);

    const programmesByChannel = useMemo(() => {
        const map = new Map<string, ProgrammeDto[]>();
        for (const programme of guide.data?.programmes ?? []) {
            const list = map.get(programme.channelTvgId) ?? [];
            list.push(programme);
            map.set(programme.channelTvgId, list);
        }
        return map;
    }, [guide.data]);

    const channels = guide.data?.channels ?? [];

    const dayLabel = (() => {
        if (isToday) return 'Today';
        if (day === shiftDateKey(todayKey, 1)) return 'Tomorrow';
        if (day === shiftDateKey(todayKey, -1)) return 'Yesterday';
        return formatDay(dayStart);
    })();

    const changeDay = (offset: number) => {
        setDay(shiftDateKey(day, offset));
        setSelected(null);
    };

    return (
        <>
            <div className="space-y-4">
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-border/60 bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            aria-label="Previous day"
                            title="Previous day"
                            onClick={() => changeDay(-1)}
                            className="oc-control oc-icon-control inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-white/5 hover:text-text"
                        >
                            <ChevronLeft size={17} aria-hidden="true" />
                        </button>
                        <div className="min-w-[8.5rem] px-1 text-center">
                            <p className="text-sm font-medium leading-5 text-text">{dayLabel}</p>
                            <p className="text-[11px] leading-4 text-text-muted">{formatDay(dayStart)}</p>
                        </div>
                        <button
                            type="button"
                            aria-label="Next day"
                            title="Next day"
                            onClick={() => changeDay(1)}
                            className="oc-control oc-icon-control inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-white/5 hover:text-text"
                        >
                            <ChevronRight size={17} aria-hidden="true" />
                        </button>
                        {!isToday ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setDay(todayKey);
                                    setSelected(null);
                                }}
                                className={cn(buttonStyles({ variant: 'secondary', size: 'sm' }), 'ml-1')}
                            >
                                Today
                            </button>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <StatusPill tone="live" dot>
                            {channels.length} visible
                        </StatusPill>
                        <span className="inline-flex items-center gap-1">
                            <Clock size={13} aria-hidden="true" className="text-text-faint" />
                            Local time
                        </span>
                    </div>
                </section>

                {guide.isPending ? (
                    <div className="space-y-3 rounded-[28px] border border-border/60 bg-surface p-4" aria-hidden="true">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-10 w-full" />
                        {[0, 1, 2, 3, 4].map((index) => (
                            <Skeleton key={index} className="h-12 w-full" />
                        ))}
                    </div>
                ) : guide.isError ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="The guide could not load"
                            message={errorMessage(guide.error)}
                            onRetry={() => void guide.refetch()}
                        />
                    </section>
                ) : channels.length === 0 ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <EmptyState
                            icon={Tv}
                            title="No visible channels"
                            description="Show at least one channel before opening the guide. Hidden channels are excluded from the timeline."
                            action={
                                <Link to="/channels" className={buttonStyles({ variant: 'primary', size: 'sm' })}>
                                    Curate channels
                                </Link>
                            }
                        />
                    </section>
                ) : (guide.data?.programmes.length ?? 0) === 0 ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <EmptyState
                            icon={CalendarDays}
                            title="No guide data for this day"
                            description="The channels are available, but the XMLTV guide has no programmes for this date. Refresh the source or choose another day."
                            action={
                                <Link to="/iptv" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                    Open sources
                                </Link>
                            }
                        />
                    </section>
                ) : (
                    <>
                        <section className="overflow-hidden rounded-[28px] border border-border/60 bg-surface md:hidden">
                            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                                <h2 className="text-sm font-semibold text-text">Now and next</h2>
                                <span className="text-[11px] text-text-muted">{channels.length} channels</span>
                            </div>
                            <ul className="divide-y divide-border">
                                {channels.map((channel) => {
                                    const programmes = programmesByChannel.get(channel.tvgId ?? '') ?? [];
                                    const current = programmeAt(programmes, now);
                                    const next = programmeAfter(programmes, current, now);
                                    return (
                                        <li key={channel.id} className="px-4 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <ChannelMark name={channel.name} size="sm" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-medium text-text">
                                                        {channel.name}
                                                    </p>
                                                    <p className="truncate text-[11px] text-text-muted">
                                                        {channel.group ?? 'Ungrouped'}
                                                    </p>
                                                </div>
                                            </div>
                                            {current ? (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setSelected({
                                                            programme: current,
                                                            channelName: channel.name,
                                                        })
                                                    }
                                                    className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-border bg-raised px-2.5 py-2 text-left hover:border-border-strong"
                                                >
                                                    <StatusPill tone="live" pulse dot>
                                                        Now
                                                    </StatusPill>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium text-text">
                                                            {current.title}
                                                        </span>
                                                        <span className="block text-[11px] text-text-muted">
                                                            {formatTimeRange(current.start, current.stop)}
                                                        </span>
                                                    </span>
                                                    <ChevronRight
                                                        size={14}
                                                        aria-hidden="true"
                                                        className="shrink-0 text-text-faint"
                                                    />
                                                </button>
                                            ) : (
                                                <p className="mt-2.5 rounded-md border border-border bg-raised px-2.5 py-2 text-xs text-text-muted">
                                                    No programme airing right now
                                                </p>
                                            )}
                                            {next ? (
                                                <div className="mt-1.5 flex items-center gap-2 px-2.5 py-1">
                                                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                                                        Next
                                                    </span>
                                                    <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                                                        {next.title}
                                                    </span>
                                                    <span className="shrink-0 font-mono text-[11px] text-text-faint">
                                                        {formatTime(next.start)}
                                                    </span>
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>

                        <section className="hidden overflow-hidden rounded-[28px] border border-border/60 bg-surface md:block">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-semibold text-text">Timeline</h2>
                                    <span className="text-[11px] text-text-muted">
                                        {channels.length} channels · 24 hours
                                    </span>
                                </div>
                                <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                    <Info size={13} aria-hidden="true" className="text-text-faint" />
                                    Scroll sideways for the full day. Select a programme for details.
                                </span>
                            </div>

                            <div className="oc-epg-scroll">
                                <div className="oc-epg-scroller relative">
                                    <div className="oc-epg-head grid grid-cols-[10rem_minmax(0,1fr)]">
                                        <div className="oc-epg-channel flex h-10 items-center px-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                                            Channel
                                        </div>
                                        <div className="relative h-10">
                                            <div className="grid h-full grid-cols-[repeat(24,minmax(0,1fr))]">
                                                {HOURS.map((hour) => (
                                                    <div
                                                        key={hour}
                                                        className="border-l border-border/60 pl-1.5 pt-2 font-mono text-[11px] tabular-nums text-text-faint first:border-l-0"
                                                    >
                                                        {String(hour).padStart(2, '0')}:00
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {channels.map((channel) => {
                                        const programmes = programmesByChannel.get(channel.tvgId ?? '') ?? [];
                                        return (
                                            <div
                                                key={channel.id}
                                                className="grid grid-cols-[10rem_minmax(0,1fr)] border-t border-border"
                                            >
                                                <div className="oc-epg-channel flex h-14 items-center gap-2.5 px-3">
                                                    <ChannelMark name={channel.name} size="sm" />
                                                    <div className="min-w-0">
                                                        <p className="truncate text-xs font-medium text-text">
                                                            {channel.name}
                                                        </p>
                                                        <p className="truncate text-[11px] text-text-muted">
                                                            {channel.group ?? 'Ungrouped'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="relative h-14">
                                                    <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(24,minmax(0,1fr))]">
                                                        {HOURS.map((hour) => (
                                                            <div
                                                                key={hour}
                                                                className="border-l border-border/40 first:border-l-0"
                                                            />
                                                        ))}
                                                    </div>
                                                    {programmes.map((programme) => {
                                                        const left =
                                                            ((programme.start - dayStart) / (dayEnd - dayStart)) * 100;
                                                        const width =
                                                            ((programme.stop - programme.start) /
                                                                (dayEnd - dayStart)) *
                                                            100;
                                                        const active =
                                                            isToday &&
                                                            programme.start <= now &&
                                                            programme.stop > now;
                                                        const short =
                                                            programme.stop - programme.start <= 30 * MINUTE_MS;
                                                        return (
                                                            <button
                                                                key={programme.id}
                                                                type="button"
                                                                title={`${programme.title}, ${formatTimeRange(programme.start, programme.stop)}`}
                                                                onClick={() =>
                                                                    setSelected({
                                                                        programme,
                                                                        channelName: channel.name,
                                                                    })
                                                                }
                                                                className="oc-epg-programme"
                                                                data-current={active ? 'true' : undefined}
                                                                style={{
                                                                    left: `${left}%`,
                                                                    width: `calc(${width}% - 2px)`,
                                                                }}
                                                            >
                                                                <span className="block truncate font-medium">
                                                                    {programme.title}
                                                                </span>
                                                                {short ? null : (
                                                                    <span className="block truncate font-mono text-[11px] tabular-nums text-text-muted">
                                                                        {formatTimeRange(
                                                                            programme.start,
                                                                            programme.stop
                                                                        )}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {isToday ? (
                                        <div
                                            className="pointer-events-none absolute bottom-0 left-40 right-0 top-10 z-[5]"
                                            aria-hidden="true"
                                        >
                                            <div
                                                className="oc-epg-now"
                                                style={{ left: `${nowRatio * 100}%` }}
                                            >
                                                <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded-full bg-blurple px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-white">
                                                    Now
                                                </span>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>

            <Dialog
                open={selected !== null}
                onClose={() => setSelected(null)}
                title={selected?.programme.title ?? 'Programme'}
                description={
                    selected
                        ? `${selected.channelName} · ${formatTimeRange(selected.programme.start, selected.programme.stop)}`
                        : undefined
                }
                footer={
                    <button
                        type="button"
                        className={buttonStyles({ variant: 'secondary' })}
                        onClick={() => setSelected(null)}
                    >
                        Close
                    </button>
                }
            >
                {selected ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            {selected.programme.start <= now && selected.programme.stop > now ? (
                                <StatusPill tone="live" pulse>
                                    On now
                                </StatusPill>
                            ) : null}
                            {selected.programme.category ? (
                                <StatusPill tone="neutral" dot={false}>
                                    {selected.programme.category}
                                </StatusPill>
                            ) : null}
                            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                                <Clock size={13} aria-hidden="true" />
                                {formatDuration(selected.programme.stop - selected.programme.start)}
                            </span>
                        </div>
                        <p className="text-sm leading-relaxed text-text-muted">
                            {selected.programme.description}
                        </p>
                        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs">
                            <div>
                                <dt className="text-text-muted">Starts</dt>
                                <dd className="mt-0.5 font-mono tabular-nums text-text">
                                    {formatTime(selected.programme.start)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-text-muted">Ends</dt>
                                <dd className="mt-0.5 font-mono tabular-nums text-text">
                                    {formatTime(selected.programme.stop)}
                                </dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Dialog>
        </>
    );
}
