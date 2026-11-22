import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Info, Menu, RefreshCw, TriangleExclamationPoint } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { usePageTitle, usePlayback } from '@/lib/hooks';
import { clamp } from '@/lib/format';
import { Button, IconButton } from './button';
import { useShell } from './shell-context';

export type StatusTone = 'neutral' | 'live' | 'plex' | 'danger' | 'warn' | 'blurple';

const PILL_TONES: Record<StatusTone, string> = {
    neutral: 'border-outline-variant bg-surface-container-high text-text-muted',
    live: 'border-live/30 bg-live/12 text-live',
    plex: 'border-plex/30 bg-plex/12 text-plex',
    danger: 'border-danger/30 bg-danger/12 text-danger',
    warn: 'border-warn/30 bg-warn/12 text-warn',
    blurple: 'border-blurple/40 bg-primary-container text-on-primary-container',
};

const DOT_TONES: Record<StatusTone, string> = {
    neutral: 'bg-text-muted',
    live: 'bg-live',
    plex: 'bg-plex',
    danger: 'bg-danger',
    warn: 'bg-warn',
    blurple: 'bg-blurple',
};

interface StatusPillProps {
    tone?: StatusTone;
    children: ReactNode;
    dot?: boolean;
    pulse?: boolean;
    className?: string;
}

/**
 * Material 3 assist chip. The label always carries the status, so color is
 * reinforcement rather than the only signal.
 */
export function StatusPill({
    tone = 'neutral',
    children,
    dot = true,
    pulse = false,
    className,
}: StatusPillProps) {
    return (
        <span
            className={cn(
                'oc-chip oc-type-label inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3',
                PILL_TONES[tone],
                className
            )}
        >
            {dot ? (
                <span
                    aria-hidden="true"
                    className={cn('size-2 shrink-0 rounded-full', DOT_TONES[tone], pulse && 'oc-live-dot')}
                />
            ) : null}
            {children}
        </span>
    );
}

function LiveStatusPill() {
    const playback = usePlayback();
    const meta = (() => {
        if (playback.isPending) return { label: 'Checking', tone: 'neutral' as const, pulse: false };
        if (playback.isError || !playback.data) return { label: 'Status unknown', tone: 'neutral' as const, pulse: false };
        const state = playback.data;
        if (state.mode === 'iptv') return { label: 'Live IPTV', tone: 'live' as const, pulse: true };
        if (state.mode === 'media') {
            return state.paused
                ? { label: 'On demand paused', tone: 'plex' as const, pulse: false }
                : { label: state.sourceName ?? 'On demand', tone: 'plex' as const, pulse: true };
        }
        if (state.mode === 'placeholder') return { label: 'Placeholder', tone: 'plex' as const, pulse: false };
        return { label: 'Idle', tone: 'neutral' as const, pulse: false };
    })();

    return (
        <Link
            to="/"
            aria-label={`Playback status: ${meta.label}. Open the dashboard.`}
            className="rounded-full focus-visible:outline-offset-4"
        >
            <StatusPill tone={meta.tone} pulse={meta.pulse}>
                {meta.label}
            </StatusPill>
        </Link>
    );
}

interface PageHeaderProps {
    title: string;
    meta?: string;
    actions?: ReactNode;
}

/**
 * Top app bar. Desktop keeps a single 64px row. When the page actions cannot
 * fit beside the title, they wrap once as a group and scroll internally rather
 * than squeezing the h1. The title never truncates and the live chip stays pinned.
 */
export function PageHeader({ title, meta, actions }: PageHeaderProps) {
    const { openNav } = useShell();
    usePageTitle(title);
    const hasActions = actions !== undefined && actions !== null && actions !== false;

    return (
        <header className="oc-app-bar sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-2 gap-y-2 px-2 py-2 md:gap-x-3 md:px-6">
            <div className="flex min-w-0 max-w-full flex-none items-center gap-2 md:gap-2.5">
                <IconButton
                    label="Open navigation"
                    onClick={openNav}
                    className="-ml-1 shrink-0 md:hidden"
                >
                    <Menu size={19} aria-hidden="true" />
                </IconButton>
                <h1 className="oc-type-title shrink-0 whitespace-nowrap text-text">{title}</h1>
                {meta ? (
                    <p className="oc-type-meta hidden min-w-0 truncate text-text-muted lg:block">{meta}</p>
                ) : null}
            </div>
            {hasActions ? (
                <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5 md:gap-2">
                    <div className="oc-app-bar-actions flex min-w-0 items-center gap-1 overflow-x-auto md:gap-2">
                        {actions}
                    </div>
                    <div className="shrink-0">
                        <LiveStatusPill />
                    </div>
                </div>
            ) : (
                <div className="ml-auto shrink-0">
                    <LiveStatusPill />
                </div>
            )}
        </header>
    );
}

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    compact?: boolean;
    className?: string;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    compact = false,
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center text-center',
                compact ? 'px-4 py-8' : 'px-5 py-12',
                className
            )}
        >
            {Icon ? (
                <span className="oc-icon-well mb-4" aria-hidden="true">
                    <Icon size={24} />
                </span>
            ) : null}
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
            {description ? (
                <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">{description}</p>
            ) : null}
            {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
        </div>
    );
}

