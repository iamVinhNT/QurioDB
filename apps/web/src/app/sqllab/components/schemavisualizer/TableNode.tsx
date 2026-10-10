/**
 * @file TableNode.tsx
 * @description Memoized table card with bounded scrolling and selectable column detail.
 */
import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Table, KeyRound, Link2, Circle } from "lucide-react";
import {
  getVisibleColumns,
  HEADER_HEIGHT,
  MAX_VISIBLE_ROWS,
  ROW_HEIGHT,
  FOOTER_HEIGHT,
} from "./graph";
import { useTableLod } from "./useTableLod";
import type { TableNodeData } from "./types";

export const TableNode = memo(function TableNode({
  data,
  selected,
}: NodeProps<Node<TableNodeData, "table">>) {
  const isCompact = useTableLod();
  const visibleColumns = isCompact ? [] : getVisibleColumns(data);
  const hiddenCount = data.columns.length - visibleColumns.length;
  return (
    <div
      data-lod={isCompact ? "compact" : "full"}
      className={`h-full flex flex-col bg-background border rounded-lg overflow-hidden ${selected ? "border-primary" : "border-border"}`}
    >
      <div
        className="bg-primary/5 px-3 border-b border-border flex items-center gap-2"
        style={{ height: HEADER_HEIGHT - 2 }}
      >
        <Table className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span
          className="font-semibold text-xs text-foreground truncate"
          title={data.label}
        >
          {data.label}
        </span>
        {data.hubIncomingCount !== undefined && (
          <span
            className="text-[9px] text-muted-foreground shrink-0"
            title={`Referenced by ${data.hubIncomingCount} tables`}
          >
            Referenced by {data.hubIncomingCount}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {data.columns.length} columns
        </span>
      </div>
      {isCompact ? (
        <div data-lod-body className="flex-1" aria-hidden="true" />
      ) : (
        data.detailLevel !== "name" && (
          <>
            <div
              className="nowheel nodrag overflow-y-auto p-1"
              style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT + 8 }}
            >
              {visibleColumns.map((column) => {
                const isKey =
                  column.primary_key ||
                  data.referencedColumns.includes(column.name);
                const isForeignKey = data.foreignKeyColumns.includes(
                  column.name,
                );
                const hiddenHub = isForeignKey
                  ? data.hiddenHubColumns?.get(column.name)
                  : undefined;
                const Icon = isKey ? KeyRound : isForeignKey ? Link2 : Circle;
                return (
                  <div
                    key={column.name}
                    className="flex items-center gap-2 px-2"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <Icon
                      data-column-role={
                        isKey ? "key" : isForeignKey ? "foreign-key" : "column"
                      }
                      aria-label={
                        isKey
                          ? "Primary or referenced key"
                          : isForeignKey
                            ? "Foreign key"
                            : "Column"
                      }
                      className={`h-3 w-3 shrink-0 ${isKey ? "text-amber-500" : isForeignKey ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span
                      className="text-[11px] text-foreground truncate"
                      title={column.name}
                    >
                      {column.name}
                    </span>
                    {hiddenHub ? (
                      <button
                        type="button"
                        className="nodrag nopan text-[9px] text-muted-foreground ml-auto min-w-0 max-w-32 truncate rounded bg-muted px-1"
                        title={`→ ${hiddenHub}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          data.onFocusTable?.(hiddenHub);
                        }}
                      >
                        → {hiddenHub}
                      </button>
                    ) : (
                      <span
                        className="text-[9px] text-muted-foreground ml-auto truncate"
                        title={column.type}
                      >
                        {column.type}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <div
                className="px-3 text-[10px] text-muted-foreground border-t border-border flex items-center"
                style={{ height: FOOTER_HEIGHT }}
              >
                +{hiddenCount} more columns
              </div>
            )}
          </>
        )
      )}
      <Handle
        type="target"
        position={Position.Left}
        className="w-1.5! h-1.5! bg-muted-foreground! border-background!"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-1.5! h-1.5! bg-muted-foreground! border-background!"
      />
    </div>
  );
});
