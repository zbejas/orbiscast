import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    ArrowRight,
    Film,
    LayoutDashboard,
    LogOut,
    MessagesSquare,
    Radio,
    Rss,
    ScrollText,
    Settings,
    Tv,
    X,
    type LucideIcon,
} from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { PlaybackStateDto } from '@shared/types';
import { cn } from '@/lib/cn';
import { useAuthConfig, useDiscordStatus, useLogout, usePlayback, useSession } from '@/lib/hooks';
import { useAppEvents } from '@/lib/sse';
import { OrbitalGlyph, Wordmark } from './brand';
import { IconButton } from './button';
import { ChannelMark, Poster } from './poster';
import { ShellContext } from './shell-context';

interface NavItem {
    to: string;
    label: string;
    icon: LucideIcon;
    end?: boolean;
}

interface NavGroup {
    id: string;
    label: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        id: 'watch',
        label: 'Watch',
        items: [
            { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
            { to: '/media', label: 'Media', icon: Film },
            { to: '/channels', label: 'Channels', icon: Tv },
            { to: '/iptv', label: 'IPTV', icon: Rss },
        ],
    },
    {
        id: 'system',
        label: 'System',
        items: [
            { to: '/discord', label: 'Discord', icon: MessagesSquare },
            { to: '/logs', label: 'Logs', icon: ScrollText },
            { to: '/settings', label: 'Settings', icon: Settings },
        ],
    },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
    return cn(
        'oc-nav-link group relative flex h-12 items-center justify-center gap-3 rounded-full px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-out lg:justify-start lg:px-4',
        isActive
            ? 'bg-primary-container text-on-primary-container'
            : 'text-text-muted hover:bg-white/[0.05] hover:text-text'
    );
}

function NavGroupLinks({
    group,
    onNavigate,
    showLabel = false,
}: {
    group: NavGroup;
    onNavigate?: () => void;
    showLabel?: boolean;
}) {
    const labelId = useId();
    return (
        <div role="group" aria-labelledby={labelId} className="min-w-0">
            <p
                id={labelId}
                className={cn(
                    'px-4 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-text-faint',
                    showLabel ? 'block' : 'sr-only lg:not-sr-only'
                )}
            >
                {group.label}
            </p>
            <ul className="space-y-1">
                {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                        <li key={item.to}>
                            <NavLink
                                to={item.to}
                                end={item.end}
                                aria-label={item.label}
                                title={item.label}
                                className={navLinkClass}
                                onClick={onNavigate}
                            >
                                {({ isActive }) => (
                                    <>
                                        <Icon
                                            size={20}
                                            strokeWidth={isActive ? 2.2 : 1.8}
                                            aria-hidden="true"
                                            className={cn(
                                                'shrink-0 transition-colors duration-200',
                                                isActive
                                                    ? 'text-on-primary-container'
                                                    : 'text-text-faint group-hover:text-text-muted'
                                            )}
                                        />
                                        <span
                                            className={cn(
                                                'min-w-0 truncate',
                                                showLabel ? 'block' : 'hidden lg:block'
                                            )}
                                        >
                                            {item.label}
                                        </span>
                                    </>
                                )}
                            </NavLink>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
        <div className="space-y-2">
            {NAV_GROUPS.map((group) => (
                <NavGroupLinks key={group.id} group={group} onNavigate={onNavigate} />
            ))}
        </div>
    );
}

function StreamerStatusLink({ showLabel = false }: { showLabel?: boolean }) {
    const status = useDiscordStatus();
    const state = status.isPending ? 'connecting' : (status.data?.streamer ?? 'offline');
    const tone =
        state === 'online'
            ? 'bg-live'
            : state === 'connecting'
              ? 'bg-warn'
              : state === 'error'
                ? 'bg-danger'
                : 'bg-text-muted';
    const label =
        state === 'online'
            ? 'Streamer online'
            : state === 'connecting'
              ? 'Streamer connecting'
              : state === 'error'
                ? 'Streamer error'
                : 'Streamer offline';

    return (
        <Link
            to="/discord"
            aria-label={`${label}. Open Discord settings.`}
            title={label}
            className="flex min-h-11 items-center justify-center gap-2.5 rounded-full px-2 py-2 text-text-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-text lg:justify-start lg:px-3"
        >
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tone)} />
            <span className={cn('min-w-0', showLabel ? 'block' : 'hidden lg:block')}>
                <span className="block text-[11px] font-medium text-text-muted">Streamer</span>
                <span className="block truncate text-xs capitalize text-text">{state}</span>
            </span>
        </Link>
    );
}

