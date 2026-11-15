import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from './button';

type DialogSize = 'sm' | 'md' | 'lg';

interface DialogProps {
    open: boolean;
    onClose: (returnValue: string) => void;
    title: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
    size?: DialogSize;
    className?: string;
}

const SIZE_CLASS: Record<DialogSize, string> = {
    sm: 'oc-dialog-sm',
    md: '',
    lg: 'oc-dialog-lg',
};

/**
 * Native modal dialog. The browser owns focus containment, Escape, the inert
 * page, and focus return. Do not add role="dialog", aria-modal, or a trap.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
    className,
}: DialogProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open) {
            if (!dialog.open) {
                dialog.showModal();
                const focusInitial = () => {
                    if (!dialog.open) return;
                    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
                };
                focusInitial();
                window.requestAnimationFrame(focusInitial);
            }
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        const handleClose = () => {
            const value = dialog.returnValue;
            dialog.returnValue = '';
            onCloseRef.current(value);
        };
        dialog.addEventListener('close', handleClose);
        return () => dialog.removeEventListener('close', handleClose);
    }, []);

    return (
        <dialog
            ref={ref}
            className={cn('oc-dialog', SIZE_CLASS[size], className)}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
        >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                    <h2 id={titleId} className="text-base font-semibold leading-6 tracking-[-0.01em] text-text">
                        {title}
                    </h2>
                    {description ? (
                        <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-text-muted">
                            {description}
                        </p>
                    ) : null}
                </div>
                <IconButton
                    label="Close dialog"
                    size="sm"
                    onClick={() => ref.current?.close()}
                    className="-mr-1 -mt-1"
                >
                    <X size={16} aria-hidden="true" />
                </IconButton>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
                    {footer}
                </div>
            ) : null}
        </dialog>
    );
}

interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'default';
    children?: ReactNode;
}

/**
 * Destructive or interrupted confirmation. The safe action (Cancel) owns
 * autofocus. Buttons submit a native method="dialog" form.
 */
export function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
    children,
}: ConfirmDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={(value) => {
                if (value === 'confirm') onConfirm();
                onClose();
            }}
            title={title}
            description={description}
            size="sm"
        >
            <form method="dialog">
                {children ? <div className="mb-4">{children}</div> : null}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="submit" value="cancel" variant="secondary" data-autofocus="true">
                        {cancelLabel}
                    </Button>
                    <Button
                        type="submit"
                        value="confirm"
                        variant={tone === 'danger' ? 'danger' : 'primary'}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
