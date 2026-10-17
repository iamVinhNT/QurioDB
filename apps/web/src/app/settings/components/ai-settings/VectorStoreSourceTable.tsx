/**
 * @file VectorStoreSourceTable.tsx
 * @description Accessible source rows with sorting, inspection and removal actions.
 */

import { formatDistanceToNow } from "date-fns";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { RagSource } from "./vector-store-map-graph";
import {
  parseServerTimestamp,
  readableSourceType,
} from "./vector-store-overview";

export interface SourceSort {
  key: "title" | "indexed";
  ascending: boolean;
}

export function VectorStoreSourceTable({
  sources,
  databaseLabels,
  selectedId,
  deletingSourceId,
  sort,
  onSort,
  onInspect,
  onDelete,
}: {
  sources: RagSource[];
  databaseLabels: Record<string, string>;
  selectedId: string;
  deletingSourceId?: string | null;
  sort: SourceSort;
  onSort: (key: SourceSort["key"]) => void;
  onInspect: (id: string) => void;
  onDelete: (source: RagSource) => void;
}) {
  return (
    <Table className="table-fixed" aria-label="Vector store sources">
      <TableHeader>
        <TableRow>
          <TableHead
            className="w-[34%] pl-4"
            aria-sort={
              sort.key === "title"
                ? sort.ascending
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <button
              className="flex items-center gap-1 rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onSort("title")}
            >
              Source
              {sort.key === "title" ? (
                sort.ascending ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )
              ) : null}
            </button>
          </TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead
            aria-sort={
              sort.key === "indexed"
                ? sort.ascending
                  ? "ascending"
                  : "descending"
                : "none"
            }
          >
            <button
              className="flex items-center gap-1 rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onSort("indexed")}
            >
              Indexed
              {sort.key === "indexed" ? (
                sort.ascending ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )
              ) : null}
            </button>
          </TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((source) => {
          const indexed = parseServerTimestamp(source.indexed_on);
          const databaseLabel = source.databaseId
            ? databaseLabels[source.databaseId] || "Removed connection"
            : "Shared knowledge";
          return (
            <TableRow
              key={source.id}
              data-state={selectedId === source.id ? "selected" : undefined}
            >
              <TableCell className="py-1.5 pl-4">
                <button
                  className="block w-full min-w-0 rounded-sm py-0.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Inspect ${source.title} (${databaseLabel})`}
                  onClick={() => onInspect(source.id)}
                >
                  <span
                    className="block truncate text-sm font-medium"
                    title={source.title}
                  >
                    {source.title}
                  </span>
                  <span
                    className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                    title={source.databaseId || undefined}
                  >
                    {databaseLabel}
                  </span>
                </button>
              </TableCell>
              <TableCell
                className="hidden truncate text-muted-foreground md:table-cell"
                title={readableSourceType(source.sourceType)}
              >
                {readableSourceType(source.sourceType)}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    "max-w-full truncate rounded-md text-[11px]",
                    source.status === "indexed"
                      ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/25 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {source.status}
                </Badge>
              </TableCell>
              <TableCell
                className="whitespace-normal text-[11px] text-muted-foreground"
                title={indexed?.toLocaleString()}
              >
                {indexed
                  ? formatDistanceToNow(indexed, { addSuffix: true })
                  : "Not indexed"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={Boolean(deletingSourceId)}
                  onClick={() => onDelete(source)}
                  aria-label={`Remove ${source.title} (${databaseLabel})`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
