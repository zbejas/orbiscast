import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Save, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router';
import type { PlexQuality, SettingsDto } from '@shared/types';
import {
    Button,
    ErrorState,
    Field,
    IconButton,
    Input,
    Notice,
    PageHeader,
    Select,
    Skeleton,
    StatusPill,
    Switch,
    Textarea,
    useToast,
} from '@/components';
import {
    qk,
    useAuthConfig,
    useEnableAuth,
    useLogin,
    usePlexConfig,
    useSavePlexConfig,
    useSettings,
    useUpdateSettings,
} from '@/lib/hooks';

const FALLBACK_TIMEZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Asia/Tokyo',
    'Australia/Sydney',
];

const TIMEZONES: string[] = (() => {
    try {
        const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
        return intl.supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES;
    } catch {
        return FALLBACK_TIMEZONES;
    }
})();

const LOG_LEVELS: Array<{ value: SettingsDto['logLevel']; label: string }> = [
    { value: 'error', label: 'Error' },
    { value: 'warn', label: 'Warn' },
    { value: 'info', label: 'Info' },
    { value: 'debug', label: 'Debug' },
];

const QUALITIES: Array<{ value: PlexQuality; label: string }> = [
    { value: '720p-4', label: '720p · 4 Mbps' },
    { value: '1080p-8', label: '1080p · 8 Mbps' },
    { value: '1080p-12', label: '1080p · 12 Mbps' },
    { value: '4k-20', label: '4K · 20 Mbps' },
];

interface SettingsForm {
    timezone: string;
    logLevel: SettingsDto['logLevel'];
    publicUrl: string;
    trustedOrigins: string;
    bitrateVideo: string;
    bitrateVideoMax: string;
    minimizeLatency: boolean;
    disableTranscode: boolean;
    defaultStreamTimeout: string;
    plexChannelName: string;
    idleMinutes: string;
    emptyGraceSeconds: string;
    defaultQuality: PlexQuality;
    authEnabled: boolean;
}

type FieldKey =
    | 'bitrateVideo'
    | 'bitrateVideoMax'
    | 'defaultStreamTimeout'
    | 'plexChannelName'
    | 'idleMinutes'
    | 'emptyGraceSeconds'
    | 'timezone'
    | 'publicUrl'
    | 'trustedOrigins';

type FormErrors = Partial<Record<FieldKey, string>>;

function toForm(settings: SettingsDto): SettingsForm {
    return {
        timezone: settings.timezone,
        logLevel: settings.logLevel,
        publicUrl: settings.publicUrl,
        trustedOrigins: settings.trustedOrigins.join('\n'),
        bitrateVideo: String(settings.stream.bitrateVideo),
        bitrateVideoMax: String(settings.stream.bitrateVideoMax),
        minimizeLatency: settings.stream.minimizeLatency,
        disableTranscode: settings.stream.disableTranscode,
        defaultStreamTimeout: String(settings.stream.defaultStreamTimeout),
        plexChannelName: settings.plex.channelName,
        idleMinutes: String(settings.plex.idleMinutes),
        emptyGraceSeconds: String(settings.plex.emptyGraceSeconds),
        defaultQuality: settings.plex.defaultQuality,
        authEnabled: settings.auth.enabled,
    };
}

function toDto(form: SettingsForm): SettingsDto {
    return {
        timezone: form.timezone,
        logLevel: form.logLevel,
        publicUrl: form.publicUrl.trim(),
        trustedOrigins: form.trustedOrigins
            .split(/[\n,]/)
            .map((origin) => origin.trim())
            .filter(Boolean),
        stream: {
            bitrateVideo: Number(form.bitrateVideo),
            bitrateVideoMax: Number(form.bitrateVideoMax),
            minimizeLatency: form.minimizeLatency,
            disableTranscode: form.disableTranscode,
            defaultStreamTimeout: Number(form.defaultStreamTimeout),
        },
        plex: {
            channelName: form.plexChannelName.trim(),
            idleMinutes: Number(form.idleMinutes),
            emptyGraceSeconds: Number(form.emptyGraceSeconds),
            defaultQuality: form.defaultQuality,
        },
        auth: {
            enabled: form.authEnabled,
        },
    };
}

