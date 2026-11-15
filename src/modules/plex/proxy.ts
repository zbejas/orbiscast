import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';

const logger = getLogger();

/**
 * A loopback HTTP proxy that injects the Plex client headers into every
 * request. FFmpeg cannot send custom headers reliably through the streaming
 * library, so playback goes through this proxy instead.
 *
 * The proxy listens on 127.0.0.1 only. It forwards the path and query to the
 * configured Plex server and adds the token header, so the token never appears
 * in the URL passed to FFmpeg.
 */
export class PlexProxy {
    private server: Server | null = null;
    private localBase: string | null = null;

    constructor(
        private readonly baseUrl: string,
        private readonly headers: Record<string, string>
    ) {}

    /**
     * Starts the proxy on a random loopback port.
     *
     * @returns Base URL for FFmpeg
     */
    async start(): Promise<string> {
        if (this.server && this.localBase) {
            return this.localBase;
        }
        this.server = createServer((req, res) => this.handle(req.url ?? '/', req.headers, res));
        this.server.on('clientError', (_error, socket) => {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(0, '127.0.0.1', () => resolve());
        });

        const address = this.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Could not determine Plex proxy port');
        }
        this.localBase = `http://127.0.0.1:${address.port}`;
        logger.debug(`Plex proxy listening on ${this.localBase}`);
        return this.localBase;
    }

    /**
     * Stops the proxy.
     */
    async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        this.localBase = null;
        if (!server) return;
        await new Promise<void>(resolve => server.close(() => resolve()));
    }

    private handle(path: string, incoming: IncomingHttpHeaders, res: ServerResponse): void {
        const target = new URL(path, this.baseUrl);
        if (target.origin !== new URL(this.baseUrl).origin) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Plex proxy rejected a cross-origin request');
            return;
        }
        const isHttps = target.protocol === 'https:';
        const request = isHttps ? httpsRequest : httpRequest;
        const headers: Record<string, string> = {
            ...this.headers,
            accept: typeof incoming.accept === 'string' ? incoming.accept : '*/*',
            'accept-encoding': 'identity',
        };
        if (typeof incoming.range === 'string') {
            headers.range = incoming.range;
        }

        const upstream = request(
            target,
            {
                method: 'GET',
                headers,
            },
            response => {
                const status = response.statusCode ?? 502;
                const responseHeaders: Record<string, string | string[]> = {};
                for (const [key, value] of Object.entries(response.headers)) {
                    if (value === undefined || key === 'connection' || key === 'transfer-encoding') continue;
                    responseHeaders[key] = value;
                }
                const location = responseHeaders.location;
                const locationValue = Array.isArray(location) ? location[0] : location;
                if (locationValue && this.localBase) {
                    try {
                        const parsed = new URL(locationValue, target);
                        if (parsed.origin === new URL(this.baseUrl).origin) {
                            responseHeaders.location = `${this.localBase}${parsed.pathname}${parsed.search}`;
                        }
                    } catch {
                        // Keep the original header when Plex sends an unparsable location.
                    }
                }

                const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
                const isManifest = contentType.includes('mpegurl') && Boolean(this.localBase);
                if (isManifest) {
                    delete responseHeaders['content-length'];
                }

                res.writeHead(status, responseHeaders);
                if (isManifest) {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.on('end', () => {
                        const text = Buffer.concat(chunks)
                            .toString('utf8')
                            .replaceAll(new URL(this.baseUrl).origin, this.localBase!);
                        res.end(text);
                    });
                    return;
                }
                response.pipe(res);
            }
        );

        upstream.on('error', error => {
            logger.warn(`Plex proxy request failed: ${redactSecrets(String(error))}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            res.end('Plex proxy error');
        });
        upstream.end();
    }
}
