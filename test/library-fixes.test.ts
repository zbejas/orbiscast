import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyLibraryFixes, signedExpGolombCodeNum } from '../src/modules/streaming/library-fixes';

const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
const dist = dirname(requireFromProject.resolve('@dank074/discord-video-stream'));
const load = (file: string) => requireFromProject(join(dist, file));

describe('signedExpGolombCodeNum', () => {
    it('follows the H.264 mapping (0, 1, -1, 2, -2 -> 0, 1, 2, 3, 4)', () => {
        expect([0, 1, -1, 2, -2].map(signedExpGolombCodeNum)).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('discord-video-stream fixes', () => {
    let lib: any;
    beforeAll(async () => {
        await applyLibraryFixes();
        lib = {
            ...load('client/processing/AnnexBBitstreamReaderWriter.js'),
            ...load('client/processing/SPSVUIRewriter.js'),
            ...load('client/voice/WebRtcWrapper.js'),
        };
    });

    it('writes signed zero and round-trips signed values', () => {
        const values = [0, 1, -1, 0, 5, -6, 127, -128, 0];
        const writer = new lib.AnnexBBitstreamWriter();
        for (const value of values) writer.writeSignedExpGolomb(value);
        writer.writeBits(1, 1);
        const reader = new lib.AnnexBBitstreamReader(writer.toBuffer());
        expect(values.map(() => reader.readSignedExpGolomb() || 0)).toEqual(values);
    });

    it('rewrites an SPS whose signed fields are zero', () => {
        const writer = new lib.AnnexBBitstreamWriter();
        writer.writeBits(66, 8);
        writer.writeBits(0, 8);
        writer.writeBits(30, 8);
        writer.writeUnsignedExpGolomb(0);
        writer.writeUnsignedExpGolomb(0);
        writer.writeUnsignedExpGolomb(1);
        writer.writeBits(0, 1);
        writer.writeSignedExpGolomb(0);
        writer.writeSignedExpGolomb(0);
        writer.writeUnsignedExpGolomb(1);
        writer.writeSignedExpGolomb(0);
        writer.writeUnsignedExpGolomb(1);
        writer.writeBits(0, 1);
        writer.writeUnsignedExpGolomb(39);
        writer.writeUnsignedExpGolomb(21);
        writer.writeBits(1, 1);
        writer.writeBits(1, 1);
        writer.writeBits(0, 1);
        writer.writeBits(0, 1);
        writer.writeBits(1, 1);
        const sps = Buffer.concat([Buffer.from([0x67]), writer.toBuffer()]);

        const rewritten: Buffer = lib.rewriteSPSVUI(sps);
        expect(rewritten[0]).toBe(0x67);
        expect(rewritten.length).toBeGreaterThan(sps.length - 1);
    });

    it('contains errors while sending a video frame instead of crashing', () => {
        const send = lib.WebRtcConnWrapper.prototype.sendVideoFrame;
        expect(send.__orbiscastGuarded).toBe(true);
        const broken = {
            get ready() {
                throw new Error('boom');
            },
        };
        expect(() => send.call(broken, Buffer.alloc(4), 40)).not.toThrow();
    });

    it('is safe to apply more than once', async () => {
        await applyLibraryFixes();
        expect(lib.WebRtcConnWrapper.prototype.sendVideoFrame.__orbiscastGuarded).toBe(true);
    });
});