function numberError(value: string, min: number, max: number, label: string): string | undefined {
    const number = Number(value);
    if (value.trim() === '' || !Number.isInteger(number) || number < min || number > max) {
        return `${label} must be a whole number between ${min} and ${max}.`;
    }
    return undefined;
}

function validateField(key: FieldKey, form: SettingsForm): string | undefined {
    switch (key) {
        case 'bitrateVideo':
            return numberError(form.bitrateVideo, 500, 20000, 'Video bitrate');
        case 'bitrateVideoMax': {
            const base = numberError(form.bitrateVideoMax, 500, 50000, 'Maximum bitrate');
            if (base) return base;
            if (Number(form.bitrateVideoMax) < Number(form.bitrateVideo)) {
                return 'Maximum bitrate cannot be lower than the target bitrate.';
            }
            return undefined;
        }
        case 'defaultStreamTimeout':
            return numberError(form.defaultStreamTimeout, 1, 1440, 'Fallback stream timeout');
        case 'plexChannelName':
            return form.plexChannelName.trim().length === 0
                ? 'Give the Plex channel a name.'
                : form.plexChannelName.trim().length > 100
                  ? 'Keep the channel name under 100 characters.'
                  : undefined;
        case 'idleMinutes':
            return numberError(form.idleMinutes, 1, 240, 'Idle timer');
        case 'emptyGraceSeconds':
            return numberError(form.emptyGraceSeconds, 0, 3600, 'Empty channel grace');
        case 'timezone':
            return form.timezone.trim() ? undefined : 'Choose a timezone.';
        case 'publicUrl': {
            if (!form.publicUrl.trim()) return undefined;
            try {
                const url = new URL(form.publicUrl.trim());
                return url.protocol === 'http:' || url.protocol === 'https:'
                    ? undefined
                    : 'Use an http or https URL.';
            } catch {
                return 'Enter a full URL, or leave this blank.';
            }
        }
        case 'trustedOrigins': {
            const origins = form.trustedOrigins
                .split(/[\n,]/)
                .map((origin) => origin.trim())
                .filter(Boolean);
            for (const origin of origins) {
                try {
                    const url = new URL(origin);
                    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                        return 'Each trusted origin must start with http or https.';
                    }
                    if (url.pathname !== '/' || url.search || url.hash) {
                        return 'Use an origin only, for example https://orbits.example.com.';
                    }
                } catch {
                    return 'One trusted origin is not a valid URL.';
                }
            }
            return undefined;
        }
        default:
            return undefined;
    }
}

function validateAll(form: SettingsForm): FormErrors {
    const keys: FieldKey[] = [
        'bitrateVideo',
        'bitrateVideoMax',
        'defaultStreamTimeout',
        'plexChannelName',
        'idleMinutes',
        'emptyGraceSeconds',
        'timezone',
        'publicUrl',
        'trustedOrigins',
    ];
    const errors: FormErrors = {};
    for (const key of keys) {
        const error = validateField(key, form);
        if (error) errors[key] = error;
    }
    return errors;
}

interface AuthFormErrors {
    username?: string;
    password?: string;
    confirm?: string;
}

function validateAuthForm(username: string, password: string, confirm: string): AuthFormErrors {
    const errors: AuthFormErrors = {};
    const name = username.trim();
    if (name.length < 3 || name.length > 30) {
        errors.username = 'Use 3 to 30 characters.';
    }
    if (password.length < 8 || password.length > 128) {
        errors.password = 'Use 8 to 128 characters.';
    }
    if (confirm !== password) {
        errors.confirm = 'The passwords do not match.';
    }
    return errors;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete.';
}

function Section({
    id,
    title,
    description,
    children,
}: {
    id?: string;
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            aria-labelledby={id ? `${id}-title` : undefined}
            className="scroll-mt-20 rounded-xl border border-border bg-surface"
        >
            <div className="border-b border-border px-4 py-3 sm:px-5">
                <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-text">
                    {title}
                </h2>
                <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-text-muted">{description}</p>
            </div>
            <div className="p-4 sm:p-5">{children}</div>
        </section>
    );
}

