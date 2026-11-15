import { useCallback, useEffect, useRef, useState } from 'react';
import {
    CalendarDays,
    Film,
    LayoutDashboard,
    LogOut,
    MessagesSquare,
    Rss,
    ScrollText,
    Settings,
    Tv,
    X,
    type LucideIcon,
} from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { cn } from '@/lib/cn';
import { useAuthConfig, useDiscordStatus, useLogout, useSession } from '@/lib/hooks';
import { useAppEvents } from '@/lib/sse';
import { OrbitalGlyph, Wordmark } from './brand';
import { IconButton } from './button';
import { ShellContext } from './shell-context';

interface NavItem {
    to: string;
    label: string;
    icon: LucideIcon;
    end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/channels', label: 'Channels', icon: Tv },
    { to: '/guide', label: 'Guide', icon: CalendarDays },
    { to: '/plex', label: 'Plex', icon: Film },
    { to: '/sources', label: 'Sources', icon: Rss },
    { to: '/discord', label: 'Discord', icon: MessagesSquare },
    { to: '/logs', label: 'Logs', icon: ScrollText },
    { to: '/settings', label: 'Settings', icon: Settings },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
    return cn(
        'oc-nav-link group flex h-10 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors lg:justify-start',
        isActive
            ? 'bg-raised text-text'
            : 'text-text-muted hover:bg-white/[0.04] hover:text-text'
    );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
        <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
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
                                        size={18}
                                        strokeWidth={1.8}
                                        aria-hidden="true"
                                        className={cn(
                                            'shrink-0 transition-colors',
                                            isActive
                                                ? 'text-blurple-text'
                                                : 'text-text-faint group-hover:text-text-muted'
                                        )}
                                    />
                                    <span className="hidden lg:block">{item.label}</span>
                                    {isActive ? (
                                        <span
                                            aria-hidden="true"
                                            className="ml-auto hidden size-1.5 rounded-full bg-blurple lg:block"
                                        />
                                    ) : null}
                                </>
                            )}
                        </NavLink>
                    </li>
                );
            })}
        </ul>
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
            className="flex items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text lg:justify-start"
        >
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tone)} />
            <span className={cn('min-w-0', showLabel ? 'block' : 'hidden lg:block')}>
                <span className="block text-[11px] uppercase tracking-[0.08em] text-text-muted">Streamer</span>
                <span className="block truncate text-xs text-text">{state}</span>
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
                'mt-1 flex items-center justify-center gap-1 border-t border-border/70 pt-1.5 lg:justify-start',
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
                className="shrink-0"
            >
                <LogOut size={15} aria-hidden="true" />
            </IconButton>
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
            if (!dialog.open) dialog.showModal();
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
            <div className="oc-drawer-sheet flex flex-col">
                <div className="flex h-16 items-center justify-between gap-3 border-b border-border px-4">
                    <Link to="/" aria-label="OrbisCast dashboard" onClick={onClose}>
                        <Wordmark className="text-text" />
                    </Link>
                    <IconButton label="Close navigation" data-autofocus="true" onClick={() => ref.current?.close()}>
                        <X size={18} aria-hidden="true" />
                    </IconButton>
                </div>
                <nav aria-label="Primary mobile" className="min-h-0 flex-1 overflow-y-auto p-3">
                    <ul className="space-y-0.5">
                        {NAV_ITEMS.map((item) => {
                            const Icon = item.icon;
                            return (
                                <li key={item.to}>
                                    <NavLink
                                        to={item.to}
                                        end={item.end}
                                        onClick={onClose}
                                        className={({ isActive }) =>
                                            cn(
                                                'oc-nav-link flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                                                isActive
                                                    ? 'bg-raised text-text'
                                                    : 'text-text-muted hover:bg-white/[0.04] hover:text-text'
                                            )
                                        }
                                    >
                                        {({ isActive }) => (
                                            <>
                                                <Icon
                                                    size={18}
                                                    strokeWidth={1.8}
                                                    aria-hidden="true"
                                                    className={isActive ? 'text-blurple-text' : 'text-text-faint'}
                                                />
                                                {item.label}
                                                {isActive ? (
                                                    <span
                                                        aria-hidden="true"
                                                        className="ml-auto size-1.5 rounded-full bg-blurple"
                                                    />
                                                ) : null}
                                            </>
                                        )}
                                    </NavLink>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                <div className="border-t border-border p-3">
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

    return (
        <ShellContext.Provider value={{ openNav }}>
            <div className="flex min-h-dvh bg-bg text-text">
                <a href="#main" className="skip-link">
                    Skip to content
                </a>

                <aside className="hidden shrink-0 border-r border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-[72px] md:flex-col lg:w-60">
                    <Link
                        to="/"
                        aria-label="OrbisCast dashboard"
                        className="flex h-16 items-center justify-center border-b border-border px-3 lg:justify-start lg:px-5"
                    >
                        <span className="lg:hidden">
                            <OrbitalGlyph size={25} className="text-blurple-text" />
                        </span>
                        <span className="hidden lg:block">
                            <Wordmark className="text-text" />
                        </span>
                    </Link>
                    <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto p-2 lg:p-3">
                        <NavLinks />
                    </nav>
                    <div className="border-t border-border p-2 lg:p-2">
                        <StreamerStatusLink />
                        <SessionActions />
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                    <main
                        id="main"
                        ref={mainRef}
                        tabIndex={-1}
                        className="min-w-0 flex-1 focus-visible:outline-none"
                    >
                        <Outlet />
                    </main>
                </div>

                <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
            </div>
        </ShellContext.Provider>
    );
}
