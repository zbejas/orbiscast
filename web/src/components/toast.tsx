import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { CircleCheck, Info, TriangleExclamationPoint, X } from 'lucide-react';
import { IconButton } from './button';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
    title: string;
    description?: string;
    tone?: ToastTone;
}

interface ToastRecord extends ToastInput {
    id: number;
}

interface ToastContextValue {
    push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): (toast: ToastInput) => void {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used inside ToastProvider');
    return context.push;
}

const TONE_ICON = {
    info: Info,
    success: CircleCheck,
    error: TriangleExclamationPoint,
} as const;

const TONE_CLASS: Record<ToastTone, string> = {
    info: 'text-blurple-text',
    success: 'text-blurple-text',
    error: 'text-danger',
};

/** Milliseconds before a toast dismisses itself. Errors stay longer. */
const TOAST_LIFETIME_MS = 6_000;
const TOAST_LIFETIME_ERROR_MS = 10_000;

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
    const tone = toast.tone ?? 'info';
    const ToneIcon = TONE_ICON[tone];

    useEffect(() => {
        const timer = setTimeout(
            () => onDismiss(toast.id),
            tone === 'error' ? TOAST_LIFETIME_ERROR_MS : TOAST_LIFETIME_MS
        );
        return () => clearTimeout(timer);
    }, [onDismiss, toast.id, tone]);

    return (
        <div className="oc-toast flex items-start gap-3">
            <ToneIcon
                size={17}
                aria-hidden="true"
                className={`mt-0.5 shrink-0 ${TONE_CLASS[tone]}`}
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-text">{toast.title}</p>
                {toast.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {toast.description}
                    </p>
                ) : null}
            </div>
            <IconButton
                label="Dismiss notification"
                size="sm"
                className="-mr-1 -mt-1"
                onClick={() => onDismiss(toast.id)}
            >
                <X size={14} aria-hidden="true" />
            </IconButton>
        </div>
    );
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);
    const [announcement, setAnnouncement] = useState('');
    const regionRef = useRef<HTMLDivElement>(null);
    const shownRef = useRef(false);
    const pendingRef = useRef<ToastRecord[]>([]);
    const nextId = useRef(1);

    const announce = useCallback((message: string) => {
        const navigatorWithNotify = navigator as Navigator & { ariaNotify?: (text: string) => void };
        if (typeof navigatorWithNotify.ariaNotify === 'function') {
            navigatorWithNotify.ariaNotify(message);
            return;
        }
        setAnnouncement((current) => (current === message ? `${message} ` : message));
    }, []);

    const push = useCallback(
        (input: ToastInput) => {
            const record: ToastRecord = {
                id: nextId.current,
                tone: input.tone ?? 'info',
                title: input.title,
                description: input.description,
            };
            nextId.current += 1;
            const message = [record.title, record.description].filter(Boolean).join('. ');
            if (document.querySelector('dialog:modal')) {
                pendingRef.current.push(record);
                return;
            }
            setToasts((current) => [...current, record]);
            announce(message);
        },
        [announce]
    );

    useEffect(() => {
        const flush = () => {
            if (pendingRef.current.length === 0) return;
            const queued = pendingRef.current;
            pendingRef.current = [];
            setToasts((current) => [...current, ...queued]);
            announce(queued.map((item) => [item.title, item.description].filter(Boolean).join('. ')).join(' '));
        };
        document.addEventListener('close', flush, true);
        return () => document.removeEventListener('close', flush, true);
    }, [announce]);

    useEffect(() => {
        const region = regionRef.current;
        if (!region) return;
        const supportsPopover = typeof region.showPopover === 'function';
        if (!supportsPopover) return;
        if (toasts.length > 0 && !shownRef.current) {
            region.showPopover();
            shownRef.current = true;
        } else if (toasts.length === 0 && shownRef.current) {
            region.hidePopover();
            shownRef.current = false;
        }
    }, [toasts.length]);

    const dismiss = useCallback((id: number) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ push }}>
            {children}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>
            <div
                ref={regionRef}
                popover="manual"
                role="region"
                aria-label="Notifications"
                className="oc-toast-region"
            >
                {toasts.map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}
