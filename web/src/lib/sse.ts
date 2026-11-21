import { useQueryClient } from '@tanstack/react-query';
import type { LogLineDto } from '@shared/types';
import { useEffect, useRef, useState } from 'react';
import { qk, USE_MOCK } from './hooks';
import { createMockLogLine } from './mock';

export type SseStatus = 'connecting' | 'open' | 'error' | 'closed';

interface UseSseOptions {
    enabled?: boolean;
    eventNames?: string[];
}

/**
 * Opens an EventSource with exponential backoff and closes it on unmount.
 * The latest handler is read from a ref so reconnects do not depend on
 * callback identity.
 */
export function useSse(
    path: string | null,
    onEvent: (event: MessageEvent<string>) => void,
    { enabled = true, eventNames = [] }: UseSseOptions = {}
): SseStatus {
    const handlerRef = useRef(onEvent);
    handlerRef.current = onEvent;
    const [status, setStatus] = useState<SseStatus>('closed');
    const eventKey = eventNames.join('|');

    useEffect(() => {
        if (!enabled || !path) {
            setStatus('closed');
            return;
        }

        let disposed = false;
        let stream: EventSource | null = null;
        let retryTimer: number | null = null;
        let attempt = 0;

        const connect = () => {
            if (disposed) return;
            setStatus('connecting');
            stream = new EventSource(path, { withCredentials: true });

            stream.onopen = () => {
                attempt = 0;
                setStatus('open');
            };

            stream.onmessage = (event) => {
                handlerRef.current(event);
            };

            for (const name of eventKey ? eventKey.split('|') : []) {
                stream.addEventListener(name, (event) => {
                    handlerRef.current(event as MessageEvent<string>);
                });
            }

            stream.onerror = () => {
                setStatus('error');
                stream?.close();
                stream = null;
                if (disposed) return;
                const wait = Math.min(15_000, 1_000 * 2 ** attempt);
                attempt += 1;
                retryTimer = window.setTimeout(connect, wait);
            };
        };

        connect();

        return () => {
            disposed = true;
            if (retryTimer != null) window.clearTimeout(retryTimer);
            stream?.close();
            stream = null;
        };
    }, [path, enabled, eventKey]);

    return status;
}

interface AppEventPayload {
    type?: string;
    kind?: string;
}

/** Invalidates the relevant query caches from the server event stream. */
export function useAppEvents(): SseStatus {
    const client = useQueryClient();
    return useSse(
        USE_MOCK ? null : '/api/events',
        (event) => {
            let payload: AppEventPayload = {};
            try {
                payload = JSON.parse(event.data) as AppEventPayload;
            } catch {
                return;
            }
            const topic = `${event.type === 'message' ? '' : event.type} ${payload.type ?? ''} ${
                payload.kind ?? ''
            }`.toLowerCase();
            if (!topic.trim()) return;

            if (topic.includes('playback')) {
                void client.invalidateQueries({ queryKey: qk.playback });
                void client.invalidateQueries({ queryKey: qk.mediaQueue });
            }
            if (topic.includes('queue')) {
                void client.invalidateQueries({ queryKey: qk.mediaQueue });
                void client.invalidateQueries({ queryKey: qk.mediaPlaybackItem });
                void client.invalidateQueries({ queryKey: qk.playback });
            }
            if (topic.includes('history')) {
                void client.invalidateQueries({ queryKey: qk.mediaHistoryAll });
            }
            if (topic.includes('channel') || topic.includes('source') || topic.includes('guide')) {
                void client.invalidateQueries({ queryKey: qk.channelsAll });
                void client.invalidateQueries({ queryKey: qk.sources });
                void client.invalidateQueries({ queryKey: ['guide'] });
            }
            if (topic.includes('discord') || topic.includes('guild')) {
                void client.invalidateQueries({ queryKey: qk.discord });
            }
            if (topic.includes('settings') || topic.includes('media')) {
                void client.invalidateQueries({ queryKey: qk.settings });
                void client.invalidateQueries({ queryKey: qk.mediaSources });
                void client.invalidateQueries({ queryKey: qk.mediaChannels });
            }
        },
        { eventNames: ['playback', 'sources', 'discord', 'queue', 'media', 'history', 'settings'] }
    );
}

interface UseLogFeedResult {
    status: SseStatus;
}

/**
 * Live log feed. Uses the real SSE endpoint when the API is enabled and a
 * local generator while the UI runs on mock data.
 */
export function useLogFeed(onLine: (line: LogLineDto) => void, enabled = true): UseLogFeedResult {
    const handlerRef = useRef(onLine);
    handlerRef.current = onLine;

    const sseStatus = useSse(
        USE_MOCK ? null : '/api/logs/stream',
        (event) => {
            try {
                const parsed = JSON.parse(event.data) as Partial<LogLineDto>;
                if (
                    typeof parsed.id === 'number' &&
                    typeof parsed.timestamp === 'number' &&
                    typeof parsed.level === 'string' &&
                    typeof parsed.message === 'string'
                ) {
                    handlerRef.current(parsed as LogLineDto);
                }
            } catch {
                // Ignore malformed stream frames and keep the connection open.
            }
        },
        { enabled: enabled && !USE_MOCK, eventNames: ['log'] }
    );

    useEffect(() => {
        if (!USE_MOCK || !enabled) return;
        const timer = window.setInterval(() => {
            handlerRef.current(createMockLogLine());
        }, 7_000);
        return () => window.clearInterval(timer);
    }, [enabled]);

    return { status: USE_MOCK ? (enabled ? 'open' : 'closed') : sseStatus };
}