function SessionActions({ showLabel = false }: { showLabel?: boolean }) {
    const session = useSession();
    const logout = useLogout();
    const navigate = useNavigate();

    if (!session.data?.user) return null;

    const signOut = () => {
        logout.mutate(undefined, {
            onSuccess: () => navigate('/login', { replace: true }),
        });
    };

    return (
        <div
            className={cn(
                'mt-1 flex min-h-11 items-center justify-center gap-1 rounded-full border-t border-border/60 pt-1.5 lg:justify-start',
                showLabel && 'justify-start'
            )}
        >
            <span
                className={cn(
                    'min-w-0 flex-1 truncate px-2 text-[11px] text-text-muted',
                    showLabel ? 'block' : 'hidden lg:block'
                )}
            >
                {session.data.user.name}
            </span>
            <IconButton
                label={`Sign out ${session.data.user.name}`}
                title="Sign out"
                size="sm"
                disabled={logout.isPending}
                onClick={signOut}
                className="shrink-0 rounded-full"
            >
                <LogOut size={15} aria-hidden="true" />
            </IconButton>
        </div>
    );
}

function playbackTone(state: PlaybackStateDto): {
    label: string;
    dot: string;
    text: string;
} {
    if (state.mode === 'iptv') {
        return { label: 'IPTV live', dot: 'bg-live', text: 'text-live' };
    }
    if (state.mode === 'media') {
        return state.paused
            ? { label: 'Paused', dot: 'bg-warn', text: 'text-warn' }
            : { label: 'On demand', dot: 'bg-plex', text: 'text-plex' };
    }
    return { label: 'Placeholder', dot: 'bg-plex', text: 'text-plex' };
}

function PlaybackThumb({ state }: { state: PlaybackStateDto }) {
    if (state.mode === 'iptv') {
        return (
            <span className="grid h-full w-full place-items-center bg-live/10">
                <ChannelMark name={state.title ?? 'Live'} size="sm" />
            </span>
        );
    }
    if (state.mode === 'media' && state.posterUrl) {
        return (
            <Poster
                title={state.title ?? 'On demand'}
                seed={state.title ?? 'media'}
                src={state.posterUrl}
                showTitle={false}
                className="h-full w-full"
            />
        );
    }
    if (state.mode === 'media') {
        return (
            <span className="grid h-full w-full place-items-center bg-plex/10 text-plex">
                <Film size={16} aria-hidden="true" />
            </span>
        );
    }
    return (
        <span className="grid h-full w-full place-items-center bg-plex/10 text-plex">
            <Radio size={16} aria-hidden="true" />
        </span>
    );
}

function playbackActionLabel(state: PlaybackStateDto): string {
    return `${playbackTone(state).label}: ${state.title ?? 'Playback'}. Open Dashboard playback controls.`;
}

function PlaybackMiniRail({ state }: { state: PlaybackStateDto }) {
    const tone = playbackTone(state);
    return (
        <Link
            to="/"
            aria-label={playbackActionLabel(state)}
            title={playbackActionLabel(state)}
            className="group mx-auto flex h-12 w-12 items-center justify-center rounded-[16px] bg-raised/40 transition-colors duration-200 hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple/70"
        >
            <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-border/60">
                <PlaybackThumb state={state} />
                <span
                    aria-hidden="true"
                    className={cn('absolute right-0.5 top-0.5 size-2 rounded-full ring-2 ring-surface', tone.dot)}
                />
            </span>
        </Link>
    );
}

function PlaybackMiniCard({ state }: { state: PlaybackStateDto }) {
    const tone = playbackTone(state);
    const detail = state.voiceChannelName ?? state.guildName ?? state.sourceName ?? 'Discord';
    return (
        <Link
            to="/"
            aria-label={playbackActionLabel(state)}
            className="group flex min-h-14 items-center gap-2.5 rounded-[20px] bg-raised/40 p-2 transition-colors duration-200 hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple/70"
        >
            <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-xl border border-border/60">
                <PlaybackThumb state={state} />
            </span>
            <span className="min-w-0 flex-1">
                <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', tone.text)}>
                    <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
                    {tone.label}
                </span>
                <span className="block truncate text-xs font-medium text-text">
                    {state.title ?? 'Playback'}
                </span>
                <span className="block truncate text-[11px] text-text-muted">{detail}</span>
            </span>
            <ArrowRight
                size={14}
                aria-hidden="true"
                className="shrink-0 text-text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-text-muted motion-reduce:transform-none"
            />
        </Link>
    );
}

function MobileNowPlaying({ state }: { state: PlaybackStateDto }) {
    const tone = playbackTone(state);
    const detail = state.voiceChannelName ?? state.guildName ?? state.sourceName ?? 'Discord';
    return (
        <div className="fixed inset-x-0 bottom-0 z-40 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
            <Link
                to="/"
                aria-label={playbackActionLabel(state)}
                className="flex min-h-16 items-center gap-3 rounded-[24px] border border-border/60 bg-surface-container-high p-2.5 shadow-e3 transition-colors duration-200 hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blurple/70"
            >
                <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-xl border border-border/60">
                    <PlaybackThumb state={state} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', tone.text)}>
                        <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
                        {tone.label}
                    </span>
                    <span className="block truncate text-sm font-medium text-text">
                        {state.title ?? 'Playback'}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">{detail}</span>
                </span>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-blurple/15 text-blurple-text">
                    <ArrowRight size={17} aria-hidden="true" />
                </span>
            </Link>
        </div>
    );
}

