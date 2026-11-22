import type { SVGProps } from 'react';
import { cn } from '@/lib/cn';

interface GlyphProps extends SVGProps<SVGSVGElement> {
    size?: number;
}

/**
 * The single decorative mark in the product: a core with one orbit and a
 * travelling satellite. Drawn as inline SVG so it inherits the current color.
 */
export function OrbitalGlyph({ size = 24, className, strokeWidth = 1.6, ...props }: GlyphProps) {
    return (
        <svg
            viewBox="0 0 32 32"
            width={size}
            height={size}
            fill="none"
            aria-hidden="true"
            focusable="false"
            className={cn('shrink-0', className)}
            {...props}
        >
            <circle cx="16" cy="16" r="5.25" stroke="currentColor" strokeWidth={strokeWidth} />
            <ellipse
                cx="16"
                cy="16"
                rx="13.4"
                ry="6.1"
                transform="rotate(-27 16 16)"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeOpacity="0.55"
            />
            <circle cx="26.1" cy="9.7" r="1.65" fill="currentColor" />
        </svg>
    );
}

interface WordmarkProps {
    className?: string;
    glyph?: boolean;
    label?: string;
}

/**
 * Inline SVG wordmark. The text is drawn inside the SVG so the mark scales and
 * colors as one asset with the glyph.
 */
export function Wordmark({ className, glyph = true, label = 'OrbisCast' }: WordmarkProps) {
    return (
        <svg
            viewBox="0 0 166 32"
            height="26"
            role="img"
            aria-label={label}
            focusable="false"
            className={cn('w-auto text-text', className)}
        >
            <title>{label}</title>
            {glyph ? (
                <g transform="translate(0 0)" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <circle cx="16" cy="16" r="5.25" />
                    <ellipse
                        cx="16"
                        cy="16"
                        rx="13.4"
                        ry="6.1"
                        transform="rotate(-27 16 16)"
                        strokeOpacity="0.55"
                    />
                    <circle cx="26.1" cy="9.7" r="1.65" fill="currentColor" stroke="none" />
                </g>
            ) : null}
            <text
                x={glyph ? 42 : 0}
                y="22.2"
                fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
                fontSize="15"
                fontWeight="650"
                letterSpacing="3.05"
            >
                ORBISCAST
            </text>
        </svg>
    );
}
