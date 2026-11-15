import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
    'oc-control inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-blurple text-white hover:bg-blurple-hover active:bg-[#3f49b3]',
    secondary:
        'border border-border bg-raised text-text hover:border-border-strong hover:bg-raised-2 active:bg-raised',
    ghost: 'text-text-muted hover:bg-white/5 hover:text-text',
    danger: 'bg-danger-strong text-white hover:bg-[#b53235] active:bg-[#a32b2e]',
    quiet: 'text-blurple-text hover:bg-blurple/10 hover:text-[#a5acff]',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'oc-button-sm h-8 px-2.5 text-xs',
    md: 'h-9 px-3.5',
    lg: 'h-10 px-4',
};

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
    md: 'h-9 w-9',
    lg: 'h-10 w-10',
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
