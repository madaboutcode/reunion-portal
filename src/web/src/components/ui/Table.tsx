import type { ReactNode } from "react";

// ── Column ─────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  /** e.g. "120px", "20%" */
  width?: string;
  /** Extra classes applied to <td> cells */
  className?: string;
}

// ── DataTable ──────────────────────────────────────────────────────────────

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  className?: string;
  header?: ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data",
  className,
  header,
}: DataTableProps<T>) {
  const isClickable = Boolean(onRowClick);

  return (
    <div
      className={[
        "bg-surface",
        "border border-border-warm",
        "rounded-2xl",
        "overflow-hidden",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)" }}
    >
      {header && (
        <div className="px-4 py-3 border-b border-border-warm flex items-center justify-between">
          {header}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#FAFAF8]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left font-heading text-xs font-bold text-muted uppercase tracking-wider"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={[
                    rowIndex < data.length - 1 ? "border-b border-border" : "",
                    isClickable ? "cursor-pointer hover:bg-[#FDF8F5]" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={isClickable ? () => onRowClick!(item) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        "px-4 py-3.5 text-sm text-charcoal",
                        col.className,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.render(item)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
