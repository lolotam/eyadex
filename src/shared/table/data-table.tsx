import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  /** Table min width; the table then scrolls horizontally inside its own frame. */
  minWidthClass?: string;
  /** Column kept pinned at the inline end while scrolling (e.g. row actions). */
  stickyEndColumnId?: string;
};

const STICKY_END = "sticky end-0 z-10 bg-card shadow-[inset_1px_0_0_var(--border)]";

export function DataTable<T>({
  columns,
  data,
  isLoading,
  onRowClick,
  minWidthClass,
  stickyEndColumnId,
}: Props<T>) {
  const { t } = useI18n();
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="max-w-full overflow-hidden rounded-lg border bg-card">
      <Table className={minWidthClass}>
        <TableHeader className="bg-muted/70">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "text-start",
                    header.column.id === stickyEndColumnId && cn(STICKY_END, "bg-muted"),
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <LoadingBlock />
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-muted-foreground"
              >
                {t("common.noResults")}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={onRowClick ? "cursor-pointer" : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.id === stickyEndColumnId ? STICKY_END : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