function PlexConnectionSection() {
    const config = usePlexConfig();
    const save = useSavePlexConfig();
    const toast = useToast();
    const [serverUrl, setServerUrl] = useState('');
    const [token, setToken] = useState('');
    const [reveal, setReveal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (config.data) setServerUrl(config.data.serverUrl);
    }, [config.data?.serverUrl]);

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        const value = serverUrl.trim();
        if (!value) {
            setError('Enter the Plex server URL.');
            return;
        }
        try {
            const url = new URL(value);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                setError('Use an http or https URL.');
                return;
            }
        } catch {
            setError('Enter a full URL, for example https://plex.example.com:32400.');
            return;
        }
        save.mutate(
            { serverUrl: value, token: token.trim() || undefined },
            {
                onSuccess: (result) => {
                    setToken('');
                    setReveal(false);
                    toast({
                        title: result.connected ? 'Plex connected' : 'Plex connection failed',
                        description: result.connected
                            ? `${result.serverUrl} is reachable.`
                            : (result.error ?? 'Check the server URL and token.'),
                        tone: result.connected ? 'success' : 'error',
                    });
                },
                onError: (mutationError) =>
                    toast({
                        title: 'Could not save the Plex connection',
                        description:
                            mutationError instanceof Error
                                ? mutationError.message
                                : 'The request did not complete.',
                        tone: 'error',
                    }),
            }
        );
    };

    const status = config.data?.connected
        ? { label: 'Connected', tone: 'plex' as const }
        : config.data?.error
          ? { label: 'Error', tone: 'danger' as const }
          : { label: 'Not connected', tone: 'neutral' as const };

    return (
        <Section
            id="plex-connection"
            title="Plex connection"
            description="The Plex server URL and token. This section saves separately and tests the connection when you save."
        >
            {config.isPending ? (
                <div className="space-y-3" aria-hidden="true">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                </div>
            ) : config.isError ? (
                <ErrorState compact error={config.error} onRetry={() => void config.refetch()} />
            ) : (
                <form noValidate onSubmit={submit} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field
                            label="Server URL"
                            htmlFor="plex-server-url"
                            hint="Include the scheme and port, for example https://plex.example.com:32400."
                            error={error}
                            className="sm:col-span-2"
                        >
                            <Input
                                id="plex-server-url"
                                type="url"
                                value={serverUrl}
                                onChange={(event) => {
                                    setServerUrl(event.target.value);
                                    if (error) setError(null);
                                }}
                                placeholder="https://plex.example.com:32400"
                                spellCheck={false}
                                autoComplete="off"
                            />
                        </Field>
                        <Field
                            label="Plex token"
                            htmlFor="plex-token"
                            hint={
                                config.data?.tokenSet
                                    ? `Stored token ending ${config.data.tokenLast4 ?? '••••'}. Enter a new value only to replace it.`
                                    : 'No token stored yet.'
                            }
                            className="sm:col-span-2"
                        >
                            <div className="relative">
                                <Input
                                    id="plex-token"
                                    type={reveal ? 'text' : 'password'}
                                    value={token}
                                    onChange={(event) => setToken(event.target.value)}
                                    placeholder={
                                        config.data?.tokenSet
                                            ? `••••••••••••${config.data.tokenLast4 ?? ''}`
                                            : 'Paste the Plex token'
                                    }
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="pr-11 font-mono text-xs"
                                />
                                <IconButton
                                    label={
                                        token
                                            ? reveal
                                                ? 'Hide Plex token'
                                                : 'Show Plex token'
                                            : 'Enter a Plex token to reveal it'
                                    }
                                    size="sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2"
                                    disabled={!token}
                                    onClick={() => setReveal((current) => !current)}
                                >
                                    {reveal ? (
                                        <EyeOff size={15} aria-hidden="true" />
                                    ) : (
                                        <Eye size={15} aria-hidden="true" />
                                    )}
                                </IconButton>
                            </div>
                        </Field>
                    </div>
                    {config.data?.error ? (
                        <Notice tone="danger" title="Plex reported an error">
                            {config.data.error}
                        </Notice>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={save.isPending}
                            icon={<ShieldCheck size={14} aria-hidden="true" />}
                        >
                            Save and test
                        </Button>
                    </div>
                </form>
            )}
        </Section>
    );
}

export default function SettingsPage() {
    const settings = useSettings();
    const authConfig = useAuthConfig();
    const update = useUpdateSettings();
    const enableAuth = useEnableAuth();
    const login = useLogin();
    const queryClient = useQueryClient();
    const toast = useToast();
    const location = useLocation();
    const formRef = useRef<HTMLFormElement>(null);
    const [form, setForm] = useState<SettingsForm | null>(null);
    const [errors, setErrors] = useState<FormErrors>({});
    const [authUsername, setAuthUsername] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authConfirm, setAuthConfirm] = useState('');
    const [authErrors, setAuthErrors] = useState<AuthFormErrors>({});
    const [authError, setAuthError] = useState<string | null>(null);
    const initialRef = useRef<SettingsDto | null>(null);

    useEffect(() => {
        if (!settings.data) return;
        if (initialRef.current === null || settings.data !== initialRef.current) {
            initialRef.current = settings.data;
            setForm(toForm(settings.data));
        }
    }, [settings.data]);

    const formReady = form !== null;
    useEffect(() => {
        const hash = location.hash.replace('#', '');
        if (!hash) return;
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(hash)?.scrollIntoView({ block: 'start' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [location.hash, formReady]);

    const zones = useMemo(() => {
        if (!form?.timezone) return TIMEZONES;
        return TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];
    }, [form?.timezone]);

    const dirty = useMemo(() => {
        if (!settings.data || !form) return false;
        return JSON.stringify(toDto(form)) !== JSON.stringify(settings.data);
    }, [form, settings.data]);

    const authTransition = Boolean(form?.authEnabled && settings.data && !settings.data.auth.enabled);
    const needsNewAdmin = Boolean(authTransition && authConfig.data?.hasUser === false);
    const authCheckPending = Boolean(authTransition && authConfig.isPending);
    const saving = update.isPending || enableAuth.isPending || login.isPending;
    const saveDisabled = !form || settings.isError || authCheckPending;

    const updateField = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
        setForm((current) => (current ? { ...current, [key]: value } : current));
        setErrors((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key as FieldKey];
            return next;
        });
    };

    const blurField = (key: FieldKey) => {
        if (!form) return;
        const error = validateField(key, form);
        setErrors((current) => {
            const next = { ...current };
            if (error) next[key] = error;
            else delete next[key];
            return next;
        });
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!form || !settings.data) return;
        const next = validateAll(form);
        const nextAuthErrors = needsNewAdmin
            ? validateAuthForm(authUsername, authPassword, authConfirm)
            : {};
        setErrors(next);
        setAuthErrors(nextAuthErrors);
        if (Object.keys(next).length > 0 || Object.keys(nextAuthErrors).length > 0) {
            window.requestAnimationFrame(() => {
                formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            });
            return;
        }
        setAuthError(null);

        if (!needsNewAdmin) {
            try {
                await update.mutateAsync(toDto(form));
                toast({ title: 'Settings saved', tone: 'success' });
            } catch (error) {
                const message = messageOf(error);
                if (form.authEnabled && !settings.data.auth.enabled) {
                    setAuthError(`Could not enable authentication. ${message}`);
                } else {
                    toast({
                        title: 'Could not save settings',
                        description: message,
                        tone: 'error',
                    });
                }
            }
            return;
        }

        let didEnable = false;
        try {
            await enableAuth.mutateAsync({
                username: authUsername.trim(),
                password: authPassword,
            });
            didEnable = true;
            await login.mutateAsync({
                username: authUsername.trim(),
                password: authPassword,
            });
            queryClient.setQueryData(qk.authConfig, { enabled: true, hasUser: true });
            await update.mutateAsync(toDto(form));
            setAuthPassword('');
            setAuthConfirm('');
            setAuthErrors({});
            toast({
                title: 'Authentication enabled',
                description: 'Sign in with the new account the next time you open OrbisCast.',
                tone: 'success',
            });
        } catch (error) {
            const message = messageOf(error);
            setAuthError(
                didEnable
                    ? `Authentication is enabled, but the rest of the setup did not finish. Sign in with the new account and save again. ${message}`
                    : `Could not enable authentication. ${message}`
            );
        }
    };

    return (
        <>
            <PageHeader
                title="Settings"
                meta={dirty ? 'Unsaved changes' : 'Configuration'}
                actions={
                    <>
                        <StatusPill tone={dirty ? 'warn' : 'neutral'} dot={false}>
                            {dirty ? 'Unsaved' : 'Saved'}
                        </StatusPill>
                        <Button
                            type="submit"
                            form="settings-form"
                            variant="primary"
                            size="sm"
                            icon={<Save size={14} aria-hidden="true" />}
                            loading={saving}
                            disabled={saveDisabled}
                        >
                            Save
                        </Button>
                    </>
                }
            />
            <div className="oc-page-enter mx-auto w-full max-w-[980px] space-y-4 p-3 sm:p-5 xl:p-6">
                {settings.isError ? (
                    <section className="rounded-xl border border-border bg-surface">
                        <ErrorState
                            title="Settings could not load"
                            error={settings.error}
                            onRetry={() => void settings.refetch()}
                        />
                    </section>
                ) : settings.isPending || !form ? (
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="rounded-xl border border-border bg-surface p-4">
                                <Skeleton className="h-5 w-40" />
                                <Skeleton className="mt-2 h-3 w-2/3" />
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <Skeleton className="h-9 w-full" />
                                    <Skeleton className="h-9 w-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                    <form id="settings-form" ref={formRef} noValidate onSubmit={submit} className="space-y-4">
                        <Section
                            title="Streaming"
                            description="Encoder targets for the Discord stream. Changes apply to the next stream."
                        >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field
                                    label="Video bitrate (kbps)"
                                    htmlFor="bitrate-video"
                                    hint="Target bitrate for the H.264 encoder."
                                    error={errors.bitrateVideo}
                                    required
                                >
                                    <Input
                                        id="bitrate-video"
                                        type="number"
                                        inputMode="numeric"
                                        min={500}
                                        max={20000}
                                        step={500}
                                        value={form.bitrateVideo}
                                        onChange={(event) => updateField('bitrateVideo', event.target.value)}
                                        onBlur={() => blurField('bitrateVideo')}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Maximum bitrate (kbps)"
                                    htmlFor="bitrate-max"
                                    hint="Upper bound when the encoder adapts."
                                    error={errors.bitrateVideoMax}
                                    required
                                >
                                    <Input
                                        id="bitrate-max"
                                        type="number"
                                        inputMode="numeric"
                                        min={500}
                                        max={50000}
                                        step={500}
                                        value={form.bitrateVideoMax}
                                        onChange={(event) => updateField('bitrateVideoMax', event.target.value)}
                                        onBlur={() => blurField('bitrateVideoMax')}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Fallback stream timeout (minutes)"
                                    htmlFor="stream-timeout"
                                    hint="Stops playback when the channel stays empty."
                                    error={errors.defaultStreamTimeout}
                                    required
                                >
                                    <Input
                                        id="stream-timeout"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={1440}
                                        step={1}
                                        value={form.defaultStreamTimeout}
                                        onChange={(event) =>
                                            updateField('defaultStreamTimeout', event.target.value)
                                        }
                                        onBlur={() => blurField('defaultStreamTimeout')}
                                        required
                                    />
                                </Field>
                                <div className="space-y-2 sm:pt-2">
                                    <Switch
                                        checked={form.minimizeLatency}
                                        onChange={(event) =>
                                            updateField('minimizeLatency', event.target.checked)
                                        }
                                        label="Minimize latency"
                                        description="Favor a shorter buffer over a steadier stream."
                                    />
                                    <Switch
                                        checked={form.disableTranscode}
                                        onChange={(event) =>
                                            updateField('disableTranscode', event.target.checked)
                                        }
                                        label="Disable transcode"
                                        description="Remux compatible sources and skip re-encoding."
                                    />
                                </div>
                            </div>
                        </Section>

                        <Section
                            id="plex"
                            title="Plex channel"
                            description="The virtual Discord channel that shows the Plex placeholder and hosts on-demand playback."
                        >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field
                                    label="Channel name"
                                    htmlFor="plex-channel-name"
                                    hint="Shown in Discord and on the WebUI."
                                    error={errors.plexChannelName}
                                    required
                                    className="sm:col-span-2"
                                >
                                    <Input
                                        id="plex-channel-name"
                                        value={form.plexChannelName}
                                        onChange={(event) =>
                                            updateField('plexChannelName', event.target.value)
                                        }
                                        onBlur={() => blurField('plexChannelName')}
                                        maxLength={100}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Idle timer (minutes)"
                                    htmlFor="plex-idle"
                                    hint="How long the channel stays after playback ends."
                                    error={errors.idleMinutes}
                                    required
                                >
                                    <Input
                                        id="plex-idle"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={240}
                                        step={1}
                                        value={form.idleMinutes}
                                        onChange={(event) => updateField('idleMinutes', event.target.value)}
                                        onBlur={() => blurField('idleMinutes')}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Empty channel grace (seconds)"
                                    htmlFor="plex-grace"
                                    hint="Seconds to wait when the last viewer leaves."
                                    error={errors.emptyGraceSeconds}
                                    required
                                >
                                    <Input
                                        id="plex-grace"
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={3600}
                                        step={5}
                                        value={form.emptyGraceSeconds}
                                        onChange={(event) =>
                                            updateField('emptyGraceSeconds', event.target.value)
                                        }
                                        onBlur={() => blurField('emptyGraceSeconds')}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Default quality"
                                    htmlFor="plex-quality"
                                    hint="Used when a queue item does not specify a quality."
                                    className="sm:col-span-2"
                                >
                                    <Select
                                        id="plex-quality"
                                        value={form.defaultQuality}
                                        onChange={(event) =>
                                            updateField(
                                                'defaultQuality',
                                                event.target.value as PlexQuality
                                            )
                                        }
                                    >
                                        {QUALITIES.map((quality) => (
                                            <option key={quality.value} value={quality.value}>
                                                {quality.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <p className="text-[11px] leading-relaxed text-text-faint sm:col-span-2">
                                    The channel name updates the next time the virtual channel joins the voice
                                    channel.
                                </p>
                            </div>
                        </Section>

                        <Section
                            title="General"
                            description="Time and log preferences for the whole process."
                        >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field
                                    label="Public URL"
                                    htmlFor="public-url"
                                    hint="Optional. Used for auth callbacks and absolute links."
                                    error={errors.publicUrl}
                                    className="sm:col-span-2"
                                >
                                    <Input
                                        id="public-url"
                                        type="url"
                                        value={form.publicUrl}
                                        onChange={(event) => updateField('publicUrl', event.target.value)}
                                        onBlur={() => blurField('publicUrl')}
                                        placeholder="https://orbiscast.example.com"
                                        spellCheck={false}
                                    />
                                </Field>
                                <Field
                                    label="Trusted origins"
                                    htmlFor="trusted-origins"
                                    hint="One origin per line. Add the URL you use to reach the WebUI when it is not the public URL."
                                    error={errors.trustedOrigins}
                                    className="sm:col-span-2"
                                >
                                    <Textarea
                                        id="trusted-origins"
                                        value={form.trustedOrigins}
                                        onChange={(event) =>
                                            updateField('trustedOrigins', event.target.value)
                                        }
                                        onBlur={() => blurField('trustedOrigins')}
                                        placeholder={'https://orbiscast.example.com\nhttps://media.example.com'}
                                        spellCheck={false}
                                        rows={3}
                                    />
                                </Field>
                                <Field
                                    label="Timezone"
                                    htmlFor="timezone"
                                    hint="Used for guide times, logs, and schedules."
                                    error={errors.timezone}
                                    required
                                >
                                    <Select
                                        id="timezone"
                                        value={form.timezone}
                                        onChange={(event) => updateField('timezone', event.target.value)}
                                        onBlur={() => blurField('timezone')}
                                    >
                                        {zones.map((zone) => (
                                            <option key={zone} value={zone}>
                                                {zone}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label="Log level" htmlFor="log-level" hint="Applied immediately after saving.">
                                    <Select
                                        id="log-level"
                                        value={form.logLevel}
                                        onChange={(event) =>
                                            updateField(
                                                'logLevel',
                                                event.target.value as SettingsDto['logLevel']
                                            )
                                        }
                                    >
                                        {LOG_LEVELS.map((level) => (
                                            <option key={level.value} value={level.value}>
                                                {level.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                        </Section>

                        <Section
                            id="auth"
                            title="Authentication"
                            description="Password protection for this WebUI. Auth is off by default."
                        >
                            <Switch
                                checked={form.authEnabled}
                                onChange={(event) => {
                                    updateField('authEnabled', event.target.checked);
                                    setAuthError(null);
                                }}
                                label="Require a username and password"
                                description="When enabled, every page except the login page requires a session."
                            />
                            {form.authEnabled ? (
                                authCheckPending ? (
                                    <p className="mt-4 flex items-center gap-2 text-xs text-text-muted">
                                        <span
                                            aria-hidden="true"
                                            className="size-1.5 animate-pulse rounded-full bg-blurple"
                                        />
                                        Checking for an existing admin account.
                                    </p>
                                ) : authConfig.isError ? (
                                    <Notice
                                        tone="danger"
                                        title="Could not check the admin account"
                                        className="mt-4"
                                    >
                                        Reload the page before enabling authentication.
                                    </Notice>
                                ) : needsNewAdmin ? (
                                    <div className="mt-4 space-y-4 border-t border-border pt-4">
                                        <p className="text-xs leading-relaxed text-text-muted">
                                            No admin account exists yet. Create one now. If you lose this
                                            password, use the server CLI to reset the account.
                                        </p>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <Field
                                                label="Username"
                                                htmlFor="auth-username"
                                                error={authErrors.username}
                                                required
                                                className="sm:col-span-2"
                                            >
                                                <Input
                                                    id="auth-username"
                                                    value={authUsername}
                                                    autoComplete="username"
                                                    spellCheck={false}
                                                    onChange={(event) => {
                                                        setAuthUsername(event.target.value);
                                                        if (authErrors.username) {
                                                            setAuthErrors((current) => ({
                                                                ...current,
                                                                username: undefined,
                                                            }));
                                                        }
                                                    }}
                                                    required
                                                />
                                            </Field>
                                            <Field
                                                label="Password"
                                                htmlFor="auth-password"
                                                hint="At least 8 characters."
                                                error={authErrors.password}
                                                required
                                            >
                                                <Input
                                                    id="auth-password"
                                                    type="password"
                                                    value={authPassword}
                                                    autoComplete="new-password"
                                                    onChange={(event) => {
                                                        setAuthPassword(event.target.value);
                                                        if (authErrors.password) {
                                                            setAuthErrors((current) => ({
                                                                ...current,
                                                                password: undefined,
                                                            }));
                                                        }
                                                    }}
                                                    required
                                                />
                                            </Field>
                                            <Field
                                                label="Confirm password"
                                                htmlFor="auth-confirm"
                                                error={authErrors.confirm}
                                                required
                                            >
                                                <Input
                                                    id="auth-confirm"
                                                    type="password"
                                                    value={authConfirm}
                                                    autoComplete="new-password"
                                                    onChange={(event) => {
                                                        setAuthConfirm(event.target.value);
                                                        if (authErrors.confirm) {
                                                            setAuthErrors((current) => ({
                                                                ...current,
                                                                confirm: undefined,
                                                            }));
                                                        }
                                                    }}
                                                    required
                                                />
                                            </Field>
                                        </div>
                                    </div>
                                ) : (
                                    <Notice
                                        tone="info"
                                        title={
                                            settings.data?.auth.enabled
                                                ? 'Authentication is on'
                                                : 'Admin account ready'
                                        }
                                        className="mt-4"
                                    >
                                        {settings.data?.auth.enabled
                                            ? 'Signing out returns you to the login page. Use the admin account to sign back in.'
                                            : 'An admin account already exists. Saving turns on the login screen, and you will sign in with that account.'}
                                    </Notice>
                                )
                            ) : null}
                            {authError ? (
                                <Notice
                                    tone="danger"
                                    title="Authentication was not updated"
                                    className="mt-4"
                                >
                                    {authError}
                                </Notice>
                            ) : null}
                        </Section>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                            <p className="text-[11px] text-text-faint">
                                {dirty
                                    ? 'You have unsaved changes.'
                                    : 'Every setting on this page is stored in SQLite.'}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="secondary"
                                    disabled={!dirty}
                                    onClick={() => {
                                        if (settings.data) {
                                            setForm(toForm(settings.data));
                                            setErrors({});
                                            setAuthErrors({});
                                            setAuthError(null);
                                        }
                                    }}
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    loading={saving}
                                    disabled={saveDisabled}
                                >
                                    Save changes
                                </Button>
                            </div>
                        </div>
                    </form>
                    <PlexConnectionSection />
                    </>
                )}
            </div>
        </>
    );
}
