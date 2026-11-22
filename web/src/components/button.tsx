import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
    'oc-control inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-[0.01em] transition-[background-color,border-color,color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blurple-bright disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-blurple text-white shadow-e1 hover:bg-blurple-hover active:bg-[#3b46b5]',
    secondary:
        'border border-outline bg-transparent text-text hover:border-blurple-text/45 hover:bg-blurple/10 active:bg-blurple/15',
    ghost: 'text-text-muted hover:bg-text/10 hover:text-text active:bg-text/15',
    danger: 'bg-danger-strong text-white shadow-e1 hover:bg-[#a92a23] active:bg-[#8f211b]',
    quiet: 'text-blurple-text hover:bg-blurple/12 hover:text-[#d8dbff] active:bg-blurple/18',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'oc-button-sm h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-5 text-base',
};

/**
 * Shared button classes for native buttons and router links.
 */
export function buttonStyles({
    variant = 'secondary',
    size = 'md',
    className,
}: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
} = {}): string {
    return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    icon?: ReactNode;
    fullWidth?: boolean;
}

export function Button({
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    className,
    children,
    type = 'button',
    disabled,
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            className={cn(buttonStyles({ variant, size }), fullWidth && 'w-full', className)}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            {...props}
        >
            {loading ? (
                <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            ) : (
                icon ?? null
            )}
            {children}
        </button>
    );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    variant?: ButtonVariant;
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
}

const ICON_SIZES = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
} as const;

export function IconButton({
    label,
    variant = 'ghost',
    size = 'md',
    loading = false,
    className,
    children,
    type = 'button',
    disabled,
    ...props
}: IconButtonProps) {
    return (
        <button
            type={type}
            aria-label={label}
            title={label}
            className={cn(
                BASE,
                'oc-icon-control shrink-0',
                VARIANTS[variant],
                ICON_SIZES[size],
                className
            )}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            {...props}
        >
            {loading ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
                children
            )}
        </button>
    );
}
