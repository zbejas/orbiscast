import { useState, type FormEvent } from 'react';
import {
    Check,
    ChevronDown,
    Copy,
    Eye,
    EyeOff,
    MessagesSquare,
    Plus,
    RefreshCw,
    ShieldCheck,
    TriangleExclamationPoint,
} from 'lucide-react';
import type { DiscordStatusDto, GuildDto } from '@shared/types';
import {
    Button,
    ChannelMark,
    Checkbox,
    EmptyState,
    ErrorState,
    Field,
    IconButton,
    Input,
    Notice,
    PageHeader,
    Skeleton,
    StatusPill,
    buttonStyles,
    useToast,
} from '@/components';
import {
    useDiscordStatus,
    useDiscordTokens,
    useJoinStreamer,
    useReconnectDiscord,
    useSaveDiscordTokens,
    useSetGuildRoles,
    useValidateDiscord,
} from '@/lib/hooks';
import { formatCount } from '@/lib/format';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The request did not complete. Try again.';
}

function roleColor(color: number): string {
    if (!color) return '#8a94a6';
    return `#${color.toString(16).padStart(6, '0')}`;
}

function TokenField({
    id,
    label,
    value,
    onChange,
    reveal,
    onToggleReveal,
    stored,
    last4,
    placeholder,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    reveal: boolean;
    onToggleReveal: () => void;
    stored: boolean;
    last4: string | null;
    placeholder: string;
}) {
    return (
        <Field
            label={label}
            htmlFor={id}
            hint={
                stored
                    ? `Stored token ending ${last4 ?? '••••'}. Enter a new value only to replace it.`
                    : 'No token stored yet.'
            }
        >
            <div className="relative">
                <Input
                    id={id}
                    type={reveal ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={stored ? `••••••••••••${last4 ?? ''}` : placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-11 font-mono text-xs"
                />
                <IconButton
                    label={
                        value
                            ? reveal
                                ? `Hide ${label.toLowerCase()}`
                                : `Show ${label.toLowerCase()}`
                            : `Enter a new ${label.toLowerCase()} to reveal it`
                    }
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    disabled={!value}
                    onClick={onToggleReveal}
                >
                    {reveal ? (
                        <EyeOff size={15} aria-hidden="true" />
                    ) : (
                        <Eye size={15} aria-hidden="true" />
                    )}
                </IconButton>
            </div>
        </Field>
    );
}

function GuildAccess({
    guild,
    initiallyOpen,
    onRoleChange,
}: {
    guild: GuildDto;
    initiallyOpen: boolean;
    onRoleChange: (guild: GuildDto, roleIds: string[]) => void;
}) {
    const [open, setOpen] = useState(initiallyOpen);
    return (
        <details
            open={open}
            onToggle={(event) => setOpen(event.currentTarget.open)}
            className="group border-b border-border/50 last:border-b-0"
        >
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-raised/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blurple/70 [&::-webkit-details-marker]:hidden">
                <ChannelMark name={guild.name} size="sm" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{guild.name}</p>
                    <p className="truncate font-mono text-[11px] text-text-faint">{guild.id}</p>
                </div>
                <div className="hidden shrink-0 text-right text-[11px] text-text-muted sm:block">
                    <p>
                        {guild.allowedRoleIds.length} of {guild.roles.length} roles allowed
                    </p>
                    <p className="text-text-faint">{guild.voiceChannels.length} voice channels</p>
                </div>
                <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-text-muted transition-transform group-open:rotate-180"
                />
            </summary>
            <div className="px-4 pb-4 pt-1">
                {guild.allowedRoleIds.length === 0 ? (
                    <p className="mb-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
                        <ShieldCheck size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                        No roles are allowed. Only members with Manage Server can control playback.
                    </p>
                ) : (
                    <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
                        Members with any checked role can use the playback commands in this server.
                    </p>
                )}
                <fieldset>
                    <legend className="sr-only">Roles allowed to control playback in {guild.name}</legend>
                    <div className="grid grid-cols-1 gap-1 rounded-[20px] bg-bg/30 p-2 sm:grid-cols-2 xl:grid-cols-3">
                        {guild.roles.map((role) => {
                            const checked = guild.allowedRoleIds.includes(role.id);
                            return (
                                <Checkbox
                                    key={role.id}
                                    checked={checked}
                                    onChange={(event) => {
                                        const next = event.target.checked
                                            ? [...guild.allowedRoleIds, role.id]
                                            : guild.allowedRoleIds.filter((id) => id !== role.id);
                                        onRoleChange(guild, next);
                                    }}
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <span
                                                aria-hidden="true"
                                                className="size-2 shrink-0 rounded-full"
                                                style={{ backgroundColor: roleColor(role.color) }}
                                            />
                                            {role.name}
                                        </span>
                                    }
                                />
                            );
                        })}
                    </div>
                </fieldset>
                <p className="mt-3 text-[11px] text-text-faint">
                    Changes save automatically. An empty allowlist means Manage Server only.
                </p>
            </div>
        </details>
    );
}

function ConnectionCard({ status }: { status: DiscordStatusDto }) {
    const rows = [
        {
            label: 'Bot',
            state: status.bot,
            tag: status.botTag,
            detail: `${status.guilds.length} servers · slash commands`,
        },
        {
            label: 'Streamer',
            state: status.streamer,
            tag: status.streamerTag,
            detail: 'Self-bot · sends video and audio',
        },
    ];
    return (
        <section className="rounded-[28px] border border-border/60 bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-4">
                <h2 className="text-base font-semibold tracking-[-0.01em] text-text">Connection</h2>
                <span className="rounded-full bg-raised/60 px-2.5 py-1 text-[11px] text-text-muted">One streamer, one stream</span>
            </div>
            <dl className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                {rows.map((row) => {
                    const tone =
                        row.state === 'online'
                            ? 'live'
                            : row.state === 'error'
                              ? 'danger'
                              : row.state === 'connecting'
                                ? 'warn'
                                : 'neutral';
                    return (
                        <div
                            key={row.label}
                            className="flex items-start justify-between gap-3 rounded-[20px] bg-raised/40 px-4 py-4"
                        >
                            <div className="min-w-0">
                                <dt className="text-[11px] font-medium text-text-muted">
                                    {row.label}
                                </dt>
                                <dd className="mt-1 truncate text-sm text-text">
                                    {row.tag ?? 'Not connected'}
                                </dd>
                                <dd className="mt-1 text-[11px] text-text-muted">{row.detail}</dd>
                            </div>
                            <StatusPill tone={tone}>{row.state}</StatusPill>
                        </div>
                    );
                })}
            </dl>
            {status.error ? (
                <div className="border-t border-border/50 p-4">
                    <Notice tone="danger" title="Discord reported an error">
                        {status.error}
                    </Notice>
                </div>
            ) : null}
        </section>
    );
}

function InviteCard({
    status,
    retrying,
    onRetry,
}: {
    status: DiscordStatusDto;
    retrying: boolean;
    onRetry: (guildId?: string) => void;
}) {
    const toast = useToast();
    const [copied, setCopied] = useState<string | null>(null);
    const invite = status.botInviteUrl;
    const joined = new Set(status.streamerGuildIds);
    const missing = status.guilds.filter((guild) => !joined.has(guild.id));
    const join = status.streamerJoin;
    const allJoined = status.guilds.length > 0 && missing.length === 0;

    const copy = async (value: string, key: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                // Clipboard access needs a secure context. Plain-HTTP LAN
                // installs fall back to the legacy copy path.
                const area = document.createElement('textarea');
                area.value = value;
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(area);
                if (!ok) throw new Error('Copy was rejected');
            }
            setCopied(key);
            window.setTimeout(() => setCopied(null), 2_000);
            toast({ title: 'Link copied', tone: 'success' });
        } catch {
            toast({
                title: 'Could not copy the link',
                description: 'Open the link and copy it from the address bar.',
                tone: 'error',
            });
        }
    };

    const pillTone = allJoined
        ? 'live'
        : join.state === 'error'
          ? 'danger'
          : status.guilds.length === 0 || join.state === 'joining'
            ? 'warn'
            : 'neutral';

    const pillLabel = allJoined
        ? 'Ready'
        : status.guilds.length === 0
          ? 'No servers'
          : join.state === 'joining'
            ? 'Adding streamer'
            : missing.length === status.guilds.length
              ? 'Streamer missing'
              : 'Partially ready';

    return (
        <section id="servers" className="rounded-[28px] border border-border/60 bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 px-5 py-4">
                <div>
                    <h2 className="text-base font-semibold tracking-[-0.01em] text-text">Servers</h2>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-text-muted">
                        Add the bot once. It invites the streaming account to the same servers with your saved
                        token.
                    </p>
                </div>
                <StatusPill tone={pillTone} pulse={join.state === 'joining'}>
                    {pillLabel}
                </StatusPill>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                    {invite ? (
                        <a
                            href={invite}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonStyles({ variant: 'primary' })}
                        >
                            <Plus size={14} aria-hidden="true" />
                            Add bot to a server
                        </a>
                    ) : (
                        <p className="text-xs text-text-muted">
                            Save both tokens and reconnect to generate the bot invite link.
                        </p>
                    )}
                    {invite ? (
                        <Button
                            variant="secondary"
                            icon={
                                copied === 'invite' ? (
                                    <Check size={14} aria-hidden="true" />
                                ) : (
                                    <Copy size={14} aria-hidden="true" />
                                )
                            }
                            onClick={() => void copy(invite, 'invite')}
                        >
                            {copied === 'invite' ? 'Copied' : 'Copy invite link'}
                        </Button>
                    ) : null}
                </div>

                {status.guilds.length === 0 ? (
                    <ol className="space-y-2 text-xs leading-relaxed text-text-muted">
                        {[
                            'Pick your server and approve the requested permissions.',
                            'The bot creates a one-time invite and the streaming account accepts it with your saved token.',
                            'Join a voice channel and run /stream.',
                        ].map((text, index) => (
                            <li key={text} className="flex gap-2">
                                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-medium text-text">
                                    {index + 1}
                                </span>
                                <span>{text}</span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <ul className="space-y-1 rounded-[20px] bg-bg/30 p-1">
                        {status.guilds.map((guild) => {
                            const inGuild = joined.has(guild.id);
                            return (
                                <li key={guild.id} className="flex flex-wrap items-center gap-3 rounded-[16px] px-3 py-3 transition-colors duration-200 hover:bg-raised/40">
                                    <ChannelMark name={guild.name} size="sm" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium text-text">{guild.name}</p>
                                        <p className="truncate text-[11px] text-text-faint">
                                            {inGuild
                                                ? 'The streaming account can join voice here.'
                                                : 'The streaming account is not in this server yet.'}
                                        </p>
                                    </div>
                                    <StatusPill tone={inGuild ? 'live' : 'warn'}>
                                        {inGuild ? 'Streamer joined' : 'Streamer missing'}
                                    </StatusPill>
                                    {!inGuild ? (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            loading={retrying && join.guildId === guild.id}
                                            onClick={() => onRetry(guild.id)}
                                        >
                                            Add streamer
                                        </Button>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}

                {join.state === 'joining' ? (
                    <Notice tone="info" title="Adding the streaming account">
                        {join.guildName ? `Working on ${join.guildName}. ` : ''}
                        This usually takes a few seconds. The page updates on its own.
                    </Notice>
                ) : null}

                {join.state === 'error' && join.error ? (
                    <Notice tone="danger" title="The streaming account was not added">
                        {join.error}
                    </Notice>
                ) : null}

                {status.guilds.length > 0 &&
                !allJoined &&
                join.state !== 'joining' &&
                join.state !== 'error' ? (
                    <Notice tone="warn" title="The streamer is missing in some servers">
                        Use <span className="font-medium text-text">Add streamer</span> to retry, or leave the
                        servers you do not stream in.
                    </Notice>
                ) : null}

                {join.fallbackInviteUrl ? (
                    <div className="rounded-[20px] bg-raised/60 px-4 py-3.5">
                        <p className="text-[11px] font-medium text-text">Fallback invite</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                            If Discord blocks the automatic join, open this link while logged in as the streaming
                            account. The page updates when it joins.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <a
                                href={join.fallbackInviteUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="min-w-0 flex-1 truncate text-[11px] text-blurple-text underline decoration-blurple/40 underline-offset-2"
                            >
                                {join.fallbackInviteUrl}
                            </a>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void copy(join.fallbackInviteUrl ?? '', 'fallback')}
                            >
                                {copied === 'fallback' ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

export default function DiscordPage() {
    const status = useDiscordStatus();
    const tokens = useDiscordTokens();
    const saveTokens = useSaveDiscordTokens();
    const validate = useValidateDiscord();
    const reconnect = useReconnectDiscord();
    const joinStreamer = useJoinStreamer();
    const setRoles = useSetGuildRoles();
    const toast = useToast();

    const [botToken, setBotToken] = useState('');
    const [userToken, setUserToken] = useState('');
    const [revealBot, setRevealBot] = useState(false);
    const [revealUser, setRevealUser] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);

    const guilds = status.data?.guilds ?? [];
    const tokenState = tokens.data;
    const reportError = (error: unknown) =>
        toast({
            title: 'Discord action failed',
            description: errorMessage(error),
            tone: 'error',
        });

    const submitTokens = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!botToken.trim() && !userToken.trim()) {
            setTokenError('Enter a bot token or a streamer token to save.');
            return;
        }
        setTokenError(null);
        const payload: { botToken?: string; userToken?: string } = {};
        if (botToken.trim()) payload.botToken = botToken.trim();
        if (userToken.trim()) payload.userToken = userToken.trim();
        saveTokens.mutate(payload, {
            onSuccess: () => {
                setBotToken('');
                setUserToken('');
                setRevealBot(false);
                setRevealUser(false);
                toast({ title: 'Tokens saved', tone: 'success' });
            },
            onError: (error) =>
                toast({
                    title: 'Could not save tokens',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    const validateTokens = () => {
        validate.mutate(undefined, {
            onSuccess: () => toast({ title: 'Tokens validated', description: 'Bot and streamer are online.', tone: 'success' }),
            onError: (error) =>
                toast({
                    title: 'Token validation failed',
                    description: errorMessage(error),
                    tone: 'error',
                }),
        });
    };

    const reconnectStreamer = () => {
        reconnect.mutate(undefined, {
            onSuccess: () => toast({ title: 'Discord reconnected', tone: 'success' }),
            onError: reportError,
        });
    };

    const addStreamer = (guildId?: string) => {
        joinStreamer.mutate(guildId, {
            onSuccess: (status) => {
                if (status.streamerJoin.state === 'error') {
                    toast({
                        title: 'Streamer was not added',
                        description: status.streamerJoin.error ?? 'Use the fallback invite link.',
                        tone: 'error',
                    });
                    return;
                }
                toast({
                    title: guildId ? 'Adding the streamer' : 'Adding the streamer to every server',
                    tone: 'info',
                });
            },
            onError: reportError,
        });
    };

    return (
        <>
            <PageHeader
                title="Discord"
                meta={
                    status.data
                        ? `${formatCount(guilds.length)} servers · ${status.data.bot} bot · ${status.data.streamer} streamer`
                        : 'Bot and streamer connections'
                }
                actions={
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-label="Reconnect"
                        icon={<RefreshCw size={14} aria-hidden="true" />}
                        loading={reconnect.isPending}
                        onClick={reconnectStreamer}
                    >
                        <span className="hidden sm:inline">Reconnect</span>
                    </Button>
                }
            />
            <div className="mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-5 xl:p-6">
                <Notice tone="danger" title="The streamer token is a self-bot credential">
                    Discord does not permit self-bots. Using one can get the account banned. Keep both tokens private.
                    OrbisCast stores them encrypted at rest, but a screenshot or public issue can still leak them.
                </Notice>

                {status.isPending ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface p-5" aria-hidden="true">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                    </section>
                ) : status.isError ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="Discord status could not load"
                            error={status.error}
                            onRetry={() => void status.refetch()}
                        />
                    </section>
                ) : status.data ? (
                    <ConnectionCard status={status.data} />
                ) : null}

                {status.data ? (
                    <InviteCard
                        status={status.data}
                        retrying={joinStreamer.isPending}
                        onRetry={addStreamer}
                    />
                ) : null}

                <section id="tokens" className="rounded-[28px] border border-border/60 bg-surface">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 px-5 py-4">
                        <div>
                            <h2 className="text-base font-semibold tracking-[-0.01em] text-text">Tokens</h2>
                            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                                Values are write-only. Stored tokens are shown only as a last-four hint.
                            </p>
                        </div>
                        <StatusPill tone={tokenState?.botTokenSet && tokenState?.userTokenSet ? 'blurple' : 'warn'}>
                            {tokenState?.botTokenSet && tokenState?.userTokenSet ? 'Both stored' : 'Needs tokens'}
                        </StatusPill>
                    </div>
                    <form onSubmit={submitTokens} className="space-y-4 p-4 sm:p-5">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <TokenField
                                id="bot-token"
                                label="Bot token"
                                value={botToken}
                                onChange={setBotToken}
                                reveal={revealBot}
                                onToggleReveal={() => setRevealBot((current) => !current)}
                                stored={tokenState?.botTokenSet ?? false}
                                last4={tokenState?.botLast4 ?? null}
                                placeholder="Paste the bot token"
                            />
                            <TokenField
                                id="user-token"
                                label="Streamer token"
                                value={userToken}
                                onChange={setUserToken}
                                reveal={revealUser}
                                onToggleReveal={() => setRevealUser((current) => !current)}
                                stored={tokenState?.userTokenSet ?? false}
                                last4={tokenState?.userLast4 ?? null}
                                placeholder="Paste the user token"
                            />
                        </div>
                        {tokenError ? (
                            <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                                <TriangleExclamationPoint size={13} aria-hidden="true" />
                                {tokenError}
                            </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
                            <Button type="submit" variant="primary" loading={saveTokens.isPending}>
                                Save tokens
                            </Button>
                            <Button
                                variant="secondary"
                                icon={<ShieldCheck size={14} aria-hidden="true" />}
                                loading={validate.isPending}
                                onClick={validateTokens}
                            >
                                Validate
                            </Button>
                            <span className="text-[11px] text-text-faint">
                                Validation signs in both clients without restarting the bot.
                            </span>
                        </div>
                    </form>
                </section>

                <section className="overflow-hidden rounded-[28px] border border-border/60 bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-4">
                        <div>
                            <h2 className="text-base font-semibold tracking-[-0.01em] text-text">Server access</h2>
                            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                                Choose which roles can start and stop playback in each server.
                            </p>
                        </div>
                    </div>

                    {status.isPending ? (
                        <div className="space-y-3 p-5" aria-hidden="true">
                            {[0, 1, 2].map((index) => (
                                <Skeleton key={index} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : status.isError ? (
                        <ErrorState
                            compact
                            error={status.error}
                            onRetry={() => void status.refetch()}
                        />
                    ) : guilds.length === 0 ? (
                        <EmptyState
                            icon={MessagesSquare}
                            title="The bot is not in any servers"
                            description="Add the bot to a server above. It will add the streaming account to the same server automatically."
                            action={
                                status.data?.botInviteUrl ? (
                                    <a
                                        href={status.data.botInviteUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={buttonStyles({ variant: 'primary', size: 'sm' })}
                                    >
                                        <Plus size={14} aria-hidden="true" />
                                        Add bot to a server
                                    </a>
                                ) : undefined
                            }
                        />
                    ) : (
                        guilds.map((guild, index) => (
                            <GuildAccess
                                key={guild.id}
                                guild={guild}
                                initiallyOpen={index === 0}
                                onRoleChange={(target, roleIds) =>
                                    setRoles.mutate(
                                        { guildId: target.id, roleIds },
                                        {
                                            onError: (error) =>
                                                toast({
                                                    title: 'Roles did not save',
                                                    description: errorMessage(error),
                                                    tone: 'error',
                                                }),
                                        }
                                    )
                                }
                            />
                        ))
                    )}
                </section>

                <p className="text-[11px] leading-relaxed text-text-faint">
                    The bot token powers slash commands. The streamer token joins voice and sends the video track.
                    Rotating either token requires a reconnect.
                </p>
            </div>
        </>
    );
}
