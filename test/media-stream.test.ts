import { describe, expect, it } from 'vitest';
import { VideoStream, type MediaPacket } from '../src/modules/streaming/media-stream';

function packet(pts: number): MediaPacket {
    return {
        data: Buffer.from([1]),
        pts,
        duration: 0,
        timeBase: { num: 1, den: 1000 },
        free: () => undefined,
    };
}

function createStream(sent: Buffer[]): VideoStream {
    return new VideoStream({
        sendVideoFrame: frame => sent.push(frame),
        sendAudioFrame: () => undefined,
    });
}

describe('BaseMediaStream pause', () => {
    it('holds a frame until playback resumes', async () => {
        const sent: Buffer[] = [];
        const stream = createStream(sent);
        stream.pausePacing();

        const write = new Promise<void>((resolve, reject) =>
            stream.write(packet(0), error => (error ? reject(error) : resolve()))
        );
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(sent).toHaveLength(0);

        stream.resumePacing();
        await write;
        expect(sent).toHaveLength(1);
        stream.destroy();
    });

    it('drops a held frame when the source resets', async () => {
        const sent: Buffer[] = [];
        const stream = createStream(sent);
        stream.pausePacing();

        const write = new Promise<void>((resolve, reject) =>
            stream.write(packet(0), error => (error ? reject(error) : resolve()))
        );
        await new Promise(resolve => setTimeout(resolve, 20));
        stream.reset();
        await write;
        expect(sent).toHaveLength(0);
        stream.destroy();
    });
});
