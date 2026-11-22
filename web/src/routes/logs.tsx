import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, RefreshCw, Search, Terminal } from 'lucide-react';
import type { LogLineDto } from '@shared/types';
import {
    Button,
    ErrorState,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
    StatusPill,
    buttonStyles,
} from '@/components';
import { useLogs } from '@/lib/hooks';
import { useLogFeed } from '@/lib/sse';
import type { LogLevelFilter } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatClock, formatCount } from '@/lib/format';

const LEVELS: Array<{ value: LogLevelFilter; label: string }> = [
    { value: 'all', label: 'All levels' },
    { value: 'error', label: 'Error' },
    { value: 'warn', label: 'Warn' },
    { value: 'info', label: 'Info' },
    { value: 'debug', label: 'Debug' },
];

function levelClass(level: string): string {
    if (level === 'error') return 'text-danger';
    if (level === 'warn') return 'text-warn';
    if (level === 'debug') return 'text-text-faint';
    return 'text-text-muted';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The log API did not respond.';
}

export default function LogsPage() {
    const logs = useLogs(250);
    const [lines, setLines] = useState<LogLineDto[]>([]);
    const [level, setLevel] = useState<LogLevelFilter>('all');
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [paused, setPaused] = useState(false);
    const pausedRef = useRef(false);
    const bufferedRef = useRef<LogLineDto[]>([]);
    const [bufferCount, setBufferCount] = useState(0);
    const consoleRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!logs.data) return;
        setLines((current) => {
            const merged = new Map<number, LogLineDto>();
            for (const line of logs.data.items) merged.set(line.id, line);
            for (const line of current) merged.set(line.id, line);
            return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-600);
        });
    }, [logs.data]);

    const handleLine = useCallback((line: LogLineDto) => {
        if (pausedRef.current) {
            bufferedRef.current = [...bufferedRef.current, line].slice(-300);
            setBufferCount(bufferedRef.current.length);
            return;
        }
        setLines((current) => [...current, line].slice(-600));
    }, []);

    const feed = useLogFeed(handleLine);

    const visible = useMemo(() => {
        const needle = deferredSearch.trim().toLowerCase();
        return lines.filter((line) => {
            if (level !== 'all' && line.level !== level) return false;
            if (needle && !line.message.toLowerCase().includes(needle)) return false;
            return true;
        });
    }, [lines, level, deferredSearch]);

    useEffect(() => {
        if (paused) return;
        const element = consoleRef.current;
        if (!element) return;
        element.scrollTop = element.scrollHeight;
    }, [visible.length, paused]);

    const togglePause = () => {
        const next = !paused;
        pausedRef.current = next;
        setPaused(next);
        if (!next && bufferedRef.current.length > 0) {
            const buffered = bufferedRef.current;
            bufferedRef.current = [];
            setBufferCount(0);
            setLines((current) =>
                [...current, ...buffered]
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(-600)
            );
        }
    };

    const download = () => {
        const text = visible
            .map(
                (line) =>
                    `${new Date(line.timestamp).toISOString()} ${line.level.toUpperCase().padEnd(5)} ${line.message}`
            )
            .join('\n');
        const blob = new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        anchor.href = url;
        anchor.download = `orbiscast-logs-${stamp}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    const streamTone =
        paused ? 'neutral' : feed.status === 'open' ? 'live' : feed.status === 'error' ? 'danger' : 'warn';
    const streamLabel = paused
        ? 'Paused'
        : feed.status === 'open'
          ? 'Streaming'
          : feed.status === 'connecting'
            ? 'Connecting'
            : feed.status === 'error'
              ? 'Reconnecting'
              : 'Closed';

    return (
        <>
            <PageHeader title="Logs" meta={`${formatCount(lines.length)} lines · live tail`} />
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-3 sm:p-5 xl:p-6">
                <section className="rounded-[28px] border border-border/60 bg-surface p-4 sm:p-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_11rem_auto]">
                        <Field label="Search messages" htmlFor="log-search">
                            <div className="relative">
                                <Search
                                    size={14}
                                    aria-hidden="true"
                                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                                />
                                <Input
                                    id="log-search"
                                    type="search"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Voice, media, source, error"
                                    className="pl-8"
                                />
                            </div>
                        </Field>
                        <Field label="Level" htmlFor="log-level">
                            <Select
                                id="log-level"
                                value={level}
                                onChange={(event) => setLevel(event.target.value as LogLevelFilter)}
                            >
                                {LEVELS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <div className="flex items-end gap-2">
                            <Button
                                variant={paused ? 'primary' : 'secondary'}
                                size="md"
                                icon={
                                    paused ? (
                                        <Play size={14} aria-hidden="true" />
                                    ) : (
                                        <Pause size={14} aria-hidden="true" />
                                    )
                                }
                                onClick={togglePause}
                                className="flex-1 sm:flex-none"
                            >
                                {paused ? 'Resume' : 'Pause'}
                            </Button>
                            <Button
                                variant="secondary"
                                size="md"
                                icon={<Download size={14} aria-hidden="true" />}
                                onClick={download}
                                disabled={visible.length === 0}
                                className="flex-1 sm:flex-none"
                            >
                                Download
                            </Button>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                        <StatusPill tone={streamTone} pulse={streamTone === 'live'}>
                            {streamLabel}
                        </StatusPill>
                        {paused && bufferCount > 0 ? (
                            <span className="text-[11px] text-warn">
                                {formatCount(bufferCount)} new line{bufferCount === 1 ? '' : 's'} while paused
                            </span>
                        ) : null}
                        <span className="ml-auto font-mono text-[11px] tabular-nums text-text-muted">
                            {formatCount(visible.length)} of {formatCount(lines.length)} lines
                        </span>
                    </div>
                </section>

                {logs.isError ? (
                    <section className="rounded-[28px] border border-border/60 bg-surface">
                        <ErrorState
                            title="Logs could not load"
                            message={errorMessage(logs.error)}
                            onRetry={() => void logs.refetch()}
                        />
                    </section>
                ) : logs.isPending ? (
                    <div className="space-y-2 rounded-[28px] border border-border/60 bg-surface p-5" aria-hidden="true">
                        {Array.from({ length: 10 }).map((_, index) => (
                            <Skeleton key={index} className="h-4 w-full" />
                        ))}
                    </div>
                ) : (
                    <div
                        ref={consoleRef}
                        role="log"
                        aria-live="off"
                        aria-label="Log output"
                        style={{ background: 'var(--color-bg-deep)' }}
                        className="oc-log-console h-[min(64dvh,44rem)] overflow-auto rounded-[28px] border border-border/60 p-4 font-mono text-[11px]"
                    >
                        {visible.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                                <Terminal size={24} aria-hidden="true" className="text-text-faint" />
                                <p className="mt-2 text-xs text-text-muted">
                                    {lines.length === 0
                                        ? 'No log lines yet. The bot writes here as it runs.'
                                        : 'No lines match this search and level.'}
                                </p>
                                {lines.length > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearch('');
                                            setLevel('all');
                                        }}
                                        className={cn(buttonStyles({ variant: 'ghost', size: 'sm' }), 'mt-2')}
                                    >
                                        Clear filters
                                    </button>
                                ) : null}
                            </div>
                        ) : (
                            <ol className="space-y-0.5">
                                {visible.map((line) => (
                                    <li
                                        key={line.id}
                                        className="oc-log-line rounded px-1 py-0.5 hover:bg-white/[0.03]"
                                    >
                                        <span className="tabular-nums text-text-faint">
                                            {formatClock(line.timestamp)}
                                        </span>
                                        <span className={cn('uppercase', levelClass(line.level))}>
                                            {line.level}
                                        </span>
                                        <span
                                            className={cn(
                                                'whitespace-pre-wrap break-words',
                                                line.level === 'error'
                                                    ? 'text-danger'
                                                    : line.level === 'warn'
                                                      ? 'text-warn'
                                                      : line.level === 'debug'
                                                        ? 'text-text-faint'
                                                        : 'text-text-muted'
                                            )}
                                        >
                                            {line.message}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-faint">
                    <span>
                        {paused
                            ? 'New lines are buffered until you resume the tail.'
                            : 'Newest lines appear at the bottom. The console follows while streaming.'}
                    </span>
                    <button
                        type="button"
                        onClick={() => void logs.refetch()}
                        className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-text-muted transition-colors duration-200 hover:bg-white/[0.05] hover:text-text"
                    >
                        <RefreshCw size={12} aria-hidden="true" />
                        Reload history
                    </button>
                </div>
            </div>
        </>
    );
}
