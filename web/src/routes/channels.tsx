import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    Film,
    ListFilter,
    Pin,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { Link } from 'react-router';
import type { ChannelDto } from '@shared/types';
import {
    ChannelMark,
    Checkbox,
    EmptyState,
    Field,
    Input,
    PageHeader,
    Select,
    StatusPill,
    Switch,
    Table,
    TableSkeleton,
    buttonStyles,
    useToast,
    type TableColumn,
} from '@/components';
import {
    useBulkChannelVisibility,
    useChannels,
    useMediaChannels,
    usePlayback,
    useSetChannelVisibility,
    useSources,
} from '@/lib/hooks';
import type { ChannelVisibilityFilter } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';

const PAGE_SIZE = 25;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

export default function ChannelsPage() {
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [sourceId, setSourceId] = useState<number | 'all'>('all');
    const [group, setGroup] = useState('all');
    const [visibility, setVisibility] = useState<ChannelVisibilityFilter>('visible');
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const headerCheckbox = useRef<HTMLInputElement>(null);
    const toast = useToast();

    const query = useMemo(
        () => ({
            page,
            pageSize: PAGE_SIZE,
            search: deferredSearch,
            sourceId,
            group,
            visibility,
        }),
        [page, deferredSearch, sourceId, group, visibility]
    );

    const sources = useSources();
    const channels = useChannels(query);
    const setVisible = useSetChannelVisibility();
    const bulk = useBulkChannelVisibility();
    const playback = usePlayback();
    const mediaChannels = useMediaChannels();

    const items = channels.data?.items ?? [];
    const pageIds = items.map((channel) => channel.id);
    const selectedOnPage = pageIds.filter((id) => selected.has(id));
    const allOnPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
    const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;
    const hasFilters =
        search.trim().length > 0 || sourceId !== 'all' || group !== 'all' || visibility !== 'all';

    useEffect(() => {
        if (headerCheckbox.current) {
            headerCheckbox.current.indeterminate = someOnPageSelected;
        }
    }, [someOnPageSelected]);

    const toggleAll = () => {
        setSelected((current) => {
            const next = new Set(current);
            if (allOnPageSelected) {
                for (const id of pageIds) next.delete(id);
            } else {
                for (const id of pageIds) next.add(id);
            }
            return next;
        });
    };

    const toggleOne = (id: number) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearFilters = () => {
        setSearch('');
        setSourceId('all');
        setGroup('all');
        setVisibility('all');
        setPage(1);
    };

    const runBulk = (visible: boolean) => {
        bulk.mutate(
            { ids: Array.from(selected), visible },
            {
                onSuccess: (result) => {
                    toast({
                        title: `${formatCount(result.updated)} channel${result.updated === 1 ? '' : 's'} ${visible ? 'shown' : 'hidden'}`,
                        tone: 'success',
                    });
                    setSelected(new Set());
                },
                onError: (error) =>
                    toast({
                        title: 'Bulk update failed',
                        description: errorMessage(error),
                        tone: 'error',
                    }),
            }
        );
    };

    const mediaList = mediaChannels.data ?? [];
    const mediaState = (sourceId: number): string => {
        const state = playback.data;
        if (state?.mode === 'media' && state.sourceId === sourceId) {
            return `Playing ${state.title ?? 'on demand'}`;
        }
        if (state?.mode === 'placeholder' && state.sourceId === sourceId) {
            return `Placeholder running in ${state.voiceChannelName ?? 'Discord'}`;
        }
        return 'Idle. Starts on demand.';
    };

    const columns: TableColumn<ChannelDto>[] = [
        {
            key: 'select',
            header: (
                <Checkbox
                    inputRef={headerCheckbox}
                    aria-label="Select all channels on this page"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                />
            ),
            cell: (channel) => (
                <Checkbox
                    aria-label={`Select ${channel.name}`}
                    checked={selected.has(channel.id)}
                    onChange={() => toggleOne(channel.id)}
                />
            ),
            className: 'w-10',
            headerClassName: 'w-10',
        },
        {
            key: 'channel',
            header: 'Channel',
            cell: (channel) => (
                <div className="flex items-center gap-3">
                    <ChannelMark name={channel.name} size="sm" />
                    <div className="min-w-0">
                        <p className="truncate font-medium text-text">{channel.name}</p>
                        <p className="truncate text-[11px] text-text-muted">{channel.group ?? 'Ungrouped'}</p>
                    </div>
                </div>
            ),
        },
        {
            key: 'source',
            header: 'Source',
            cell: (channel) => <span className="text-xs text-text-muted">{channel.sourceName}</span>,
        },
        {
            key: 'now',
            header: 'Now playing',
            cell: (channel) => (
                <div className="min-w-0">
                    <p className="max-w-[22rem] truncate text-xs text-text">
                        {channel.nowPlaying ?? 'No guide data'}
                    </p>
                    {channel.next ? (
                        <p className="max-w-[22rem] truncate text-[11px] text-text-muted">
                            Next: {channel.next}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'visible',
            header: 'Visible',
            cell: (channel) => (
                <Switch
                    aria-label={`Show ${channel.name} in the channel list`}
                    checked={channel.visible}
                    disabled={setVisible.isPending && setVisible.variables?.id === channel.id}
                    onChange={(event) => {
                        const visible = event.target.checked;
                        setVisible.mutate(
                            { id: channel.id, visible },
                            {
                                onError: (error) =>
                                    toast({
                                        title: 'Visibility did not change',
                                        description: errorMessage(error),
                                        tone: 'error',
                                    }),
                            }
                        );
                    }}
                />
            ),
            className: 'w-24',
            headerClassName: 'w-24',
        },
    ];

    const totalPages = channels.data ? Math.max(1, Math.ceil(channels.data.total / channels.data.pageSize)) : 1;

    useEffect(() => {
        if (channels.data && page > totalPages) {
            setPage(totalPages);
        }
    }, [channels.data, page, totalPages]);

    return (
        <>
            <PageHeader
                title="Channels"
                meta={
                    channels.data
                        ? `${formatCount(channels.data.visibleTotal)} visible of ${formatCount(channels.data.totalAll)}`
                        : 'Curate what the bot exposes'
                }
                actions={
                    <span className="hidden sm:inline-flex">
                        <Link to="/iptv" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                            Manage sources
                        </Link>
                    </span>
                }
            />
            <div className="oc-page-enter mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-5 xl:p-6">
                {mediaList.map((channel) => (
                    <section
                        key={`media-${channel.sourceId}`}
                        className="rounded-xl border border-plex/25 bg-plex/[0.045]"
                    >
                        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="flex aspect-[2/3] w-10 shrink-0 items-center justify-center rounded-md border border-plex/30 bg-plex/10">
                                <Film size={18} aria-hidden="true" className="text-plex" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-text">{channel.name}</p>
                                    <StatusPill tone="plex" dot={false}>
                                        {channel.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'}
                                    </StatusPill>
                                    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                        <Pin size={11} aria-hidden="true" />
                                        Pinned
                                    </span>
                                </div>
                                <p className="mt-0.5 truncate text-xs text-text-muted">
                                    On-demand channel · {mediaState(channel.sourceId ?? 0)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="hidden text-[11px] text-text-muted sm:inline">Always visible</span>
                                <Link
                                    to={`/media?source=${channel.sourceId ?? ''}`}
                                    className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                                >
                                    <Film size={14} aria-hidden="true" />
                                    Open media
                                </Link>
                            </div>
                        </div>
                    </section>
                ))}

                <section className="rounded-xl border border-border bg-surface p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto]">
                        <div className="sm:col-span-2 xl:col-span-1">
                            <Field label="Search channels" htmlFor="channel-search">
                                <div className="relative">
                                    <Search
                                        size={14}
                                        aria-hidden="true"
                                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                                    />
                                    <Input
                                        id="channel-search"
                                        type="search"
                                        value={search}
                                        onChange={(event) => {
                                            setSearch(event.target.value);
                                            setPage(1);
                                        }}
                                        placeholder="Name or group"
                                        className="pl-8"
                                    />
                                </div>
                            </Field>
                        </div>
                        <Field label="Source" htmlFor="channel-source">
                            <Select
                                id="channel-source"
                                value={String(sourceId)}
                                onChange={(event) => {
                                    setSourceId(event.target.value === 'all' ? 'all' : Number(event.target.value));
                                    setPage(1);
                                }}
                            >
                                <option value="all">All sources</option>
                                {sources.data?.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Group" htmlFor="channel-group">
                            <Select
                                id="channel-group"
                                value={group}
                                onChange={(event) => {
                                    setGroup(event.target.value);
                                    setPage(1);
                                }}
                            >
                                <option value="all">All groups</option>
                                {channels.data?.groups.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Visibility" htmlFor="channel-visibility">
                            <Select
                                id="channel-visibility"
                                value={visibility}
                                onChange={(event) => {
                                    setVisibility(event.target.value as ChannelVisibilityFilter);
                                    setPage(1);
                                }}
                            >
                                <option value="all">All channels</option>
                                <option value="visible">Visible only</option>
                                <option value="hidden">Hidden only</option>
                            </Select>
                        </Field>
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={clearFilters}
                                disabled={!hasFilters}
                                className={cn(
                                    'oc-control inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40',
                                    !hasFilters && 'pointer-events-none'
                                )}
                            >
                                <X size={13} aria-hidden="true" />
                                Clear
                            </button>
                        </div>
                    </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-border bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                            <ListFilter size={14} aria-hidden="true" className="text-text-faint" />
                            {channels.data ? (
                                <span>
                                    Showing {formatCount(channels.data.total === 0 ? 0 : (channels.data.page - 1) * channels.data.pageSize + 1)}
                                    {' - '}
                                    {formatCount(
                                        Math.min(
                                            channels.data.total,
                                            channels.data.page * channels.data.pageSize
                                        )
                                    )}{' '}
                                    of {formatCount(channels.data.total)}
                                </span>
                            ) : (
                                <span>Loading channels</span>
                            )}
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                            {channels.data ? `${formatCount(channels.data.visibleTotal)} visible` : ''}
                        </span>
                    </div>

                    {selected.size > 0 ? (
                        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-blurple/[0.06] px-4 py-2">
                            <span className="mr-1 text-xs font-medium text-text">
                                {formatCount(selected.size)} selected
                            </span>
                            <button
                                type="button"
                                onClick={() => runBulk(true)}
                                disabled={bulk.isPending}
                                className="oc-control inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 text-xs font-medium text-text hover:border-border-strong"
                            >
                                <Eye size={13} aria-hidden="true" />
                                Show
                            </button>
                            <button
                                type="button"
                                onClick={() => runBulk(false)}
                                disabled={bulk.isPending}
                                className="oc-control inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 text-xs font-medium text-text hover:border-border-strong"
                            >
                                <EyeOff size={13} aria-hidden="true" />
                                Hide
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelected(new Set())}
                                className="oc-control inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-text-muted hover:bg-white/5 hover:text-text"
                            >
                                Clear selection
                            </button>
                        </div>
                    ) : null}

                    {channels.isPending ? (
                        <TableSkeleton rows={8} columns={6} />
                    ) : channels.isError ? (
                        <div className="p-4">
                            <EmptyState
                                icon={RefreshCw}
                                title="Channels could not load"
                                description={errorMessage(channels.error)}
                                action={
                                    <button
                                        type="button"
                                        className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                                        onClick={() => void channels.refetch()}
                                    >
                                        Try again
                                    </button>
                                }
                            />
                        </div>
                    ) : channels.data && channels.data.items.length === 0 ? (
                        <EmptyState
                            icon={ListFilter}
                            title={
                                channels.data.totalAll === 0
                                    ? 'No channels yet'
                                    : 'No channels match these filters'
                            }
                            description={
                                channels.data.totalAll === 0
                                    ? 'Add an IPTV source and refresh it to populate the channel list.'
                                    : 'Widen the search or clear a filter to see more of the playlist.'
                            }
                            action={
                                channels.data.totalAll === 0 ? (
                                    <Link to="/iptv" className={buttonStyles({ variant: 'primary', size: 'sm' })}>
                                        Add a source
                                    </Link>
                                ) : (
                                    <button
                                        type="button"
                                        className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                                        onClick={clearFilters}
                                    >
                                        Clear filters
                                    </button>
                                )
                            }
                        />
                    ) : channels.data ? (
                        <>
                            <Table
                                caption={`Channels. ${channels.data.visibleTotal} visible of ${channels.data.totalAll} total.`}
                                columns={columns}
                                rows={channels.data.items}
                                rowKey={(channel) => channel.id}
                                rowHeaderKey="channel"
                                isRowSelected={(channel) => selected.has(channel.id)}
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
                                <p className="text-xs text-text-muted">
                                    Page {channels.data.page} of {totalPages}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        aria-label="Previous page"
                                        title="Previous page"
                                        className="oc-control oc-icon-control inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-40"
                                        disabled={channels.data.page <= 1}
                                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                                    >
                                        <ChevronLeft size={16} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Next page"
                                        title="Next page"
                                        className="oc-control oc-icon-control inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-40"
                                        disabled={channels.data.page >= totalPages}
                                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                                    >
                                        <ChevronRight size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : null}
                </section>
            </div>
        </>
    );
}
