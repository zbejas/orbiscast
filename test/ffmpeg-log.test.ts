import { describe, expect, it } from 'vitest';
import { appendFfmpegLine, isUsefulFfmpegLine, LOW_LATENCY_INPUT_OPTIONS } from '../src/modules/streaming/ffmpeg';

describe('isUsefulFfmpegLine', () => {
    it('keeps errors and stream information', () => {
        expect(isUsefulFfmpegLine('Stream #0:0: Video: h264, yuv420p, 1920x1080')).toBe(true);
        expect(isUsefulFfmpegLine('[hls @ 0x1] Failed to open segment 4')).toBe(true);
    });

    it('drops the banner and build metadata', () => {
        expect(isUsefulFfmpegLine('ffmpeg version 7.1 Copyright (c) 2000-2025')).toBe(false);
        expect(isUsefulFfmpegLine('built with gcc 14.2.0')).toBe(false);
        expect(isUsefulFfmpegLine('configuration: --enable-libzmq')).toBe(false);
        expect(isUsefulFfmpegLine('libavutil 59.39.100 / 59.39.100')).toBe(false);
        expect(isUsefulFfmpegLine('   ')).toBe(false);
    });
});

describe('appendFfmpegLine', () => {
    it('keeps only the last lines', () => {
        const lines: string[] = [];
        for (let index = 0; index < 5; index++) {
            appendFfmpegLine(lines, `error ${index}`, 3);
        }
        expect(lines).toEqual(['error 2', 'error 3', 'error 4']);
    });

    it('ignores noisy lines', () => {
        const lines: string[] = [];
        appendFfmpegLine(lines, 'ffmpeg version 7.1');
        expect(lines).toEqual([]);
    });
});

describe('LOW_LATENCY_INPUT_OPTIONS', () => {
    it('uses the valid low_delay flag', () => {
        expect(LOW_LATENCY_INPUT_OPTIONS).toContain('low_delay');
        expect(LOW_LATENCY_INPUT_OPTIONS).not.toContain('lowdelay');
    });
});
