import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cog, Film, Save, Server, ShieldCheck, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import type { SettingsDto } from '@shared/types';
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
    buttonStyles,
    useToast,
} from '@/components';
import { cn } from '@/lib/cn';
import {
    qk,
    useAuthConfig,
    useEnableAuth,
    useLogin,
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

type SettingsSectionId = 'streaming' | 'sources' | 'general' | 'auth';

interface SettingsSection {
    id: SettingsSectionId;
    label: string;
    hint: string;
    icon: LucideIcon;
}

const SETTINGS_SECTIONS: SettingsSection[] = [
    { id: 'streaming', label: 'Streaming', hint: 'Encoder and playback', icon: SlidersHorizontal },
    { id: 'sources', label: 'Sources', hint: 'Plex and Jellyfin', icon: Server },
    { id: 'general', label: 'General', hint: 'Time, URLs, and logs', icon: Cog },
    { id: 'auth', label: 'Security', hint: 'Password protection', icon: ShieldCheck },
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
    playback: SettingsDto['playback'];
    authEnabled: boolean;
}

type FieldKey =
    | 'bitrateVideo'
    | 'bitrateVideoMax'
    | 'defaultStreamTimeout'
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
        playback: settings.playback,
        authEnabled: settings.auth.enabled,
    };
}

