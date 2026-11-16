import { useRef, useState } from 'react';
import { ProgressBar } from './feedback';

interface SeekBarProps {
    positionMs: number;
    durationMs: number;
    onSeek: (seconds: number) => void;
    disabled?: boolean;
    label?: string;
}

/**
 * A progress bar with an invisible range input on top. Dragging or using the
 * keyboard updates the local preview and commits a seek on release.
 */
export function SeekBar({
    positionMs,
    durationMs,
    onSeek,
    disabled = false,
    label = 'Seek',
}: SeekBarProps) {
    const [dragValue, setDragValue] = useState<number | null>(null);
    const dragRef = useRef<number | null>(null);
    const max = Math.max(0, durationMs);
    const value = Math.min(Math.max(dragValue ?? positionMs, 0), max);

    const setDrag = (next: number) => {
        dragRef.current = next;
        setDragValue(next);
    };

    const commit = () => {
        const next = dragRef.current;
        if (next === null || max <= 0) {
            return;
        }
        dragRef.current = null;
        setDragValue(null);
        onSeek(Math.max(0, Math.min(next, Math.max(0, max - 1000))) / 1000);
    };

    return (
        <div className="relative py-2">
            <ProgressBar value={value} max={max || 1} tone="plex" label={label} />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-plex ring-2 ring-bg"
                style={{ left: `${max > 0 ? (value / max) * 100 : 0}%` }}
            />
            <input
                type="range"
                min={0}
                max={max || 1}
                step={1000}
                value={value}
                disabled={disabled || max <= 0}
                aria-label={label}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                onChange={(event) => setDrag(Number(event.target.value))}
                onPointerUp={commit}
                onPointerCancel={() => {
                    dragRef.current = null;
                    setDragValue(null);
                }}
                onKeyUp={(event) => {
                    if (
                        ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(
                            event.key
                        )
                    ) {
                        commit();
                    }
                }}
                onBlur={commit}
            />
        </div>
    );
}
