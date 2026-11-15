import { useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const PALETTES: Array<[string, string, string]> = [
    ['#0d2429', '#2f7f79', '#e8d5a8'],
    ['#1a1730', '#6b5bb5', '#f0b7c8'],
    ['#2a1710', '#9a5230', '#f1d3a6'],
    ['#0c2030', '#2f6f9e', '#b9deea'],
    ['#1c2412', '#5f7f3a', '#dfe7b5'],
    ['#241226', '#8a3f6b', '#e9b8cf'],
    ['#1b1d24', '#55617f', '#d9deea'],
];

function hashSeed(seed: string): number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

interface PosterProps {
    title: string;
    seed?: string;
    src?: string | null;
    className?: string;
    showTitle?: boolean;
}

/**
 * Poster art with an optional real thumbnail. Images load lazily and fall back
 * to the authored abstract art when the source is missing or fails. The tile
 * is decorative because the title is always present as text next to it.
 */
export function Poster({ title, seed, src, className, showTitle = true }: PosterProps) {
    const hash = hashSeed(seed ?? title);
    const [background, accent, ink] = PALETTES[hash % PALETTES.length];
    const variant = hash % 6;
    const style = { '--oc-poster-bg': background } as CSSProperties;
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = Boolean(src) && failedSrc !== src;

    return (
        <div className={cn('oc-poster', className)} style={style} aria-hidden="true">
            {showImage ? (
                <img
                    className="oc-poster-image"
                    src={src ?? undefined}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedSrc(src ?? null)}
                />
            ) : (
                <svg
                className="oc-poster-art"
                viewBox="0 0 200 300"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                focusable="false"
            >
                <rect width="200" height="300" fill={background} />
                {variant === 0 ? (
                    <g>
                        <circle cx="100" cy="112" r="54" fill={accent} />
                        <ellipse
                            cx="100"
                            cy="112"
                            rx="96"
                            ry="38"
                            transform="rotate(-24 100 112)"
                            fill="none"
                            stroke={ink}
                            strokeOpacity="0.8"
                            strokeWidth="1.5"
                        />
                        <circle cx="184" cy="74" r="6" fill={ink} />
                        <path d="M0 252 H200" stroke={ink} strokeOpacity="0.28" />
                    </g>
                ) : null}
                {variant === 1 ? (
                    <g>
                        <circle cx="88" cy="118" r="66" fill={accent} />
                        <circle cx="124" cy="98" r="48" fill={background} fillOpacity="0.82" />
                        <g stroke={ink} strokeOpacity="0.5">
                            <path d="M0 48 H200" />
                            <path d="M0 58 H200" />
                            <path d="M0 68 H200" />
                        </g>
                        <circle cx="158" cy="196" r="18" fill="none" stroke={ink} strokeWidth="1.4" />
                    </g>
                ) : null}
                {variant === 2 ? (
                    <g>
                        <circle cx="100" cy="208" r="82" fill={accent} />
                        <rect x="0" y="208" width="200" height="92" fill={background} />
                        <g stroke={ink} strokeOpacity="0.55">
                            <path d="M0 150 H200" />
                            <path d="M0 162 H200" />
                            <path d="M0 174 H200" />
                        </g>
                        <path d="M24 208 H176" stroke={ink} strokeWidth="2" />
                    </g>
                ) : null}
                {variant === 3 ? (
                    <g>
                        <g stroke={ink} strokeOpacity="0.18">
                            <path d="M40 0 V300" />
                            <path d="M80 0 V300" />
                            <path d="M120 0 V300" />
                            <path d="M160 0 V300" />
                            <path d="M0 60 H200" />
                            <path d="M0 120 H200" />
                            <path d="M0 180 H200" />
                            <path d="M0 240 H200" />
                        </g>
                        <path d="M0 300 A160 160 0 0 1 160 140 L160 300 Z" fill={accent} />
                        <circle cx="152" cy="76" r="22" fill="none" stroke={ink} strokeWidth="1.5" />
                    </g>
                ) : null}
                {variant === 4 ? (
                    <g>
                        <rect x="22" y="52" width="44" height="196" fill={accent} />
                        <rect x="78" y="96" width="30" height="152" fill={accent} fillOpacity="0.65" />
                        <rect x="122" y="34" width="56" height="214" fill={accent} fillOpacity="0.35" />
                        <circle cx="150" cy="72" r="9" fill={ink} />
                        <path d="M22 248 H178" stroke={ink} strokeOpacity="0.4" />
                    </g>
                ) : null}
                {variant === 5 ? (
                    <g fill="none" stroke={ink} strokeOpacity="0.55">
                        <ellipse cx="100" cy="132" rx="86" ry="40" />
                        <ellipse cx="100" cy="132" rx="66" ry="30" />
                        <ellipse cx="100" cy="132" rx="46" ry="20" />
                        <ellipse cx="100" cy="132" rx="26" ry="11" fill={accent} stroke="none" />
                        <circle cx="100" cy="132" r="4" fill={ink} stroke="none" />
                        <path d="M0 238 H200" strokeOpacity="0.25" />
                    </g>
                ) : null}
            </svg>
            )}
            <div className="oc-poster-scrim" />
            {showTitle ? (
                <div className="oc-poster-meta">
                    <span className="oc-poster-title">{title}</span>
                </div>
            ) : null}
        </div>
    );
}

interface ChannelMarkProps {
    name: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const MARK_SIZES = {
    sm: 'h-8 w-8 rounded-md text-[11px]',
    md: 'h-10 w-10 rounded-lg text-xs',
    lg: 'h-16 w-16 rounded-xl text-lg',
} as const;

export function ChannelMark({ name, size = 'md', className }: ChannelMarkProps) {
    const hash = hashSeed(name);
    const [, accent, ink] = PALETTES[hash % PALETTES.length];
    const style = { '--oc-mark-accent': accent, '--oc-mark-ink': ink } as CSSProperties;
    return (
        <span
            aria-hidden="true"
            className={cn('oc-channel-mark shrink-0', MARK_SIZES[size], className)}
            style={style}
        >
            {initials(name)}
        </span>
    );
}
