import type { MediaHistoryDto } from '../../shared/types';

/** Positions shorter than this are treated as a fresh start. */
export const RESUME_MIN_MS = 30_000;

/** Positions this close to the end are treated as finished. */
export const RESUME_END_GUARD_MS = 60_000;

/** Fraction of an item that counts as watched when playback stops. */
export const COMPLETION_RATIO = 0.85;

/**
 * Returns true when playback reached the completion threshold.
 *
 * Stopping at or after this point marks the item watched instead of leaving a
 * near-finished resume entry behind.
 *
 * @param positionMs - Watched position
 * @param durationMs - Item duration, or null when unknown
 */
export function isPlaybackComplete(positionMs: number, durationMs: number | null | undefined): boolean {
    if (!durationMs || durationMs <= 0 || !Number.isFinite(positionMs)) {
        return false;
    }
    return positionMs / durationMs >= COMPLETION_RATIO;
}

/**
 * Returns the saved position to resume from, or zero when the item should
 * start over.
 *
 * A short start, a finished item, or a position inside the end guard never
 * resumes. The result is clamped one second before the known duration.
 *
 * @param history - Saved history row for the item
 * @param durationMs - Optional duration override from the current metadata
 */
export function resolveResumePosition(
    history: Pick<MediaHistoryDto, 'positionMs' | 'durationMs' | 'completed'> | null | undefined,
    durationMs?: number | null
): number {
    if (!history || history.completed) {
        return 0;
    }
    const positionMs = Math.max(0, Math.round(history.positionMs));
    if (positionMs < RESUME_MIN_MS) {
        return 0;
    }
    const duration = durationMs ?? history.durationMs;
    if (duration !== null && duration !== undefined && duration > 0) {
        const endGuard = Math.min(RESUME_END_GUARD_MS, duration * 0.02);
        if (positionMs >= duration - endGuard) {
            return 0;
        }
        return Math.min(positionMs, Math.max(0, duration - 1_000));
    }
    return positionMs;
}
