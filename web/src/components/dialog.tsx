import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useRef,
    type FormEvent,
    type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from './button';

type DialogSize = 'sm' | 'md' | 'lg';

/** Kept in sync with the dialog exit transition in styles.css. */
const DIALOG_EXIT_MS = 160;

const DialogCloseContext = createContext<((returnValue?: string) => void) | null>(null);

function useDialogClose() {
    const requestClose = useContext(DialogCloseContext);
    if (!requestClose) throw new Error('ConfirmDialog actions must render inside Dialog');
    return requestClose;
}

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
 * page, and focus return. A short exit state delays close() so the surface can
 * fade before it leaves the top layer.
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
    const closingRef = useRef(false);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearExitTimer = useCallback(() => {
        if (exitTimerRef.current) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    const requestClose = useCallback(
        (returnValue = '') => {
            const dialog = ref.current;
            if (!dialog || !dialog.open || closingRef.current) return;
            closingRef.current = true;
            dialog.dataset.state = 'closing';
            exitTimerRef.current = setTimeout(() => {
                exitTimerRef.current = null;
                closingRef.current = false;
                if (dialog.open) dialog.close(returnValue);
            }, DIALOG_EXIT_MS);
        },
        []
    );

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open) {
            clearExitTimer();
            closingRef.current = false;
            delete dialog.dataset.state;
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
            requestClose();
        }
    }, [clearExitTimer, open, requestClose]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        const handleCancel = (event: Event) => {
            event.preventDefault();
            requestClose();
        };
        const handleClose = () => {
            clearExitTimer();
            closingRef.current = false;
            delete dialog.dataset.state;
            const value = dialog.returnValue;
            dialog.returnValue = '';
            onCloseRef.current(value);
        };
        dialog.addEventListener('cancel', handleCancel);
        dialog.addEventListener('close', handleClose);
        return () => {
            dialog.removeEventListener('cancel', handleCancel);
            dialog.removeEventListener('close', handleClose);
            clearExitTimer();
        };
    }, [clearExitTimer, requestClose]);

    return (
        <dialog
            ref={ref}
            className={cn('oc-dialog', SIZE_CLASS[size], className)}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
        >
            <DialogCloseContext.Provider value={requestClose}>
                <div className="oc-dialog-header flex items-start gap-3 border-b border-outline-variant px-5 pb-4 pt-5 sm:px-6">
                    <div className="min-w-0 flex-1">
                        <h2
                            id={titleId}
                            className="text-lg font-semibold leading-6 tracking-[-0.01em] text-text sm:text-xl"
                        >
                            {title}
                        </h2>
                        {description ? (
                            <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-text-muted">
                                {description}
                            </p>
                        ) : null}
                    </div>
                    <IconButton
                        label="Close dialog"
                        size="sm"
                        onClick={() => requestClose()}
                        className="-mr-1 -mt-1"
                    >
                        <X size={16} aria-hidden="true" />
                    </IconButton>
                </div>
                <div className="oc-dialog-body min-h-0 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
                {footer ? (
                    <div className="oc-dialog-footer flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant px-5 py-4 sm:px-6">
                        {footer}
                    </div>
                ) : null}
            </DialogCloseContext.Provider>
        </dialog>
    );
}

export interface SheetProps {
    open: boolean;
    onClose: (returnValue: string) => void;
    title: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
    className?: string;
}

/**
 * Bottom sheet for compact overlays such as the mobile queue. It reuses the
 * native dialog lifecycle, so focus containment, Escape, and focus return stay
 * intact. Import from this module until the components barrel re-exports it.
 */
export function Sheet({ className, ...props }: SheetProps) {
    return <Dialog {...props} className={cn('oc-sheet', className)} />;
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

function ConfirmForm({
    confirmLabel,
    cancelLabel,
    tone,
    children,
}: Pick<ConfirmDialogProps, 'confirmLabel' | 'cancelLabel' | 'tone' | 'children'>) {
    const requestClose = useDialogClose();

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        requestClose(submitter?.getAttribute('value') ?? '');
    };

    return (
        <form method="dialog" onSubmit={submit}>
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
    );
}

/**
 * Destructive or interrupted confirmation. The safe action (Cancel) owns
 * autofocus. Buttons submit a form that animates the dialog closed.
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
            <ConfirmForm
                confirmLabel={confirmLabel}
                cancelLabel={cancelLabel}
                tone={tone}
            >
                {children}
            </ConfirmForm>
        </Dialog>
    );
}
