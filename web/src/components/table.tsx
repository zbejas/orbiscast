import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './feedback';

export interface TableColumn<T> {
    key: string;
    header: ReactNode;
    cell: (row: T, index: number) => ReactNode;
    /** Label shown before the cell value when the table stacks on narrow containers. */
    stackedLabel?: string;
    className?: string;
    headerClassName?: string;
}

interface TableProps<T> {
    caption: string;
    columns: TableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string | number;
    rowHeaderKey?: string;
    isRowSelected?: (row: T) => boolean;
    empty?: ReactNode;
    className?: string;
}

/**
 * Semantic data table with a sticky header, a keyboard-scrollable region, and
 * a container-query stacked card layout below 600px. Header semantics survive
 * the stacked layout; labels are injected as pseudo content from data-label.
 */
export function Table<T>({
    caption,
    columns,
    rows,
    rowKey,
    rowHeaderKey,
    isRowSelected,
    empty,
    className,
}: TableProps<T>) {
    const captionId = useId();
    return (
        <div
            role="region"
            aria-labelledby={captionId}
            tabIndex={0}
            className={cn('oc-table-wrapper', className)}
        >
            <table className="oc-table">
                <caption id={captionId} className="sr-only">
                    {caption}
                </caption>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column.key} scope="col" className={column.headerClassName}>
                                {column.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && empty !== undefined ? (
                        <tr>
                            <td colSpan={columns.length}>{empty}</td>
                        </tr>
                    ) : (
                        rows.map((row, index) => (
                            <tr
                                key={rowKey(row)}
                                data-selected={isRowSelected?.(row) ? 'true' : undefined}
                            >
                                {columns.map((column) => {
                                    const content = column.cell(row, index);
                                    const stackedLabel =
                                        column.stackedLabel ??
                                        (typeof column.header === 'string' ? column.header : undefined);
                                    if (column.key === rowHeaderKey) {
                                        return (
                                            <th
                                                key={column.key}
                                                scope="row"
                                                className={column.className}
                                            >
                                                {content}
                                            </th>
                                        );
                                    }
                                    return (
                                        <td
                                            key={column.key}
                                            data-label={stackedLabel}
                                            className={column.className}
                                        >
                                            {content}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
    return (
        <div className="space-y-2 p-4" aria-hidden="true">
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-4">
                    {Array.from({ length: columns }).map((__, columnIndex) => (
                        <Skeleton
                            key={columnIndex}
                            className={cn('h-4', columnIndex === 0 ? 'w-1/3' : 'flex-1')}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}
