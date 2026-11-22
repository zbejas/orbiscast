import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Minimal media packet shape shared by node-av and the Discord packetizer.
 * Adapted from `@dank074/discord-video-stream` (ISC) so the Discord stream can
 * stay open while one FFmpeg source is replaced by another during seek.
 */
export interface MediaPacket {
    data?: Buffer;
    pts: number | bigint;
    duration: number | bigint;
    timeBase: { num: number; den: number };
    free(): void;
}

interface MediaSender {
    sendVideoFrame(frame: Buffer, frametime: number): void;
    sendAudioFrame(frame: Buffer, frametime: number): void;
}

export abstract class BaseMediaStream extends Writable {
    private ptsValue?: number;
    private startTime?: number;
    private startPts?: number;
    private syncEnabled = true;
    private syncStreamValue?: BaseMediaStream;
    private generation = 0;
    private pendingWrites = 0;
    private idleWaiters: Array<() => void> = [];
    private paused = false;

    constructor() {
        super({ objectMode: true, highWaterMark: 0 });
    }

    get pts(): number | undefined {
        return this.ptsValue;
    }

    /**
     * Clears pacing state when the source is replaced. Packets still queued
     * from the old source finish their write but no longer affect pacing.
     */
    reset(): void {
        this.generation++;
        this.ptsValue = undefined;
        this.startTime = undefined;
        this.startPts = undefined;
    }

    /**
     * Marks the stream as paused so the sync loop stops spinning. Actual
     * pacing is rebased when {@link resumePacing} runs.
     */
    pausePacing(): void {
        this.paused = true;
    }

    /**
     * Rebases pacing after a pause. Media timestamps may jump while FFmpeg is
     * suspended, so the next frame starts a fresh wall-clock window instead of
     * trying to catch up and playing audio ahead of video.
     */
    resumePacing(): void {
        if (!this.paused) return;
        this.paused = false;
        this.resetTiming();
    }

    /**
     * Resolves once every queued packet has been written. The Discord stream
     * stays open across source swaps, so end of playback is decided by the
     * source ending and this stream draining, not by ending the writable.
     */
    async idle(): Promise<void> {
        if (this.pendingWrites === 0) return;
        await new Promise<void>(resolve => this.idleWaiters.push(resolve));
    }

    get syncStream(): BaseMediaStream | undefined {
        return this.syncStreamValue;
    }

    set syncStream(stream: BaseMediaStream | undefined) {
        if (stream !== undefined && this === stream.syncStream) {
            throw new Error('Cannot sync two streams with each other');
        }
        this.syncStreamValue = stream;
    }

    protected abstract sendFrame(frame: Buffer, frametime: number): Promise<void>;

    private get isAhead(): boolean {
        if (this.pts === undefined || this.syncStreamValue?.pts === undefined) return false;
        return (
            this.syncStreamValue.writableEnded === false &&
            this.pts - this.syncStreamValue.pts > 20
        );
    }

    private get isBehind(): boolean {
        if (this.pts === undefined || this.syncStreamValue?.pts === undefined) return false;
        return (
            this.syncStreamValue.writableEnded === false &&
            this.pts - this.syncStreamValue.pts < -20
        );
    }

    private resetTiming(): void {
        this.startTime = undefined;
        this.startPts = undefined;
    }

    override _write(
        frame: MediaPacket,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
    ): void {
        this.pendingWrites++;
        void this.processFrame(frame)
            .then(
                () => callback(),
                error => callback(error instanceof Error ? error : new Error(String(error)))
            )
            .finally(() => {
                this.pendingWrites--;
                if (this.pendingWrites > 0) return;
                const waiters = this.idleWaiters;
                this.idleWaiters = [];
                for (const resolve of waiters) resolve();
            });
    }

    private async processFrame(frame: MediaPacket): Promise<void> {
        const generation = this.generation;
        const { data, pts, duration, timeBase } = frame;
        try {
            if (!data) return;

            const frametime = (Number(duration) / timeBase.den) * timeBase.num * 1000;
            const sendStart = performance.now();
            await this.sendFrame(Buffer.from(data), frametime);
            if (generation !== this.generation) return;
            const sendEnd = performance.now();

            this.ptsValue = (Number(pts) / timeBase.den) * timeBase.num * 1000;
            this.emit('pts', this.ptsValue);

            this.startTime ??= sendStart;
            this.startPts ??= this.ptsValue;
            const delay = Math.max(
                0,
                this.ptsValue - this.startPts + frametime - (sendEnd - this.startTime)
            );

            if (delay === 0) return;
            if (this.syncEnabled && this.isBehind) {
                this.resetTiming();
                return;
            }
            if (this.syncEnabled && this.isAhead) {
                do {
                    await sleep(frametime);
                } while (
                    this.syncEnabled &&
                    !this.paused &&
                    this.isAhead &&
                    generation === this.generation
                );
                this.resetTiming();
                return;
            }

            await sleep(delay);
        } finally {
            frame.free();
        }
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        super._destroy(error, callback);
        this.syncStreamValue = undefined;
    }
}

export class VideoStream extends BaseMediaStream {
    constructor(private readonly connection: MediaSender) {
        super();
    }

    protected override async sendFrame(frame: Buffer, frametime: number): Promise<void> {
        this.connection.sendVideoFrame(frame, frametime);
    }
}

export class AudioStream extends BaseMediaStream {
    constructor(private readonly connection: MediaSender) {
        super();
    }

    protected override async sendFrame(frame: Buffer, frametime: number): Promise<void> {
        this.connection.sendAudioFrame(frame, frametime);
    }
}
