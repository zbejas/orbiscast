import { describe, expect, it } from 'vitest';
import {
    COMPLETION_RATIO,
    RESUME_MIN_MS,
    isPlaybackComplete,
    resolveResumePosition,
} from '../../src/modules/media/resume';

describe('media resume position', () => {
    it('starts over when there is no history or the item is completed', () => {
        expect(resolveResumePosition(null)).toBe(0);
        expect(
            resolveResumePosition({ positionMs: 900_000, durationMs: 1_800_000, completed: true })
        ).toBe(0);
    });

    it('ignores a barely started item', () => {
        expect(
            resolveResumePosition({
                positionMs: RESUME_MIN_MS - 1,
                durationMs: 3_600_000,
                completed: false,
            })
        ).toBe(0);
        expect(
            resolveResumePosition({
                positionMs: RESUME_MIN_MS,
                durationMs: 3_600_000,
                completed: false,
            })
        ).toBe(RESUME_MIN_MS);
    });

    it('clamps the resume point one second before the end', () => {
        expect(
            resolveResumePosition({
                positionMs: 39_100,
                durationMs: 40_000,
                completed: false,
            })
        ).toBe(39_000);
    });

    it('treats the end guard as finished', () => {
        expect(
            resolveResumePosition({
                positionMs: 1_770_000,
                durationMs: 1_800_000,
                completed: false,
            })
        ).toBe(0);
    });

    it('uses a duration override and supports unknown durations', () => {
        expect(
            resolveResumePosition(
                { positionMs: 120_000, durationMs: 3_600_000, completed: false },
                600_000
            )
        ).toBe(120_000);
        expect(
            resolveResumePosition({ positionMs: 120_000, durationMs: null, completed: false })
        ).toBe(120_000);
    });
});

describe('media completion threshold', () => {
    it('marks items at or after 85 percent as complete', () => {
        expect(isPlaybackComplete(600_000 * COMPLETION_RATIO, 600_000)).toBe(true);
        expect(isPlaybackComplete(599_000, 600_000)).toBe(true);
        expect(isPlaybackComplete(509_999, 600_000)).toBe(false);
    });

    it('never completes without a usable duration', () => {
        expect(isPlaybackComplete(500_000, null)).toBe(false);
        expect(isPlaybackComplete(500_000, 0)).toBe(false);
        expect(isPlaybackComplete(Number.NaN, 600_000)).toBe(false);
    });
});
