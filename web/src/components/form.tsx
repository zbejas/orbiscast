import {
    createContext,
    useContext,
    useId,
    type InputHTMLAttributes,
    type ReactNode,
    type Ref,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
    id: string;
    describedBy?: string;
    invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldProps {
    label: ReactNode;
    htmlFor?: string;
    hint?: ReactNode;
    error?: string | null;
    required?: boolean;
    hideLabel?: boolean;
    children: ReactNode;
    className?: string;
    labelClassName?: string;
}

export function Field({
    label,
    htmlFor,
    hint,
    error,
    required = false,
    hideLabel = false,
    children,
    className,
    labelClassName,
}: FieldProps) {
    const autoId = useId();
    const controlId = htmlFor ?? `${autoId}-control`;
    const hintId = `${controlId}-hint`;
    const errorId = `${controlId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
        <div className={cn('min-w-0', className)}>
            <label
                htmlFor={controlId}
                className={cn(
                    'mb-1.5 flex items-center gap-1 text-xs font-medium text-text-muted',
                    hideLabel && 'sr-only',
                    labelClassName
                )}
            >
                {label}
                {required ? (
                    <span className="text-danger" aria-hidden="true">
                        *
                    </span>
                ) : null}
            </label>
            <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
                {children}
            </FieldContext.Provider>
            {hint && !error ? (
                <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-text-muted">
                    {hint}
                </p>
            ) : null}
            {error ? (
                <p id={errorId} role="alert" className="mt-1.5 text-xs leading-relaxed text-danger">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

const CONTROL_BASE =
    'w-full rounded-md border bg-bg text-sm text-text transition-colors placeholder:text-text-faint disabled:cursor-not-allowed disabled:opacity-50';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    invalid?: boolean;
}

export function Input({ className, id, invalid, ...props }: InputProps) {
    const field = useContext(FieldContext);
    const isInvalid = invalid ?? field?.invalid ?? false;
    return (
        <input
            {...props}
            id={id ?? field?.id}
            aria-invalid={isInvalid || undefined}
            aria-describedby={props['aria-describedby'] ?? field?.describedBy}
            className={cn(
                CONTROL_BASE,
                'h-9 px-3',
                isInvalid ? 'border-danger' : 'border-border focus:border-blurple',
                className
            )}
        />
    );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    invalid?: boolean;
}
export function Select({ className, id, invalid, children, ...props }: SelectProps) {
    const field = useContext(FieldContext);
    const isInvalid = invalid ?? field?.invalid ?? false;
    return (
        <div className="relative min-w-0">
            <select
                {...props}
                id={id ?? field?.id}
                aria-invalid={isInvalid || undefined}
                aria-describedby={props['aria-describedby'] ?? field?.describedBy}
                className={cn(
                    CONTROL_BASE,
                    'h-9 appearance-none pl-3 pr-9',
                    isInvalid ? 'border-danger' : 'border-border focus:border-blurple',
                    className
                )}
            >
                {children}
            </select>
            <ChevronDown
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
        </div>
    );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}

export function Textarea({ className, id, invalid, ...props }: TextareaProps) {
    const field = useContext(FieldContext);
    const isInvalid = invalid ?? field?.invalid ?? false;
    return (
        <textarea
            {...props}
            id={id ?? field?.id}
            aria-invalid={isInvalid || undefined}
            aria-describedby={props['aria-describedby'] ?? field?.describedBy}
            className={cn(
                CONTROL_BASE,
                'min-h-20 resize-y px-3 py-2 leading-relaxed',
                isInvalid ? 'border-danger' : 'border-border focus:border-blurple',
                className
            )}
        />
    );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {    label?: ReactNode;
    description?: ReactNode;
    inputRef?: Ref<HTMLInputElement>;
}

export function Checkbox({ label, description, className, inputRef, ...props }: CheckboxProps) {
    if (!label && !description) {
        return (
            <label
                className={cn(
                    'oc-checkbox-target inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded',
                    className
                )}
            >
                <input ref={inputRef} type="checkbox" className="size-4 accent-blurple" {...props} />
            </label>
        );
    }
    return (
        <label className={cn('oc-checkbox', className)}>
            <input ref={inputRef} type="checkbox" {...props} />
            <span className="min-w-0">
                {label ? <span className="block text-sm text-text">{label}</span> : null}
                {description ? (
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{description}</span>
                ) : null}
            </span>
        </label>
    );
}

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
    label?: ReactNode;
    description?: ReactNode;
}

export function Switch({ label, description, className, id, ...props }: SwitchProps) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const descriptionId = `${inputId}-description`;
    return (
        <div className={cn('oc-switch', className)}>
            <input
                {...props}
                id={inputId}
                type="checkbox"
                role="switch"
                className="sr-only"
                aria-describedby={props['aria-describedby'] ?? (description ? descriptionId : undefined)}
            />
            <label htmlFor={inputId} className="oc-switch-track" aria-hidden="true">
                <span className="oc-switch-knob" />
            </label>
            {label || description ? (
                <div className="min-w-0">
                    {label ? (
                        <label htmlFor={inputId} className="block cursor-pointer text-sm leading-6 text-text">
                            {label}
                        </label>
                    ) : null}
                    {description ? (
                        <p id={descriptionId} className="mt-0.5 text-xs leading-relaxed text-text-muted">
                            {description}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