interface ErrorStateProps {
    title?: string;
    message?: string;
    error?: unknown;
    onRetry?: () => void;
    compact?: boolean;
}

export function ErrorState({
    title = 'This section could not load',
    message,
    error,
    onRetry,
    compact = false,
}: ErrorStateProps) {
    const detail =
        message ?? (error instanceof Error && error.message ? error.message : 'Check the server and try again.');
    return (
        <div
            role="alert"
            className={cn(
                'flex flex-col items-center justify-center text-center',
                compact ? 'px-4 py-8' : 'px-5 py-12'
            )}
        >
            <span className="oc-icon-well oc-icon-well-danger mb-4" aria-hidden="true">
                <TriangleExclamationPoint size={24} />
            </span>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">{detail}</p>
            {onRetry ? (
                <Button
                    variant="secondary"
                    size="sm"
                    className="mt-5"
                    icon={<RefreshCw size={14} aria-hidden="true" />}
                    onClick={onRetry}
                >
                    Try again
                </Button>
            ) : null}
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden="true" className={cn('oc-skeleton rounded-md', className)} />;
}

interface ProgressBarProps {
    value: number;
    max?: number;
    tone?: 'blurple' | 'plex';
    label: string;
    indeterminate?: boolean;
    className?: string;
}

export function ProgressBar({
    value,
    max = 1,
    tone = 'blurple',
    label,
    indeterminate = false,
    className,
}: ProgressBarProps) {
    const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : Math.round(ratio * 100)}
            className={cn('h-1 w-full overflow-hidden rounded-full bg-text/10', className)}
        >
            <div
                className={cn(
                    'h-full rounded-full transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                    tone === 'plex' ? 'bg-plex' : 'bg-blurple',
                    indeterminate && 'oc-progress-indeterminate'
                )}
                style={indeterminate ? undefined : { width: `${ratio * 100}%` }}
            />
        </div>
    );
}

type NoticeTone = 'info' | 'warn' | 'danger' | 'plex';

const NOTICE_TONES: Record<NoticeTone, string> = {
    info: 'border-blurple/35 bg-blurple/10 text-blurple-text',
    warn: 'border-warn/35 bg-warn/10 text-warn',
    danger: 'border-danger/35 bg-danger/10 text-danger',
    plex: 'border-plex/35 bg-plex/10 text-plex',
};

interface NoticeProps {
    tone?: NoticeTone;
    title?: string;
    children: ReactNode;
    action?: ReactNode;
    icon?: LucideIcon;
    className?: string;
}

export function Notice({ tone = 'info', title, children, action, icon, className }: NoticeProps) {
    const Icon = icon ?? (tone === 'info' || tone === 'plex' ? Info : TriangleExclamationPoint);
    return (
        <div
            role={tone === 'danger' ? 'alert' : 'status'}
            className={cn('flex items-start gap-3 rounded-lg border p-3.5', NOTICE_TONES[tone], className)}
        >
            <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
                {title ? <p className="text-sm font-medium leading-5">{title}</p> : null}
                <div className={cn('text-xs leading-relaxed', title && 'mt-1', 'text-text-muted')}>
                    {children}
                </div>
                {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
            </div>
        </div>
    );
}

interface QueryStateProps<T> {
    query: Pick<UseQueryResult<T>, 'isPending' | 'isError' | 'error' | 'data' | 'refetch'>;
    skeleton: ReactNode;
    children: (data: T) => ReactNode;
    isEmpty?: (data: T) => boolean;
    empty?: ReactNode;
    errorTitle?: string;
}

export function QueryState<T>({
    query,
    skeleton,
    children,
    isEmpty,
    empty,
    errorTitle,
}: QueryStateProps<T>) {
    if (query.isPending) return <>{skeleton}</>;
    if (query.isError) {
        return <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />;
    }
    if (query.data === undefined) return <>{skeleton}</>;
    if (isEmpty?.(query.data) && empty !== undefined) return <>{empty}</>;
    return <>{children(query.data)}</>;
}