function toDto(
    form: SettingsForm,
    recentVoiceChannels: SettingsDto['recentVoiceChannels']
): SettingsDto {
    return {
        timezone: form.timezone,
        logLevel: form.logLevel,
        publicUrl: form.publicUrl.trim(),
        trustedOrigins: form.trustedOrigins
            .split(/[\n,]/)
            .map((origin) => origin.trim())
            .filter(Boolean),
        recentVoiceChannels,
        stream: {
            bitrateVideo: Number(form.bitrateVideo),
            bitrateVideoMax: Number(form.bitrateVideoMax),
            minimizeLatency: form.minimizeLatency,
            disableTranscode: form.disableTranscode,
            defaultStreamTimeout: Number(form.defaultStreamTimeout),
        },
        playback: form.playback,
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
            className="scroll-mt-24 rounded-[28px] border border-border/60 bg-surface"
        >
            <div className="border-b border-border/50 px-5 py-4">
                <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold tracking-[-0.01em] text-text">
                    {title}
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{description}</p>
            </div>
            <div className="p-5">{children}</div>
        </section>
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
    const [activeSection, setActiveSection] = useState<SettingsSectionId>('streaming');
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
        const section = SETTINGS_SECTIONS.find((item) => item.id === hash);
        if (section) setActiveSection(section.id);
        let nested = 0;
        const frame = window.requestAnimationFrame(() => {
            nested = window.requestAnimationFrame(() => {
                document.getElementById(hash)?.scrollIntoView({ block: 'start' });
            });
        });
        return () => {
            window.cancelAnimationFrame(frame);
            window.cancelAnimationFrame(nested);
        };
    }, [location.hash, formReady]);

    const zones = useMemo(() => {
        if (!form?.timezone) return TIMEZONES;
        return TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];
    }, [form?.timezone]);

    const dirty = useMemo(() => {
        if (!settings.data || !form) return false;
        return (
            JSON.stringify(toDto(form, settings.data.recentVoiceChannels)) !==
            JSON.stringify(settings.data)
        );
    }, [form, settings.data]);

    const authTransition = Boolean(form?.authEnabled && settings.data && !settings.data.auth.enabled);
    const needsNewAdmin = Boolean(authTransition && authConfig.data?.hasUser === false);
    const authCheckPending = Boolean(authTransition && authConfig.isPending);
    const saving = update.isPending || enableAuth.isPending || login.isPending;
    const saveDisabled = !form || settings.isError || authCheckPending;

    const selectSection = (id: SettingsSectionId) => {
        setActiveSection(id);
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                document.getElementById(id)?.scrollIntoView({ block: 'start' });
            });
        });
    };

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
            const streamingError = next.bitrateVideo || next.bitrateVideoMax || next.defaultStreamTimeout;
            if (streamingError) setActiveSection('streaming');
            else if (Object.keys(next).length > 0) setActiveSection('general');
            else if (Object.keys(nextAuthErrors).length > 0) setActiveSection('auth');
            window.requestAnimationFrame(() => {
                formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            });
            return;
        }
        setAuthError(null);

        if (!needsNewAdmin) {
            try {
                await update.mutateAsync(toDto(form, settings.data?.recentVoiceChannels ?? []));
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
            await update.mutateAsync(toDto(form, settings.data?.recentVoiceChannels ?? []));
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
            setActiveSection('auth');
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
                        <span className="hidden sm:inline-flex">
                            <StatusPill tone={dirty ? 'warn' : 'neutral'} dot={false}>
                                {dirty ? 'Unsaved' : 'Saved'}
                            </StatusPill>
                        </span>
                        <Button
                            type="submit"
                            form="settings-form"
                            variant="primary"
                            size="sm"
                            aria-label="Save"
                            icon={<Save size={14} aria-hidden="true" />}
                            loading={saving}
                            disabled={saveDisabled}
                        >
                            <span className="hidden sm:inline">Save</span>
                        </Button>
                    </>
                }
            />
            <div className="mx-auto w-full max-w-[980px] space-y-5 p-3 sm:p-5 xl:p-6">
                {settings.isError ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="Settings could not load"
                            error={settings.error}
                            onRetry={() => void settings.refetch()}
                        />
                    </section>
                ) : settings.isPending || !form ? (
                    <div className="space-y-3" aria-hidden="true">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="rounded-[28px] border border-border/60 bg-surface p-5">
                                <Skeleton className="h-5 w-40" />
                                <Skeleton className="mt-2 h-3 w-2/3" />
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <Skeleton className="h-11 w-full rounded-2xl" />
                                    <Skeleton className="h-11 w-full rounded-2xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                    <form id="settings-form" ref={formRef} noValidate onSubmit={submit} className="space-y-5">
                        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
                            <nav aria-label="Settings sections" className="hidden md:block">
                                <div className="space-y-1 rounded-[28px] border border-border/60 bg-surface p-2 md:sticky md:top-24">
                                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-text-faint">
                                        Configuration
                                    </p>
                                    {SETTINGS_SECTIONS.map((section) => {
                                        const Icon = section.icon;
                                        const selected = activeSection === section.id;
                                        return (
                                            <button
                                                key={section.id}
                                                type="button"
                                                aria-current={selected ? 'true' : undefined}
                                                onClick={() => selectSection(section.id)}
                                                className={cn(
                                                    'group flex min-h-14 w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left transition-[background-color,color,box-shadow] duration-200',
                                                    selected
                                                        ? 'bg-blurple/15 text-text ring-1 ring-inset ring-blurple/25'
                                                        : 'text-text-muted hover:bg-white/[0.04] hover:text-text'
                                                )}
                                            >
                                                <span
                                                    aria-hidden="true"
                                                    className={cn(
                                                        'grid size-8 shrink-0 place-items-center rounded-xl',
                                                        selected
                                                            ? 'bg-blurple/20 text-blurple-text'
                                                            : 'bg-raised/60 text-text-faint group-hover:text-text-muted'
                                                    )}
                                                >
                                                    <Icon size={16} />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-medium">
                                                        {section.label}
                                                    </span>
                                                    <span className="block truncate text-[11px] text-text-faint">
                                                        {section.hint}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </nav>

                            <div className="min-w-0 space-y-5">
                        <div className={cn(activeSection === 'streaming' ? 'block' : 'block md:hidden')}>
                        <Section
                            id="streaming"
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
                                <div className="space-y-2 rounded-[20px] bg-bg/30 p-3 sm:col-span-2 sm:mt-1 lg:col-span-1 lg:mt-0">
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
                        </div>

                        <div className={cn(activeSection === 'sources' ? 'block' : 'block md:hidden')}>
                        <Section
                            id="sources"
                            title="Media sources"
                            description="Plex and Jellyfin connections, libraries, virtual channel names, idle timers, and default quality are managed on the Media page."
                        >
                            <Link to="/media" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                <Film size={14} aria-hidden="true" />
                                Open Media
                            </Link>
                        </Section>
                        </div>

                        <div className={cn(activeSection === 'general' ? 'block' : 'block md:hidden')}>
                        <Section
                            id="general"
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
                        </div>

                        <div className={cn(activeSection === 'auth' ? 'block' : 'block md:hidden')}>
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
                                    <div className="mt-4 space-y-4 border-t border-border/50 pt-4">
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
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
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
                            </div>
                        </div>
                    </form>
                    </>
                )}
            </div>
        </>
    );
}
