import { useState, type FormEvent } from 'react';
import {
    ArrowLeft,
    Library,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    Server,
    Trash,
} from 'lucide-react';
import { Link } from 'react-router';
import type {
    MediaQuality,
    MediaSourceDto,
    MediaSourceKind,
} from '@shared/types';
import {
    Button,
    EmptyState,
    ErrorState,
    Field,
    Input,
    Notice,
    PageHeader,
    Select,
    Skeleton,
    StatusPill,
    Switch,
    buttonStyles,
    useToast,
} from '@/components';
import {
    useCreateMediaSource,
    useDeleteMediaSource,
    useMediaLibraries,
    useMediaSources,
    useSetMediaLibrary,
    useUpdateMediaSource,
    useValidateMediaSource,
} from '@/lib/hooks';
import { QUALITY_OPTIONS, isPlayableLibrary, libraryTypeLabel, qualityLabel } from '@/lib/media';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function sourceStatus(source: MediaSourceDto): {
    label: string;
    tone: 'neutral' | 'live' | 'danger' | 'warn';
} {
    if (!source.enabled) return { label: 'Disabled', tone: 'neutral' };
    if (source.connected) return { label: 'Connected', tone: 'live' };
    if (source.error) return { label: 'Error', tone: 'danger' };
    return { label: 'Offline', tone: 'warn' };
}

interface SourceFormState {
    kind: MediaSourceKind;
    name: string;
    serverUrl: string;
    token: string;
    channelName: string;
    idleMinutes: string;
    emptyGraceSeconds: string;
    defaultQuality: MediaQuality;
    enabled: boolean;
}

type SourceFormErrors = Partial<Record<keyof SourceFormState, string>>;

function emptySourceForm(kind: MediaSourceKind): SourceFormState {
    return {
        kind,
        name: '',
        serverUrl: '',
        token: '',
        channelName: kind === 'jellyfin' ? 'Jellyfin' : 'Plex',
        idleMinutes: '5',
        emptyGraceSeconds: '30',
        defaultQuality: '1080p-8',
        enabled: true,
    };
}

function sourceForm(source: MediaSourceDto): SourceFormState {
    return {
        kind: source.kind,
        name: source.name,
        serverUrl: source.serverUrl,
        token: '',
        channelName: source.channelName,
        idleMinutes: String(source.idleMinutes),
        emptyGraceSeconds: String(source.emptyGraceSeconds),
        defaultQuality: source.defaultQuality,
        enabled: source.enabled,
    };
}

function validateSourceForm(form: SourceFormState, isEdit: boolean): SourceFormErrors {
    const errors: SourceFormErrors = {};
    if (form.name.trim().length < 2) {
        errors.name = 'Give the source a name with at least two characters.';
    }
    try {
        const url = new URL(form.serverUrl.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            errors.serverUrl = 'Use an http or https URL.';
        }
    } catch {
        errors.serverUrl = 'Enter the full server URL.';
    }
    if (!isEdit && !form.token.trim()) {
        errors.token = 'Enter the server token or API key.';
    }
    if (!form.channelName.trim()) {
        errors.channelName = 'Name the virtual Discord channel.';
    }
    const idle = Number(form.idleMinutes);
    if (!Number.isInteger(idle) || idle < 1 || idle > 120) {
        errors.idleMinutes = 'Use a whole number between 1 and 120.';
    }
    const grace = Number(form.emptyGraceSeconds);
    if (!Number.isInteger(grace) || grace < 0 || grace > 600) {
        errors.emptyGraceSeconds = 'Use a whole number between 0 and 600.';
    }
    return errors;
}

