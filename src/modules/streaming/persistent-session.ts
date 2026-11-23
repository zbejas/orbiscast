import type { Readable } from 'node:stream';
import { demux, Encoders, prepareStream, Streamer } from '@dank074/discord-video-stream';
import { AudioStream, VideoStream } from './media-stream';
import { appendFfmpegLine } from './ffmpeg';
import { getLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import type { StreamResult } from './index';

const logger = getLogger();

type StreamConnection = Awaited<ReturnType<Streamer['createStream']>>;
type VideoCodec = 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1';
type FfmpegProcess = Promise<unknown> & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
};

const VIDEO_CODECS: Record<number, VideoCodec> = {
    27: 'H264',
    173: 'H265',
    139: 'VP8',
    167: 'VP9',
    225: 'AV1',
};

export interface PersistentStreamOptions {
    noTranscoding: boolean;
    bitrateVideo: number;
    bitrateVideoMax: number;
    encoder: ReturnType<typeof Encoders.software>;
    inputOptions: string[];
    headers: Record<string, string>;
    /** Cap the re-encode height. Discord does not need more than 1080p. */
    maxHeight?: number;
    /** Replaces the library's height-only scale filter with a capped box. */
    scaleFilter?: string;
}

interface ActiveSource {
    output: Readable;
    video: Readable;
    audio: Readable | null;
    abort: AbortController;
    process: FfmpegProcess;
    error: string | null;
    ended: boolean;
}

/**
 * Owns one Discord stream connection and swaps the FFmpeg source underneath it.
 * Seeking therefore keeps the stream alive instead of deleting and recreating
 * it, which would make viewers drop and rejoin the stream.
 */
