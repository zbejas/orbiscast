import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
    Button,
    Field,
    IconButton,
    Input,
    Notice,
    OrbitalGlyph,
    Wordmark,
    useToast,
} from '@/components';
import { ApiError } from '@/lib/api';
import { useAuthConfig, useLogin, usePageTitle, useSession } from '@/lib/hooks';

function loginErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 500) {
            return 'Check the username and password and try again.';
        }
        return error.message;
    }
    return 'Check the username and password and try again.';
}

export default function LoginPage() {
    usePageTitle('Sign in');
    const login = useLogin();
    const authConfig = useAuthConfig();
    const session = useSession();
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [reveal, setReveal] = useState(false);
    const [errors, setErrors] = useState<{ username?: string; password?: string }>({});

    const requestedPath = (location.state as { from?: string } | null)?.from;
    const from =
        requestedPath && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
            ? requestedPath
            : '/';
    const authEnabled = authConfig.data?.enabled === true;

    useEffect(() => {
        if (!authConfig.data) return;
        if (!authConfig.data.enabled) {
            navigate('/', { replace: true });
            return;
        }
        if (session.data?.user) {
            navigate(from, { replace: true });
        }
    }, [authConfig.data, session.data, from, navigate]);

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next: { username?: string; password?: string } = {};
        if (!username.trim()) next.username = 'Enter your username.';
        if (!password) next.password = 'Enter your password.';
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        login.mutate(
            { username: username.trim(), password },
            {
                onSuccess: () => {
                    toast({ title: 'Signed in', tone: 'success' });
                    navigate(from, { replace: true });
                },
            }
        );
    };

    return (
        <>
            <a href="#main" className="skip-link">
                Skip to sign in
            </a>
            <div className="grid min-h-dvh grid-cols-1 bg-bg text-text lg:grid-cols-[1.1fr_0.9fr]">
                <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-[0.35]"
                        style={{
                            backgroundImage:
                                'linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px)',
                            backgroundSize: '48px 48px',
                            maskImage: 'radial-gradient(circle at 45% 45%, black, transparent 72%)',
                        }}
                    />
                    <div className="relative">
                        <Wordmark className="text-text" />
                    </div>
                    <div className="relative flex flex-col items-start">
                        <OrbitalGlyph size={260} className="text-blurple-text opacity-90" strokeWidth={0.9} />
                        <p className="mt-8 max-w-md text-2xl font-semibold leading-snug tracking-[-0.02em] text-text">
                            One streamer, one stream. IPTV, Plex, and Discord in a single control surface.
                        </p>
                        <p className="mt-3 max-w-md text-sm leading-relaxed text-text-muted">
                            Curate a large playlist, queue a movie, and see what the bot is doing without editing a
                            file.
                        </p>
                    </div>
                    <div className="relative flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-muted">
                        <span>IPTV guide</span>
                        <span aria-hidden="true" className="size-1 rounded-full bg-text-faint" />
                        <span>Plex queue</span>
                        <span aria-hidden="true" className="size-1 rounded-full bg-text-faint" />
                        <span>Discord voice</span>
                    </div>
                </aside>

                <main id="main" className="flex min-h-dvh flex-col">
                    <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
                        <div className="w-full max-w-sm">
                            <div className="mb-8 lg:hidden">
                                <Wordmark className="text-text" />
                            </div>
                            <h1 className="mt-2 text-[clamp(1.8rem,1.5rem+1.2vw,2.3rem)] font-semibold tracking-[-0.03em] text-text">
                                Sign in
                            </h1>
                            <p className="mt-2 text-sm leading-relaxed text-text-muted">
                                Use the admin account for this OrbisCast instance.
                            </p>

                            <form noValidate onSubmit={submit} className="mt-7 space-y-4">
                                <Field label="Username" htmlFor="login-username" error={errors.username} required>
                                    <Input
                                        id="login-username"
                                        name="username"
                                        autoComplete="username"
                                        value={username}
                                        onChange={(event) => {
                                            setUsername(event.target.value);
                                            if (errors.username) {
                                                setErrors((current) => ({ ...current, username: undefined }));
                                            }
                                        }}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <Field label="Password" htmlFor="login-password" error={errors.password} required>
                                    <div className="relative">
                                        <Input
                                            id="login-password"
                                            name="password"
                                            type={reveal ? 'text' : 'password'}
                                            autoComplete="current-password"
                                            value={password}
                                            onChange={(event) => {
                                                setPassword(event.target.value);
                                                if (errors.password) {
                                                    setErrors((current) => ({
                                                        ...current,
                                                        password: undefined,
                                                    }));
                                                }
                                            }}
                                            className="pr-11"
                                            required
                                        />
                                        <IconButton
                                            label={reveal ? 'Hide password' : 'Show password'}
                                            size="sm"
                                            className="absolute right-1 top-1/2 -translate-y-1/2"
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

                                {login.isError ? (
                                    <Notice tone="danger" title="Sign in failed">
                                        {loginErrorMessage(login.error)}
                                    </Notice>
                                ) : null}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    size="lg"
                                    fullWidth
                                    loading={login.isPending}
                                >
                                    Sign in
                                </Button>
                            </form>

                            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 text-xs">
                                <span className="text-text-faint">Self-hosted by design.</span>
                                {authEnabled ? (
                                    <span className="text-text-muted">Admin access</span>
                                ) : (
                                    <Link
                                        to="/"
                                        className="rounded text-blurple-text hover:text-[#a5acff]"
                                    >
                                        Return to dashboard
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </>
    );
}
