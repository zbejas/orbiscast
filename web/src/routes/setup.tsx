import { useState } from 'react';
import {
    ArrowRight,
    Film,
    KeyRound,
    MessagesSquare,
    RefreshCw,
    Rss,
    ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
    Button,
    EmptyState,
    ErrorState,
    PageHeader,
    ProgressBar,
    Skeleton,
    StatusPill,
    buttonStyles,
    type StatusTone,
} from '@/components';
import { useSetup, useSources } from '@/lib/hooks';

interface SetupStep {
    id: string;
    title: string;
    description: string;
    status: string;
    tone: StatusTone;
    icon: LucideIcon;
    to: string;
    action: string;
    required: boolean;
    complete: boolean;
}

export default function SetupPage() {
    const setup = useSetup();
    const sources = useSources();
    const [skipped, setSkipped] = useState<Set<string>>(() => new Set());

    const skip = (id: string) => {
        setSkipped((current) => new Set(current).add(id));
    };

    const restore = (id: string) => {
        setSkipped((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
        });
    };

    if (setup.isPending) {
        return (
            <>
                <PageHeader title="Setup" meta="First run" />
                <div className="mx-auto w-full max-w-[1100px] space-y-5 p-3 sm:p-5 xl:p-6">
                    <div className="rounded-[28px] border border-border/60 bg-surface p-5" aria-hidden="true">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="mt-3 h-2 w-full" />
                        <Skeleton className="mt-3 h-3 w-2/3" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
                        {[0, 1, 2, 3].map((index) => (
                            <div key={index} className="rounded-[28px] border border-border/60 bg-surface p-5">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="mt-3 h-5 w-40" />
                                <Skeleton className="mt-2 h-3 w-full" />
                                <Skeleton className="mt-4 h-8 w-28" />
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    }

    if (setup.isError || !setup.data) {
        return (
            <>
                <PageHeader title="Setup" meta="First run" />
                <div className="mx-auto w-full max-w-[1100px] p-3 sm:p-5 xl:p-6">
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="Setup status could not load"
                            error={setup.error}
                            onRetry={() => void setup.refetch()}
                        />
                    </section>
                </div>
            </>
        );
    }

    const status = setup.data;
    const sourceCount = sources.data?.length ?? 0;
    const mediaConnected = status.mediaValid;
    const discordConnected = status.discordValid && status.guildReady;
    const requiredComplete = [discordConnected, status.sourcesConfigured, mediaConnected].filter(Boolean).length;
    const requiredTotal = 3;

    const steps: SetupStep[] = [
        {
            id: 'discord',
            title: 'Connect Discord',
            description:
                'Save the bot and streamer tokens, then add the bot to your server. The streaming account joins automatically.',
            status: discordConnected
                ? 'Connected'
                : !status.discordConfigured
                  ? 'Not configured'
                  : !status.discordValid
                    ? 'Needs validation'
                    : status.botInviteUrl
                      ? 'Add to server'
                      : 'Waiting for Discord',
            tone: discordConnected
                ? 'live'
                : !status.discordConfigured
                  ? 'neutral'
                  : 'warn',
            icon: MessagesSquare,
            to: '/discord',
            action: discordConnected
                ? 'Review Discord'
                : status.discordValid
                  ? 'Add to server'
                  : 'Open Discord',
            required: true,
            complete: discordConnected,
        },
        {
            id: 'sources',
            title: 'Add a source',
            description:
                'Pair an M3U playlist with an XMLTV guide. One source is enough to fill Channels and Guide.',
            status: status.sourcesConfigured ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : 'Not configured',
            tone: status.sourcesConfigured ? 'blurple' : 'neutral',
            icon: Rss,
            to: '/iptv',
            action: status.sourcesConfigured ? 'Review sources' : 'Add a source',
            required: true,
            complete: status.sourcesConfigured,
        },
        {
            id: 'media',
            title: 'Connect a media server',
            description:
                'Add a Plex or Jellyfin server and enable the libraries you want to browse. This powers the on-demand channels.',
            status: mediaConnected
                ? 'Connected'
                : status.mediaConfigured
                  ? 'Needs attention'
                  : 'Not configured',
            tone: mediaConnected ? 'plex' : status.mediaConfigured ? 'warn' : 'neutral',
            icon: Film,
            to: '/media',
            action: mediaConnected ? 'Review media' : 'Add a media source',
            required: true,
            complete: mediaConnected,
        },
        {
            id: 'auth',
            title: 'Protect the WebUI',
            description:
                'Optional. Require a username and password before anyone can open the control surface.',
            status: status.authEnabled ? 'Enabled' : 'Optional',
            tone: status.authEnabled ? 'blurple' : 'neutral',
            icon: ShieldCheck,
            to: '/settings#auth',
            action: status.authEnabled ? 'Review auth' : 'Set up auth',
            required: false,
            complete: status.authEnabled,
        },
    ];

    const visibleSteps = steps.filter((step) => !skipped.has(step.id));
    const skippedSteps = steps.filter((step) => skipped.has(step.id));

    return (
        <>
            <PageHeader
                title="Setup"
                meta="First run checklist"
                actions={
                    <Link to="/" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                        Skip setup
                        <ArrowRight size={13} aria-hidden="true" />
                    </Link>
                }
            />
            <div className="mx-auto w-full max-w-[1100px] space-y-5 p-3 sm:p-5 xl:p-6">
                <section className="rounded-[28px] border border-border/60 bg-surface p-5 sm:p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                        <div className="max-w-2xl">
                            <h2 className="text-[clamp(1.45rem,1.1rem+1.2vw,2rem)] font-semibold leading-tight tracking-[-0.02em] text-text">
                                Finish configuration without editing files
                            </h2>
                            <p className="mt-2 text-sm leading-relaxed text-text-muted">
                                Every step is also available later in the sidebar. A required step can be skipped
                                for now, but the WebUI will not have complete data until it is done.
                            </p>
                        </div>
                        <div className="w-full shrink-0 rounded-[20px] bg-bg/30 p-4 sm:w-64">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-3xl font-semibold tabular-nums text-text">
                                    {requiredComplete}
                                    <span className="text-sm font-normal text-text-muted"> / {requiredTotal}</span>
                                </span>
                                <span className="text-[11px] text-text-muted">required steps</span>
                            </div>
                            <ProgressBar
                                value={requiredComplete}
                                max={requiredTotal}
                                label="Required setup completion"
                                className="mt-2.5"
                            />
                            <p className="mt-2 text-[11px] text-text-muted">
                                Auth is optional. {status.authEnabled ? 'It is enabled.' : 'It is off.'}
                            </p>
                        </div>
                    </div>
                </section>

                {visibleSteps.length === 0 ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <EmptyState
                            icon={RefreshCw}
                            title="Every step is out of the way"
                            description="Restore a step if you want to review it, or head to the dashboard and start using OrbisCast."
                            action={
                                <>
                                    <Button variant="secondary" onClick={() => setSkipped(new Set())}>
                                        Restore all
                                    </Button>
                                    <Link to="/" className={buttonStyles({ variant: 'primary' })}>
                                        Open dashboard
                                    </Link>
                                </>
                            }
                        />
                    </section>
                ) : (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        {visibleSteps.map((step) => {
                            const Icon = step.icon;
                            return (
                                <article
                                    key={step.id}
                                    className="flex flex-col rounded-[28px] border border-border/60 bg-surface p-5"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span
                                            className={
                                                step.tone === 'plex'
                                                    ? 'grid size-11 place-items-center rounded-[16px] bg-plex/10 text-plex'
                                                    : step.tone === 'live'
                                                      ? 'grid size-11 place-items-center rounded-[16px] bg-live/10 text-live'
                                                      : step.tone === 'warn'
                                                        ? 'grid size-11 place-items-center rounded-[16px] bg-warn/10 text-warn'
                                                        : 'grid size-11 place-items-center rounded-[16px] bg-raised/60 text-text-faint'
                                            }
                                        >
                                            <Icon size={20} aria-hidden="true" />
                                        </span>
                                        <StatusPill tone={step.tone}>{step.status}</StatusPill>
                                    </div>
                                    <h2 className="mt-4 text-base font-semibold tracking-[-0.01em] text-text">{step.title}</h2>
                                    <p className="mt-1.5 flex-1 text-xs leading-relaxed text-text-muted">
                                        {step.description}
                                    </p>
                                    <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/50 pt-4">
                                        <Link
                                            to={step.to}
                                            className={buttonStyles({
                                                variant: step.complete ? 'secondary' : 'primary',
                                                size: 'sm',
                                            })}
                                        >
                                            {step.action}
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => skip(step.id)}
                                            className="oc-control inline-flex min-h-9 items-center rounded-full px-3 text-xs font-medium text-text-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-text"
                                        >
                                            Skip
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

                {skippedSteps.length > 0 ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-5 py-3.5">
                            <h2 className="text-sm font-semibold text-text">Skipped steps</h2>
                            <button
                                type="button"
                                onClick={() => setSkipped(new Set())}
                                className="inline-flex min-h-9 items-center rounded-full px-2 text-[11px] font-medium text-blurple-text transition-colors duration-200 hover:bg-blurple/10 hover:text-[#a5acff]"
                            >
                                Restore all
                            </button>
                        </div>
                        <ul className="divide-y divide-border/50">
                            {skippedSteps.map((step) => (
                                <li key={step.id} className="flex items-center gap-2 px-5 py-3">
                                    <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                                        {step.title}
                                    </span>
                                    <StatusPill tone="neutral" dot={false}>
                                        Skipped
                                    </StatusPill>
                                    <button
                                        type="button"
                                        onClick={() => restore(step.id)}
                                        className="inline-flex min-h-9 items-center rounded-full px-2 text-[11px] font-medium text-blurple-text transition-colors duration-200 hover:bg-blurple/10 hover:text-[#a5acff]"
                                    >
                                        Restore
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}

                {requiredComplete === requiredTotal ? (
                    <section className="rounded-[28px] border border-blurple/25 bg-blurple/[0.06] px-5 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <ShieldCheck size={18} aria-hidden="true" className="text-blurple-text" />
                            <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                                <span className="font-medium text-text">All required steps are configured.</span>{' '}
                                The dashboard will show live state as soon as the bot and the media server respond.
                            </p>
                            <Link to="/" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
                                Open dashboard
                            </Link>
                        </div>
                    </section>
                ) : null}

                <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
                    <KeyRound size={12} aria-hidden="true" />
                    Skipping a step does not change any configuration. You can return at any time.
                </p>
            </div>
        </>
    );
}
