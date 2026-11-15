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
                <div className="oc-page-enter mx-auto w-full max-w-[1100px] space-y-4 p-3 sm:p-5 xl:p-6">
                    <div className="rounded-xl border border-border bg-surface p-5" aria-hidden="true">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="mt-3 h-2 w-full" />
                        <Skeleton className="mt-3 h-3 w-2/3" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
                        {[0, 1, 2, 3].map((index) => (
                            <div key={index} className="rounded-xl border border-border bg-surface p-4">
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
                <div className="oc-page-enter mx-auto w-full max-w-[1100px] p-3 sm:p-5 xl:p-6">
                    <section className="rounded-xl border border-border bg-surface">
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
    const plexConnected = status.plexValid;
    const discordConnected = status.discordValid;
    const requiredComplete = [discordConnected, status.sourcesConfigured, plexConnected].filter(Boolean).length;
    const requiredTotal = 3;

    const steps: SetupStep[] = [
        {
            id: 'discord',
            title: 'Connect Discord',
            description:
                'Add the bot token and the streamer token, validate both, and reconnect the streamer to voice.',
            status: discordConnected
                ? 'Connected'
                : status.discordConfigured
                  ? 'Needs validation'
                  : 'Not configured',
            tone: discordConnected ? 'live' : status.discordConfigured ? 'warn' : 'neutral',
            icon: MessagesSquare,
            to: '/discord',
            action: discordConnected ? 'Review Discord' : 'Open Discord',
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
            to: '/sources',
            action: status.sourcesConfigured ? 'Review sources' : 'Add a source',
            required: true,
            complete: status.sourcesConfigured,
        },
        {
            id: 'plex',
            title: 'Connect Plex',
            description:
                'Point OrbisCast at the Plex server and confirm that the library is reachable. This powers the on-demand channel.',
            status: plexConnected
                ? 'Connected'
                : status.plexConfigured
                  ? 'Needs attention'
                  : 'Not configured',
            tone: plexConnected ? 'plex' : status.plexConfigured ? 'warn' : 'neutral',
            icon: Film,
            to: '/settings#plex-connection',
            action: plexConnected ? 'Review Plex' : 'Configure Plex',
            required: true,
            complete: plexConnected,
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
            <div className="oc-page-enter mx-auto w-full max-w-[1100px] space-y-4 p-3 sm:p-5 xl:p-6">
                <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="max-w-2xl">
                            <h2 className="text-[clamp(1.25rem,1.05rem+0.9vw,1.6rem)] font-semibold tracking-[-0.015em] text-text">
                                Finish configuration without editing files
                            </h2>
                            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                                Every step is also available later in the sidebar. A required step can be skipped
                                for now, but the WebUI will not have complete data until it is done.
                            </p>
                        </div>
                        <div className="w-full shrink-0 sm:w-56">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-2xl font-semibold tabular-nums text-text">
                                    {requiredComplete}
                                    <span className="text-sm font-normal text-text-muted"> / {requiredTotal}</span>
                                </span>
                                <span className="text-[11px] text-text-muted">required steps</span>
                            </div>
                            <ProgressBar
                                value={requiredComplete}
                                max={requiredTotal}
                                label="Required setup completion"
                                className="mt-2"
                            />
                            <p className="mt-1.5 text-[11px] text-text-muted">
                                Auth is optional. {status.authEnabled ? 'It is enabled.' : 'It is off.'}
                            </p>
                        </div>
                    </div>
                </section>

                {visibleSteps.length === 0 ? (
                    <section className="rounded-xl border border-border bg-surface">
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
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {visibleSteps.map((step) => {
                            const Icon = step.icon;
                            return (
                                <article
                                    key={step.id}
                                    className="flex flex-col rounded-xl border border-border bg-surface p-4"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <Icon
                                            size={20}
                                            aria-hidden="true"
                                            className={
                                                step.tone === 'plex'
                                                    ? 'text-plex'
                                                    : step.tone === 'live'
                                                      ? 'text-live'
                                                      : step.tone === 'warn'
                                                        ? 'text-warn'
                                                        : 'text-text-faint'
                                            }
                                        />
                                        <StatusPill tone={step.tone}>{step.status}</StatusPill>
                                    </div>
                                    <h2 className="mt-3 text-sm font-semibold text-text">{step.title}</h2>
                                    <p className="mt-1.5 flex-1 text-xs leading-relaxed text-text-muted">
                                        {step.description}
                                    </p>
                                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
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
                                            className="oc-control inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-text-muted hover:bg-white/5 hover:text-text"
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
                    <section className="rounded-xl border border-border bg-surface">
                        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                            <h2 className="text-xs font-semibold text-text">Skipped steps</h2>
                            <button
                                type="button"
                                onClick={() => setSkipped(new Set())}
                                className="rounded text-[11px] font-medium text-blurple-text hover:text-[#a5acff]"
                            >
                                Restore all
                            </button>
                        </div>
                        <ul className="divide-y divide-border">
                            {skippedSteps.map((step) => (
                                <li key={step.id} className="flex items-center gap-2 px-4 py-2.5">
                                    <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                                        {step.title}
                                    </span>
                                    <StatusPill tone="neutral" dot={false}>
                                        Skipped
                                    </StatusPill>
                                    <button
                                        type="button"
                                        onClick={() => restore(step.id)}
                                        className="rounded px-1.5 py-1 text-[11px] font-medium text-blurple-text hover:text-[#a5acff]"
                                    >
                                        Restore
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}

                {requiredComplete === requiredTotal ? (
                    <section className="rounded-xl border border-blurple/25 bg-blurple/[0.05] px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <ShieldCheck size={18} aria-hidden="true" className="text-blurple-text" />
                            <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                                <span className="font-medium text-text">All required steps are configured.</span>{' '}
                                The dashboard will show live state as soon as the bot and Plex respond.
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