function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open) {
            if (!dialog.open) {
                dialog.showModal();
                window.requestAnimationFrame(() =>
                    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
                );
            }
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        const handleClose = () => onCloseRef.current();
        dialog.addEventListener('close', handleClose);
        return () => dialog.removeEventListener('close', handleClose);
    }, []);

    return (
        <dialog
            ref={ref}
            className="oc-drawer"
            aria-label="Navigation"
            onClick={(event) => {
                if (event.target === ref.current) ref.current?.close();
            }}
        >
            <div className="oc-drawer-sheet flex flex-col overscroll-contain rounded-r-[28px] bg-surface [animation-duration:320ms] motion-reduce:animate-none">
                <div className="flex h-16 items-center justify-between gap-3 border-b border-border/60 px-4">
                    <Link to="/" aria-label="OrbisCast dashboard" onClick={onClose}>
                        <Wordmark className="text-text" />
                    </Link>
                    <IconButton
                        label="Close navigation"
                        data-autofocus="true"
                        onClick={() => ref.current?.close()}
                        className="rounded-full"
                    >
                        <X size={18} aria-hidden="true" />
                    </IconButton>
                </div>
                <nav aria-label="Primary mobile" className="min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="space-y-3">
                        {NAV_GROUPS.map((group) => (
                            <NavGroupLinks
                                key={group.id}
                                group={group}
                                onNavigate={onClose}
                                showLabel
                            />
                        ))}
                    </div>
                </nav>
                <div className="border-t border-border/60 p-3">
                    <StreamerStatusLink showLabel />
                    <SessionActions showLabel />
                </div>
            </div>
        </dialog>
    );
}

function SessionCheck() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-bg px-6 text-text" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
                <OrbitalGlyph size={26} className="text-blurple-text" />
                <span className="text-sm text-text-muted">Checking session</span>
            </div>
        </div>
    );
}

export function AppShell() {
    const authConfig = useAuthConfig();
    const session = useSession();
    const location = useLocation();
    const from = `${location.pathname}${location.search}${location.hash}`;

    if (authConfig.isPending || (authConfig.data?.enabled && session.isPending)) {
        return <SessionCheck />;
    }

    if (authConfig.data?.enabled && !session.data?.user) {
        return <Navigate to="/login" replace state={{ from }} />;
    }

    return <AppShellFrame />;
}

function AppShellFrame() {
    const [navOpen, setNavOpen] = useState(false);
    const location = useLocation();
    const mainRef = useRef<HTMLElement>(null);
    const firstRender = useRef(true);
    const openNav = useCallback(() => setNavOpen(true), []);
    const playback = usePlayback();
    const activePlayback =
        playback.data && playback.data.mode !== 'idle' ? playback.data : null;
    useAppEvents();

    useEffect(() => {
        setNavOpen(false);
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        mainRef.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, [location.pathname]);

    useEffect(() => {
        const root = document.documentElement;
        const mobile = window.matchMedia('(max-width: 767px)');
        const sync = () => {
            root.style.scrollPaddingBottom =
                activePlayback && mobile.matches
                    ? 'calc(6.5rem + env(safe-area-inset-bottom, 0px))'
                    : '';
        };
        sync();
        mobile.addEventListener('change', sync);
        return () => {
            mobile.removeEventListener('change', sync);
            root.style.scrollPaddingBottom = '';
        };
    }, [activePlayback]);

    return (
        <ShellContext.Provider value={{ openNav }}>
            <div className="flex min-h-dvh bg-bg text-text">
                <a href="#main" className="skip-link">
                    Skip to content
                </a>

                <aside className="hidden shrink-0 border-r border-border/60 bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-20 md:flex-col lg:w-60">
                    <Link
                        to="/"
                        aria-label="OrbisCast dashboard"
                        className="flex h-16 items-center justify-center border-b border-border/60 px-3 lg:justify-start lg:px-5"
                    >
                        <span className="lg:hidden">
                            <span className="grid size-10 place-items-center rounded-2xl bg-blurple/10">
                                <OrbitalGlyph size={25} className="text-blurple-text" />
                            </span>
                        </span>
                        <span className="hidden lg:block">
                            <Wordmark className="text-text" />
                        </span>
                    </Link>
                    <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto p-2 lg:p-3">
                        <NavLinks />
                    </nav>
                    <div className="border-t border-border/60 p-2 lg:p-3">
                        {activePlayback ? (
                            <>
                                <div className="mb-2 lg:hidden">
                                    <PlaybackMiniRail state={activePlayback} />
                                </div>
                                <div className="mb-2 hidden lg:block">
                                    <PlaybackMiniCard state={activePlayback} />
                                </div>
                            </>
                        ) : null}
                        <StreamerStatusLink />
                        <SessionActions />
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                    <main
                        id="main"
                        ref={mainRef}
                        tabIndex={-1}
                        className={cn(
                            'min-w-0 flex-1 focus-visible:outline-none',
                            activePlayback &&
                                'pb-[calc(6rem_+_env(safe-area-inset-bottom,0px))] md:pb-0'
                        )}
                    >
                        <Outlet />
                    </main>
                </div>

                <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
                {activePlayback ? <MobileNowPlaying state={activePlayback} /> : null}
            </div>
        </ShellContext.Provider>
    );
}
