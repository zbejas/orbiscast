import { useRef, useState, type FormEvent } from 'react';
import {
    Pencil,
    Plus,
    RefreshCw,
    Rss,
    TriangleExclamationPoint,
    Trash,
} from 'lucide-react';
import { Link } from 'react-router';
import type { SourceDto } from '@shared/types';
import {
    Button,
    ConfirmDialog,
    Dialog,
    EmptyState,
    ErrorState,
    Field,
    IconButton,
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
    useDeleteSource,
    useRefreshSource,
    useSaveSource,
    useSetSourceEnabled,
    useSources,
} from '@/lib/hooks';
import { formatCount, formatDate, formatRelative } from '@/lib/format';

interface SourceFormState {
    name: string;
    playlistUrl: string;
    xmltvUrl: string;
    refreshMinutes: string;
    enabled: boolean;
}

const EMPTY_FORM: SourceFormState = {
    name: '',
    playlistUrl: '',
    xmltvUrl: '',
    refreshMinutes: '60',
    enabled: true,
};

type FormErrors = Partial<Record<keyof SourceFormState, string>>;

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function validate(values: SourceFormState): FormErrors {
    const errors: FormErrors = {};
    if (values.name.trim().length < 2) {
        errors.name = 'Give the source a name with at least two characters.';
    }
    if (!values.playlistUrl.trim()) {
        errors.playlistUrl = 'A playlist URL is required.';
    } else if (!isHttpUrl(values.playlistUrl.trim())) {
        errors.playlistUrl = 'Enter a full http or https URL.';
    }
    if (values.xmltvUrl.trim() && !isHttpUrl(values.xmltvUrl.trim())) {
        errors.xmltvUrl = 'Enter a full http or https URL, or leave this blank.';
    }
    const minutes = Number(values.refreshMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        errors.refreshMinutes = 'Use a whole number between 5 and 1440 minutes.';
    }
    return errors;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function SourceFormDialog({
    source,
    onClose,
}: {
    source: SourceDto | null;
    onClose: () => void;
}) {
    const save = useSaveSource();
    const toast = useToast();
    const formRef = useRef<HTMLFormElement>(null);
    const [form, setForm] = useState<SourceFormState>(() =>
        source
            ? {
                  name: source.name,
                  playlistUrl: source.playlistUrl,
                  xmltvUrl: source.xmltvUrl ?? '',
                  refreshMinutes: String(source.refreshMinutes),
                  enabled: source.enabled,
              }
            : EMPTY_FORM
    );
    const [errors, setErrors] = useState<FormErrors>({});

    const update = <K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
        setErrors((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const validateField = (key: keyof SourceFormState) => {
        const next = validate(form);
        setErrors((current) => {
            const copy = { ...current };
            if (next[key]) copy[key] = next[key];
            else delete copy[key];
            return copy;
        });
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next = validate(form);
        setErrors(next);
        if (Object.keys(next).length > 0) {
            window.requestAnimationFrame(() => {
                formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            });
            return;
        }
        save.mutate(
            {
                id: source?.id,
                name: form.name.trim(),
                playlistUrl: form.playlistUrl.trim(),
                xmltvUrl: form.xmltvUrl.trim() || null,
                refreshMinutes: Number(form.refreshMinutes),
                enabled: form.enabled,
            },
            {
                onSuccess: () => {
                    toast({
                        title: source ? 'Source updated' : 'Source added',
                        description: form.name.trim(),
                        tone: 'success',
                    });
                    onClose();
                },
                onError: (error) =>
                    toast({
                        title: 'Could not save the source',
                        description: errorMessage(error),
                        tone: 'error',
                    }),
            }
        );
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={source ? 'Edit source' : 'Add source'}
            description="A playlist and an optional XMLTV guide are saved together as one source."
            size="lg"
        >
            <form ref={formRef} noValidate onSubmit={submit}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                        label="Source name"
                        htmlFor="source-name"
                        error={errors.name}
                        required
                        className="sm:col-span-2"
                    >
                        <Input
                            id="source-name"
                            value={form.name}
                            onChange={(event) => update('name', event.target.value)}
                            onBlur={() => validateField('name')}
                            placeholder="Aurora TV"
                            autoComplete="off"
                            data-autofocus="true"
                            required
                        />
                    </Field>
                    <Field
                        label="Playlist URL"
                        htmlFor="source-playlist"
                        hint="The M3U or M3U8 playlist is stored as plain text."
                        error={errors.playlistUrl}
                        required
                        className="sm:col-span-2"
                    >
                        <Input
                            id="source-playlist"
                            type="url"
                            value={form.playlistUrl}
                            onChange={(event) => update('playlistUrl', event.target.value)}
                            onBlur={() => validateField('playlistUrl')}
                            placeholder="https://lists.example.net/aurora.m3u"
                            autoComplete="off"
                            spellCheck={false}
                            required
                        />
                    </Field>
                    <Field
                        label="XMLTV guide URL"
                        htmlFor="source-xmltv"
                        hint="Optional. Leave blank to run this source without a guide."
                        error={errors.xmltvUrl}
                        className="sm:col-span-2"
                    >
                        <Input
                            id="source-xmltv"
                            type="url"
                            value={form.xmltvUrl}
                            onChange={(event) => update('xmltvUrl', event.target.value)}
                            onBlur={() => validateField('xmltvUrl')}
                            placeholder="https://lists.example.net/aurora.xml"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>
                    <Field
                        label="Refresh interval"
                        htmlFor="source-refresh"
                        hint="Minutes between automatic refreshes."
                        error={errors.refreshMinutes}
                        required
                    >
                        <Select
                            id="source-refresh"
                            value={form.refreshMinutes}
                            onChange={(event) => update('refreshMinutes', event.target.value)}
                            onBlur={() => validateField('refreshMinutes')}
                        >
                            {[15, 30, 60, 120, 180, 360, 720, 1440].map((minutes) => (
                                <option key={minutes} value={minutes}>
                                    {minutes === 60
                                        ? 'Every hour'
                                        : minutes % 60 === 0
                                          ? `Every ${minutes / 60} hours`
                                          : `Every ${minutes} minutes`}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <div className="flex items-end pb-1">
                        <Switch
                            checked={form.enabled}
                            onChange={(event) => update('enabled', event.target.checked)}
                            label="Enabled"
                            description="Include this source in refreshes."
                        />
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={save.isPending}>
                        {source ? 'Save changes' : 'Add source'}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

export default function SourcesPage() {
    const sources = useSources();
    const refresh = useRefreshSource();
    const toggle = useSetSourceEnabled();
    const remove = useDeleteSource();
    const toast = useToast();
    const [dialog, setDialog] = useState<{ source: SourceDto | null } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<SourceDto | null>(null);

    const list = sources.data ?? [];
    const totalChannels = list.reduce((sum, source) => sum + source.channelCount, 0);
    const totalVisible = list.reduce((sum, source) => sum + source.visibleCount, 0);

    const reportError = (error: unknown) =>
        toast({
            title: 'Source action failed',
            description: errorMessage(error),
            tone: 'error',
        });

    const columns: TableColumn<SourceDto>[] = [
        {
            key: 'source',
            header: 'Source',
            cell: (source) => (
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{source.name}</p>
                    <p
                        className="max-w-[26rem] truncate font-mono text-[10px] text-text-faint"
                        title={source.playlistUrl}
                    >
                        {source.playlistUrl}
                    </p>
                    {source.lastError ? (
                        <p className="mt-1 flex max-w-[26rem] items-start gap-1 text-[11px] leading-relaxed text-danger">
                            <TriangleExclamationPoint
                                size={12}
                                aria-hidden="true"
                                className="mt-0.5 shrink-0"
                            />
                            <span className="line-clamp-2">{source.lastError}</span>
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'channels',
            header: 'Channels',
            cell: (source) => (
                <div className="text-xs">
                    <p className="font-mono tabular-nums text-text">{formatCount(source.channelCount)}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                        {formatCount(source.visibleCount)} visible
                    </p>
                </div>
            ),
            className: 'w-28',
            headerClassName: 'w-28',
        },
        {
            key: 'refresh',
            header: 'Refresh',
            cell: (source) => (
                <span className="whitespace-nowrap text-xs text-text-muted">
                    Every {source.refreshMinutes} min
                </span>
            ),
            className: 'w-32',
            headerClassName: 'w-32',
        },
        {
            key: 'last',
            header: 'Last refresh',
            cell: (source) => (
                <span className="text-xs text-text-muted" title={source.lastRefreshedAt ? formatDate(source.lastRefreshedAt) : undefined}>
                    {formatRelative(source.lastRefreshedAt)}
                </span>
            ),
            className: 'w-36',
            headerClassName: 'w-36',
        },
        {
            key: 'status',
            header: 'Status',
            cell: (source) => (
                <div className="flex items-center gap-2">
                    <Switch
                        aria-label={`Enable ${source.name}`}
                        checked={source.enabled}
                        onChange={(event) =>
                            toggle.mutate(
                                { source, enabled: event.target.checked },
                                { onError: reportError }
                            )
                        }
                    />
                    {source.enabled ? (
                        source.lastError ? (
                            <StatusPill tone="danger">Error</StatusPill>
                        ) : source.refreshing ? (
                            <StatusPill tone="warn">Refreshing</StatusPill>
                        ) : (
                            <StatusPill tone="live">Healthy</StatusPill>
                        )
                    ) : (
                        <StatusPill tone="neutral">Disabled</StatusPill>
                    )}
                </div>
            ),
            className: 'w-44',
            headerClassName: 'w-44',
        },
        {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (source) => (
                <div className="flex items-center justify-end gap-1">
                    <IconButton
                        label={`Refresh ${source.name} now`}
                        size="sm"
                        loading={refresh.isPending && refresh.variables === source.id}
                        disabled={refresh.isPending && refresh.variables === source.id}
                        onClick={() =>
                            refresh.mutate(source.id, {
                                onSuccess: () =>
                                    toast({
                                        title: 'Source refreshed',
                                        description: source.name,
                                        tone: 'success',
                                    }),
                                onError: reportError,
                            })
                        }
                    >
                        <RefreshCw size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label={`Edit ${source.name}`}
                        size="sm"
                        onClick={() => setDialog({ source })}
                    >
                        <Pencil size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        label={`Delete ${source.name}`}
                        size="sm"
                        onClick={() => setDeleteTarget(source)}
                    >
                        <Trash size={14} aria-hidden="true" />
                    </IconButton>
                </div>
            ),
            className: 'oc-table-actions w-28',
            headerClassName: 'w-28',
        },
    ];

    return (
        <>
            <PageHeader
                title="Sources"
                meta={
                    sources.data
                        ? `${formatCount(list.length)} sources · ${formatCount(totalChannels)} channels · ${formatCount(totalVisible)} visible`
                        : 'Playlist and guide intake'
                }
                actions={
                    <Button
                        variant="primary"
                        size="sm"
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => setDialog({ source: null })}
                    >
                        Add source
                    </Button>
                }
            />
            <div className="oc-page-enter mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-5 xl:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="max-w-2xl text-xs leading-relaxed text-text-muted">
                        Pair each M3U playlist with its XMLTV guide. Refreshes replace the channel list while
                        keeping your visible channels where the IDs still match.
                    </p>
                    <Link
                        to="/settings#plex-connection"
                        className="text-xs font-medium text-blurple-text hover:text-[#a5acff]"
                    >
                        Plex is configured in Settings
                    </Link>
                </div>

                <section className="overflow-hidden rounded-xl border border-border bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                        <h2 className="text-sm font-semibold text-text">Configured sources</h2>
                        <span className="font-mono text-[11px] tabular-nums text-text-muted">
                            {sources.data ? formatCount(totalChannels) : ''}
                        </span>
                    </div>

                    {sources.isPending ? (
                        <TableSkeleton rows={4} columns={6} />
                    ) : sources.isError ? (
                        <ErrorState
                            title="Sources could not load"
                            error={sources.error}
                            onRetry={() => void sources.refetch()}
                        />
                    ) : list.length === 0 ? (
                        <EmptyState
                            icon={Rss}
                            title="No sources yet"
                            description="Add an M3U playlist to populate channels. An XMLTV guide is optional but adds now and next data."
                            action={
                                <Button
                                    variant="primary"
                                    icon={<Plus size={14} aria-hidden="true" />}
                                    onClick={() => setDialog({ source: null })}
                                >
                                    Add your first source
                                </Button>
                            }
                        />
                    ) : (
                        <Table
                            caption="IPTV sources with playlist, guide, refresh interval, and channel counts."
                            columns={columns}
                            rows={list}
                            rowKey={(source) => source.id}
                            rowHeaderKey="source"
                        />
                    )}
                </section>

                <p className="text-[11px] leading-relaxed text-text-faint">
                    Sources are independent. A failure in one source does not stop the others. Playback keeps the
                    last good channel list until a refresh succeeds.
                </p>
            </div>

            {dialog ? (
                <SourceFormDialog
                    source={dialog.source}
                    onClose={() => setDialog(null)}
                />
            ) : null}

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (!deleteTarget) return;
                    const target = deleteTarget;
                    remove.mutate(target.id, {
                        onSuccess: () => {
                            toast({
                                title: 'Source deleted',
                                description: `${target.name} and ${formatCount(target.channelCount)} channels were removed.`,
                                tone: 'success',
                            });
                            setDeleteTarget(null);
                        },
                        onError: reportError,
                    });
                }}
                title="Delete this source?"
                description={
                    deleteTarget
                        ? `${deleteTarget.name} and its ${formatCount(deleteTarget.channelCount)} channels will be removed. Playback in Discord is not affected.`
                        : ''
                }
                confirmLabel="Delete source"
            />
        </>
    );
}