export class PersistentStream {
    private connection: StreamConnection | null = null;
    private videoStream: VideoStream | null = null;
    private audioStream: AudioStream | null = null;
    private source: ActiveSource | null = null;
    private options: PersistentStreamOptions | null = null;
    private resolveSession: ((result: StreamResult) => void) | null = null;
    private stopped = false;
    private swapping = false;
    private videoCodec: VideoCodec | null = null;
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly streamer: Streamer) {}

    get active(): boolean {
        return this.options !== null && !this.stopped;
    }

    /**
     * Creates the Discord stream and starts the first source.
     */
    async start(url: string, options: PersistentStreamOptions): Promise<StreamResult> {
        this.options = options;
        this.stopped = false;
        const session = new Promise<StreamResult>(resolve => {
            this.resolveSession = resolve;
        });

        try {
            await this.enqueue(async () => {
                if (this.stopped) throw new Error('Media stream is not active');
                this.connection = await this.streamer.createStream();
                await this.startSource(url, true);
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Media stream failed to start: ${redactSecrets(message)}`);
            this.stopped = true;
            await this.enqueue(async () => {
                await this.stopSource();
                this.cleanupConnection();
            });
            this.resolveSession = null;
            return { aborted: false, error: message };
        }

        return session;
    }

    /**
     * Replaces the current source while keeping the same Discord stream.
     */
    async replace(url: string): Promise<void> {
        if (!this.active) {
            throw new Error('Media stream is not active');
        }
        await this.enqueue(async () => {
            if (!this.connection || this.stopped || !this.options) {
                throw new Error('Media stream is not active');
            }
            this.swapping = true;
            logger.info('Replacing media source and keeping the Discord stream open');
            try {
                await this.stopSource();
                await this.startSource(url, false);
                this.videoStream?.resumePacing();
                this.audioStream?.resumePacing();
            } catch (error) {
                this.stopped = true;
                await this.stopSource();
                this.cleanupConnection();
                const message = error instanceof Error ? error.message : String(error);
                this.resolveSession?.({ aborted: false, error: message });
                this.resolveSession = null;
                throw error;
            } finally {
                this.swapping = false;
            }
        });
    }

    pause(): boolean {
        if (!this.source) return false;
        this.videoStream?.pausePacing();
        this.audioStream?.pausePacing();
        if (!this.source.process.kill('SIGSTOP')) {
            this.videoStream?.resumePacing();
            this.audioStream?.resumePacing();
            return false;
        }
        return true;
    }

    resume(): boolean {
        if (!this.source) return false;
        if (!this.source.process.kill('SIGCONT')) {
            return false;
        }
        this.videoStream?.resumePacing();
        this.audioStream?.resumePacing();
        return true;
    }

    async stop(): Promise<void> {
        if (!this.options && !this.connection && !this.resolveSession) return;
        this.stopped = true;
        await this.enqueue(async () => {
            await this.stopSource();
            await this.videoStream?.idle();
            await this.audioStream?.idle();
            this.cleanupConnection();
        });
        const resolve = this.resolveSession;
        this.resolveSession = null;
        resolve?.({ aborted: true, error: null });
    }

    /**
     * Serializes starts, swaps, and stops so a seek issued during startup waits
     * for the first source instead of racing it.
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.queue.then(task, task);
        this.queue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    private async startSource(url: string, initial: boolean): Promise<void> {
        if (!this.options) throw new Error('Media stream options are missing');
        const connection = this.connection;
        if (!connection) throw new Error('Discord stream connection is not active');

        const abort = new AbortController();
        const prepared = prepareStream(
            url,
            {
                noTranscoding: this.options.noTranscoding,
                width: -2,
                height: this.options.maxHeight ?? -2,
                bitrateVideo: this.options.bitrateVideo,
                bitrateVideoMax: this.options.bitrateVideoMax,
                videoCodec: 'H264',
                encoder: this.options.encoder,
                customInputOptions: this.options.inputOptions,
                customHeaders: this.options.headers,
                customFfmpegFlags:
                    this.options.scaleFilter && !this.options.noTranscoding
                        ? ['-vf', this.options.scaleFilter]
                        : [],
            },
            abort.signal
        );
        const ffmpeg = prepared.promise as FfmpegProcess;
        const ffmpegLog: string[] = [];
        let ffmpegTailLogged = false;
        const logFfmpegTail = () => {
            if (ffmpegTailLogged || ffmpegLog.length === 0) return;
            ffmpegTailLogged = true;
            logger.error(
                `Last media FFmpeg output:\n${ffmpegLog.map(line => redactSecrets(line)).join('\n')}`
            );
        };
        prepared.command.on('stderr', (line: string) => appendFfmpegLine(ffmpegLog, line));
        ffmpeg.catch(() => {
            // Mark the rejection handled until the source exists.
        });

        try {
            const demuxed = await demux(prepared.output, { format: 'nut' });
            if (!demuxed.video) {
                throw new Error('No video stream in media');
            }
            if (this.stopped || this.connection !== connection) {
                throw new Error('Media stream is not active');
            }

            const codec = VIDEO_CODECS[Number(demuxed.video.codec)] ?? 'H264';
            const fps = Math.max(
                1,
                Math.round(demuxed.video.framerate_num / Math.max(1, demuxed.video.framerate_den))
            );
            logger.info(
                `Media video: ${codec} ${demuxed.video.width}x${demuxed.video.height} at ${fps} fps`
            );
            if (initial) {
                this.videoCodec = codec;
                connection.setPacketizer(codec);
                connection.mediaConnection.setSpeaking(true);
                connection.mediaConnection.setVideoAttributes(true, {
                    width: demuxed.video.width,
                    height: demuxed.video.height,
                    fps,
                });
                this.videoStream = new VideoStream(connection);
            } else if (codec !== this.videoCodec) {
                throw new Error('Media source changed its video codec');
            }

            const videoStream = this.videoStream;
            if (!videoStream) throw new Error('Media video stream is not active');

            if (demuxed.audio) {
                this.audioStream ??= new AudioStream(connection);
                this.audioStream.reset();
                videoStream.syncStream = this.audioStream;
            } else {
                videoStream.syncStream = undefined;
            }
            videoStream.reset();

            const source: ActiveSource = {
                output: prepared.output,
                video: demuxed.video.stream,
                audio: demuxed.audio?.stream ?? null,
                abort,
                process: ffmpeg,
                error: null,
                ended: false,
            };
            this.source = source;
            const finish = () => {
                if (source.ended) return;
                source.ended = true;
                if (this.source !== source) return;
                void this.handleSourceEnd(source);
            };

            ffmpeg.catch((error: unknown) => {
                if (!abort.signal.aborted) {
                    source.error ??= String(error);
                    logFfmpegTail();
                }
            });
            source.video.once('end', finish);
            source.video.once('error', (error: Error) => {
                source.error ??= String(error);
                finish();
            });
            source.video.once('close', finish);
            source.audio?.once('error', (error: Error) => {
                source.error ??= String(error);
            });

            source.video.pipe(videoStream, { end: false });
            if (source.audio && this.audioStream) {
                source.audio.pipe(this.audioStream, { end: false });
            }
        } catch (error) {
            abort.abort();
            try {
                await ffmpeg;
            } catch {
                // The aborted FFmpeg process is expected to fail.
            }
            logFfmpegTail();
            throw error;
        }
    }

    private async handleSourceEnd(source: ActiveSource): Promise<void> {
        if (this.source !== source || this.swapping || this.stopped) return;

        await this.videoStream?.idle();
        await this.audioStream?.idle();
        if (this.source !== source || this.swapping || this.stopped) return;

        const error = source.error;
        await this.stopSource();
        this.cleanupConnection();
        this.resolveSession?.({ aborted: false, error });
        this.resolveSession = null;
    }

    private async stopSource(): Promise<void> {
        const source = this.source;
        this.source = null;
        if (!source) return;
        source.ended = true;
        try {
            source.process.kill('SIGCONT');
        } catch {
            // The process may already have exited.
        }
        source.abort.abort();
        if (this.videoStream) source.video.unpipe(this.videoStream);
        if (this.audioStream) source.audio?.unpipe(this.audioStream);
        source.video.destroy();
        source.audio?.destroy();
        source.output.destroy();
        this.videoStream?.reset();
        this.audioStream?.reset();
        try {
            await source.process;
        } catch {
            // The process was aborted.
        }
    }

    private cleanupConnection(): void {
        const connection = this.connection;
        this.connection = null;
        this.options = null;
        this.videoCodec = null;
        this.videoStream?.destroy();
        this.audioStream?.destroy();
        this.videoStream = null;
        this.audioStream = null;
        if (!connection) return;
        try {
            connection.mediaConnection.setSpeaking(false);
            connection.mediaConnection.setVideoAttributes(false);
        } catch {
            // The connection may already be closed.
        }
        this.streamer.stopStream();
    }
}
