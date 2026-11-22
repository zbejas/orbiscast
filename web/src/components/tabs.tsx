import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
    id: string;
    label: string;
    badge?: ReactNode;
}

interface TabsProps {
    items: TabItem[];
    value: string;
    onChange: (id: string) => void;
    label: string;
    children?: ReactNode;
    className?: string;
}

/**
 * Segmented Material tabs with roving tabindex and arrow, Home, and End navigation.
 */
export function Tabs({ items, value, onChange, label, children, className }: TabsProps) {
    const baseId = useId();
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const focusTab = (index: number) => {
        const next = items[index];
        if (!next) return;
        onChange(next.id);
        tabRefs.current[next.id]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let target = index;
        if (event.key === 'ArrowRight') target = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft') target = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = items.length - 1;
        else return;
        event.preventDefault();
        focusTab(target);
    };

    const active = items.find((item) => item.id === value) ?? items[0];

    return (
        <div className={cn('min-w-0', className)}>
            <div
                role="tablist"
                aria-label={label}
                className="oc-tablist flex gap-1 overflow-x-auto overflow-y-hidden rounded-full border border-outline-variant bg-surface-container p-1"
            >
                {items.map((item, index) => {
                    const selected = item.id === active?.id;
                    return (
                        <button
                            key={item.id}
                            ref={(element) => {
                                tabRefs.current[item.id] = element;
                            }}
                            type="button"
                            role="tab"
                            id={`${baseId}-tab-${item.id}`}
                            aria-selected={selected}
                            aria-controls={children ? `${baseId}-panel` : undefined}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onChange(item.id)}
                            onKeyDown={(event) => handleKeyDown(event, index)}
                            className={cn(
                                'oc-control oc-tab inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                                selected
                                    ? 'bg-primary-container text-on-primary-container shadow-e1'
                                    : 'text-text-muted hover:bg-text/10 hover:text-text'
                            )}
                        >
                            {item.label}
                            {item.badge}
                        </button>
                    );
                })}
            </div>
            {children && active ? (
                <div
                    role="tabpanel"
                    id={`${baseId}-panel`}
                    aria-labelledby={`${baseId}-tab-${active.id}`}
                    className="pt-5"
                >
                    {children}
                </div>
            ) : null}
        </div>
    );
}