function SourceLibraries({ source }: { source: MediaSourceDto }) {
    const libraries = useMediaLibraries(source.id);
    const setLibrary = useSetMediaLibrary();
    const toast = useToast();
    const list = libraries.data ?? [];
    const pendingKey = setLibrary.isPending ? setLibrary.variables?.key : undefined;

    return (
        <div className="border-t border-border/50 px-5 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-text">Libraries</h3>
                    <p className="mt-0.5 text-xs text-text-muted">
                        Only movie and TV show libraries are playable.
                    </p>
                </div>
                {list.length > 0 ? (
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                        {list.filter(isPlayableLibrary).filter((library) => library.enabled).length}{' '}
                        shown
                    </span>
                ) : null}
            </div>

            {libraries.isPending ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                        <div key={index} className="flex items-center justify-between gap-3">
                            <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-32" />
                                <Skeleton className="h-3 w-20" />
                            </div>
                            <Skeleton className="h-6 w-10 rounded-full" />
                        </div>
                    ))}
                </div>
            ) : libraries.isError ? (
                <ErrorState
                    compact
                    title="Libraries could not load"
                    error={libraries.error}
                    onRetry={() => void libraries.refetch()}
                />
            ) : list.length === 0 ? (
                <EmptyState
                    compact
                    icon={Library}
                    title="No libraries discovered"
                    description="Check the source connection, then test the source again."
                />
            ) : (
                <ul className="mt-3 divide-y divide-border/50 border-t border-border/50">
                    {list.map((library) => {
                        const playable = isPlayableLibrary(library);
                        return (
                            <li
                                key={library.key}
                                className="flex items-start justify-between gap-4 rounded-[16px] px-2 py-3 transition-colors duration-200 hover:bg-white/[0.04]"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-text">
                                        {library.title}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-text-faint">
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
                                            {
                                                sourceId: source.id,
                                                key: library.key,
                                                enabled: event.target.checked,
                                            },
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
        </div>
    );
}

function SourceForm({
    source,
    onCancel,
    onSaved,
}: {
    source: MediaSourceDto | null;
    onCancel: () => void;
    onSaved: (source: MediaSourceDto) => void;
}) {
    const create = useCreateMediaSource();
    const update = useUpdateMediaSource();
    const remove = useDeleteMediaSource();
    const validate = useValidateMediaSource();
    const toast = useToast();
    const [form, setForm] = useState<SourceFormState>(() =>
        source ? sourceForm(source) : emptySourceForm('plex')
    );
    const [errors, setErrors] = useState<SourceFormErrors>({});
    const [confirmDelete, setConfirmDelete] = useState(false);
    const isEdit = Boolean(source);
    const pending = create.isPending || update.isPending;

    const set = <K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
        setErrors((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next = validateSourceForm(form, isEdit);
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        const input = {
            kind: form.kind,
            name: form.name.trim(),
            serverUrl: form.serverUrl.trim(),
            channelName: form.channelName.trim(),
            idleMinutes: Number(form.idleMinutes),
            emptyGraceSeconds: Number(form.emptyGraceSeconds),
            defaultQuality: form.defaultQuality,
            enabled: form.enabled,
            ...(form.token.trim() ? { token: form.token.trim() } : {}),
        };
        const options = {
            onSuccess: (saved: MediaSourceDto) => {
                toast({
                    title: isEdit ? 'Source updated' : 'Source added',
                    description: saved.connected
                        ? `${saved.name} is connected.`
                        : (saved.error ?? 'Saved, but the server did not connect.'),
                    tone: saved.connected ? 'success' : 'error',
                });
                onSaved(saved);
            },
            onError: (error: unknown) =>
                toast({
                    title: isEdit ? 'Could not update the source' : 'Could not add the source',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        };
        if (source) {
            update.mutate({ ...input, id: source.id }, options);
        } else {
            create.mutate({ ...input, token: form.token.trim() }, options);
        }
    };

    const testConnection = () => {
        if (!source) return;
        validate.mutate(source.id, {
            onSuccess: (saved) =>
                toast({
                    title: saved.connected ? 'Connection is healthy' : 'Connection failed',
                    description: saved.error ?? undefined,
                    tone: saved.connected ? 'success' : 'error',
                }),
            onError: (error) =>
                toast({
                    title: 'Validation failed',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    const removeSource = () => {
        if (!source) return;
        remove.mutate(source.id, {
            onSuccess: () => {
                toast({ title: 'Source removed', description: source.name, tone: 'success' });
                onCancel();
            },
            onError: (error) =>
                toast({
                    title: 'Could not remove the source',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    return (
        <section className="rounded-[28px] border border-border/60 bg-surface">
            <div className="border-b border-border/50 px-5 py-4">
                <h2 id="media-source-form-title" className="text-base font-semibold tracking-[-0.01em] text-text">
                    {source ? `Edit ${source.name}` : 'Add media source'}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    Plex and Jellyfin servers are saved separately. Each one gets a virtual Discord
                    channel.
                </p>
            </div>

            <form
                noValidate
                onSubmit={submit}
                aria-labelledby="media-source-form-title"
                className="p-4 sm:p-5"
            >
                {source?.error ? (
                    <Notice tone="danger" title="Last connection failed" className="mb-4">
                        {source.error}
                    </Notice>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Server type" htmlFor="source-kind" required>
                        <Select
                            id="source-kind"
                            value={form.kind}
                            onChange={(event) => {
                                const kind = event.target.value as MediaSourceKind;
                                set('kind', kind);
                                if (!isEdit && !form.name) {
                                    set('name', kind === 'jellyfin' ? 'Jellyfin' : 'Plex');
                                }
                                if (!isEdit && form.channelName === 'Plex' && kind === 'jellyfin') {
                                    set('channelName', 'Jellyfin');
                                }
                            }}
                        >
                            <option value="plex">Plex</option>
                            <option value="jellyfin">Jellyfin</option>
                        </Select>
                    </Field>
                    <Field
                        label="Source name"
                        htmlFor="source-name"
                        hint="A label only you see in the WebUI."
                        error={errors.name}
                        required
                    >
                        <Input
                            id="source-name"
                            value={form.name}
                            onChange={(event) => set('name', event.target.value)}
                            placeholder={form.kind === 'jellyfin' ? 'Home Jellyfin' : 'Home Plex'}
                            autoComplete="off"
                            required
                        />
                    </Field>
                    <Field
                        label="Server URL"
                        htmlFor="source-url"
                        hint={
                            form.kind === 'jellyfin'
                                ? 'For example https://jellyfin.example.com. A reverse-proxy subpath is allowed.'
                                : 'Include the scheme and port, for example https://plex.example.com:32400.'
                        }
                        error={errors.serverUrl}
                        required
                        className="sm:col-span-2"
                    >
                        <Input
                            id="source-url"
                            type="url"
                            value={form.serverUrl}
                            onChange={(event) => set('serverUrl', event.target.value)}
                            placeholder={
                                form.kind === 'jellyfin'
                                    ? 'https://jellyfin.example.com'
                                    : 'https://plex.example.com:32400'
                            }
                            spellCheck={false}
                            autoComplete="off"
                            required
                        />
                    </Field>
                    <Field
                        label={form.kind === 'jellyfin' ? 'API key' : 'Plex token'}
                        htmlFor="source-token"
                        hint={
                            source?.tokenSet
                                ? `Stored value ending ${source.tokenLast4 ?? '••••'}. Leave blank to keep it.`
                                : form.kind === 'jellyfin'
                                  ? 'Create an API key in the Jellyfin dashboard under API Keys.'
                                  : 'Copy the token from a Plex client or the Plex web app.'
                        }
                        error={errors.token}
                        required={!isEdit}
                        className="sm:col-span-2"
                    >
                        <Input
                            id="source-token"
                            type="password"
                            value={form.token}
                            onChange={(event) => set('token', event.target.value)}
                            placeholder={
                                isEdit ? 'Leave blank to keep the stored token' : 'Paste the token'
                            }
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono text-xs"
                        />
                    </Field>
                    <Field
                        label="Discord channel name"
                        htmlFor="source-channel"
                        hint="The virtual on-demand channel in Discord."
                        error={errors.channelName}
                        required
                    >
                        <Input
                            id="source-channel"
                            value={form.channelName}
                            onChange={(event) => set('channelName', event.target.value)}
                            maxLength={80}
                            required
                        />
                    </Field>
                    <Field
                        label="Default quality"
                        htmlFor="source-quality"
                        hint="Used for new queue items."
                    >
                        <Select
                            id="source-quality"
                            value={form.defaultQuality}
                            onChange={(event) =>
                                set('defaultQuality', event.target.value as MediaQuality)
                            }
                        >
                            {QUALITY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field
                        label="Idle timer (minutes)"
                        htmlFor="source-idle"
                        hint="How long the placeholder stays after playback ends."
                        error={errors.idleMinutes}
                        required
                    >
                        <Input
                            id="source-idle"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={120}
                            value={form.idleMinutes}
                            onChange={(event) => set('idleMinutes', event.target.value)}
                            required
                        />
                    </Field>
                    <Field
                        label="Empty channel grace (seconds)"
                        htmlFor="source-grace"
                        hint="Seconds to wait after the last viewer leaves."
                        error={errors.emptyGraceSeconds}
                        required
                    >
                        <Input
                            id="source-grace"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={600}
                            value={form.emptyGraceSeconds}
                            onChange={(event) => set('emptyGraceSeconds', event.target.value)}
                            required
                        />
                    </Field>
                    <div className="flex items-end pb-1 sm:col-span-2">
                        <Switch
                            checked={form.enabled}
                            onChange={(event) => set('enabled', event.target.checked)}
                            label="Enabled"
                            description="Show this source in Discord and the media browser."
                        />
                    </div>
                </div>

                {source && confirmDelete ? (
                    <Notice
                        tone="danger"
                        title={`Remove ${source.name}?`}
                        className="mt-4"
                        action={
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="danger"
                                    size="sm"
                                    loading={remove.isPending}
                                    onClick={removeSource}
                                >
                                    Remove source
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setConfirmDelete(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        }
                    >
                        The source, its libraries, queue entries, and saved playback history are
                        removed. The server itself is not changed.
                    </Notice>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-4">
                    <div className="flex items-center gap-2">
                        {source ? (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Trash size={13} aria-hidden="true" />}
                                    onClick={() => setConfirmDelete(true)}
                                >
                                    Remove source
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<RefreshCw size={13} aria-hidden="true" />}
                                    loading={validate.isPending}
                                    onClick={testConnection}
                                >
                                    Test
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" loading={pending}>
                            {source ? 'Save source' : 'Add source'}
                        </Button>
                    </div>
                </div>
            </form>
        </section>
    );
}

function SourceCard({
    source,
    onEdit,
}: {
    source: MediaSourceDto;
    onEdit: (source: MediaSourceDto) => void;
}) {
    const validate = useValidateMediaSource();
    const remove = useDeleteMediaSource();
    const toast = useToast();
    const [librariesOpen, setLibrariesOpen] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const status = sourceStatus(source);

    return (
        <section className="rounded-[28px] border border-border/60 bg-surface">
            <div className="flex flex-col gap-4 px-5 py-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold tracking-[-0.01em] text-text">{source.name}</h2>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        <span className="rounded-full border border-border/60 bg-raised/60 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                            {source.kind === 'jellyfin' ? 'Jellyfin' : 'Plex'}
                        </span>
                    </div>
                    <p className="mt-1.5 truncate text-xs text-text-muted">{source.serverUrl}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-text-muted">
                        <span className="rounded-full bg-raised/50 px-2.5 py-1">{source.channelName}</span>
                        <span className="rounded-full bg-raised/50 px-2.5 py-1">
                            {source.enabledLibraryCount}/{source.libraryCount} libraries
                        </span>
                        <span className="rounded-full bg-raised/50 px-2.5 py-1">{qualityLabel(source.defaultQuality)}</span>
                    </div>
                    {source.error ? (
                        <p className="mt-2 text-xs leading-relaxed text-danger">{source.error}</p>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Library size={13} aria-hidden="true" />}
                        aria-expanded={librariesOpen}
                        onClick={() => setLibrariesOpen((current) => !current)}
                    >
                        {librariesOpen ? 'Hide libraries' : 'Libraries'}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Pencil size={13} aria-hidden="true" />}
                        onClick={() => onEdit(source)}
                    >
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<RefreshCw size={13} aria-hidden="true" />}
                        loading={validate.isPending}
                        onClick={() =>
                            validate.mutate(source.id, {
                                onSuccess: (saved) =>
                                    toast({
                                        title: saved.connected
                                            ? 'Connection is healthy'
                                            : 'Connection failed',
                                        description: saved.error ?? undefined,
                                        tone: saved.connected ? 'success' : 'error',
                                    }),
                                onError: (error) =>
                                    toast({
                                        title: 'Validation failed',
                                        description: errorMessage(error),
                                        tone: 'error',
                                    }),
                            })
                        }
                    >
                        Test
                    </Button>
                    <Link
                        to={`/media?source=${source.id}`}
                        className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                    >
                        <Play size={13} aria-hidden="true" />
                        Browse
                    </Link>
                    <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash size={13} aria-hidden="true" />}
                        onClick={() => setConfirmRemove(true)}
                    >
                        Remove
                    </Button>
                </div>
            </div>

            {confirmRemove ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-danger/25 bg-danger/[0.07] px-5 py-3.5">
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger">
                        Remove {source.name} and its libraries, queue entries, and saved playback
                        history? The server itself is not changed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="danger"
                            size="sm"
                            loading={remove.isPending}
                            onClick={() =>
                                remove.mutate(source.id, {
                                    onSuccess: () =>
                                        toast({
                                            title: 'Source removed',
                                            description: source.name,
                                            tone: 'success',
                                        }),
                                    onError: (error) =>
                                        toast({
                                            title: 'Could not remove the source',
                                            description: errorMessage(error),
                                            tone: 'error',
                                        }),
                                })
                            }
                        >
                            Remove source
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmRemove(false)}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}

            {librariesOpen ? <SourceLibraries source={source} /> : null}
        </section>
    );
}

export default function MediaSourcesPage() {
    const sources = useMediaSources();
    const [editor, setEditor] = useState<{ source: MediaSourceDto | null } | null>(null);
    const list = sources.data ?? [];
    const connected = list.filter((source) => source.connected).length;
    const adding = editor !== null && editor.source === null;

    return (
        <>
            <PageHeader
                title="Media sources"
                meta={
                    list.length > 0
                        ? `${list.length} source${list.length === 1 ? '' : 's'} · ${connected} connected`
                        : 'Plex and Jellyfin management'
                }
                actions={
                    <>
                        <span className="hidden sm:inline-flex">
                            <Link
                                to="/media"
                                className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                            >
                                <ArrowLeft size={14} aria-hidden="true" />
                                Back to media
                            </Link>
                        </span>
                        <span className="hidden sm:inline-flex">
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<Plus size={14} aria-hidden="true" />}
                                onClick={() => setEditor({ source: null })}
                            >
                                Add source
                            </Button>
                        </span>
                    </>
                }
            />

            <div className="mx-auto w-full max-w-[1100px] space-y-5 p-3 sm:p-5 xl:p-6">
                <div className="flex items-center justify-between gap-2 sm:hidden">
                    <Link to="/media" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to media
                    </Link>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={<Plus size={14} aria-hidden="true" />}
                        onClick={() => setEditor({ source: null })}
                    >
                        Add source
                    </Button>
                </div>
                {adding ? (
                    <SourceForm
                        source={null}
                        onCancel={() => setEditor(null)}
                        onSaved={() => setEditor(null)}
                    />
                ) : null}

                {sources.isPending ? (
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1].map((index) => (
                            <div
                                key={index}
                                className="space-y-3 rounded-[28px] border border-border/60 bg-surface p-5"
                            >
                                <Skeleton className="h-5 w-48" />
                                <Skeleton className="h-3.5 w-72" />
                                <Skeleton className="h-3 w-40" />
                            </div>
                        ))}
                    </div>
                ) : sources.isError ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="Media sources could not load"
                            error={sources.error}
                            onRetry={() => void sources.refetch()}
                        />
                    </section>
                ) : list.length === 0 && !adding ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <EmptyState
                            icon={Server}
                            title="No media sources"
                            description="Add a Plex or Jellyfin server to browse libraries and open a virtual channel in Discord."
                            action={
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<Plus size={13} aria-hidden="true" />}
                                    onClick={() => setEditor({ source: null })}
                                >
                                    Add media source
                                </Button>
                            }
                        />
                    </section>
                ) : (
                    <div className="space-y-3">
                        {list.map((source) =>
                            editor?.source?.id === source.id ? (
                                <SourceForm
                                    key={source.id}
                                    source={source}
                                    onCancel={() => setEditor(null)}
                                    onSaved={() => setEditor(null)}
                                />
                            ) : (
                                <SourceCard
                                    key={source.id}
                                    source={source}
                                    onEdit={(selected) => setEditor({ source: selected })}
                                />
                            )
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
