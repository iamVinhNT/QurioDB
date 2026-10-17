/**
 * @file VectorStoreSourceList.tsx
 * @description Filterable source table with a detail sheet and confirmed removal, preserving list state while the map is open.
 */

import { useMemo, useState } from "react";
import { Loader2, Network, Search, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { aiApi } from "@/lib/api-client";
import type { RagSource, RagSourceDetail } from "./vector-store-map-graph";
import {
  VectorStoreSourceTable,
  type SourceSort,
} from "./VectorStoreSourceTable";
import { SourceInspector } from "./VectorStoreSourceInspector";
import {
  parseServerTimestamp,
  readableSourceType,
} from "./vector-store-overview";

const ALL = "__all__";
const SHARED = "__shared__";
const REMOVED = "__removed__";

interface VectorStoreSourceListProps {
  sources: RagSource[];
  databaseLabels: Record<string, string>;
  isLoading?: boolean;
  hasError?: boolean;
  deletingSourceId?: string | null;
  onDeleteSource: (source: RagSource) => Promise<unknown>;
  onOpenMap: (source: RagSource) => void;
}

export function VectorStoreSourceList({
  sources,
  databaseLabels,
  isLoading,
  hasError,
  deletingSourceId,
  onDeleteSource,
  onOpenMap,
}: VectorStoreSourceListProps) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState(ALL);
  const [database, setDatabase] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [sort, setSort] = useState<SourceSort>({
    key: "indexed",
    ascending: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RagSource | null>(null);
  const selectedSource = sources.find((source) => source.id === selectedId);
  const detailQuery = useQuery({
    queryKey: ["rag-source-detail", selectedId],
    queryFn: () => aiApi.getRagSource(selectedId),
    enabled: isInspectorOpen && Boolean(selectedSource),
  });
  const types = [...new Set(sources.map((source) => source.sourceType))].sort();
  const statuses = [...new Set(sources.map((source) => source.status))].sort();
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sources
      .filter((source) => {
        if (type !== ALL && source.sourceType !== type) return false;
        if (status !== ALL && source.status !== status) return false;
        if (database === SHARED && source.databaseId) return false;
        if (
          database === REMOVED &&
          (!source.databaseId || databaseLabels[source.databaseId])
        )
          return false;
        if (
          ![ALL, SHARED, REMOVED].includes(database) &&
          source.databaseId !== database
        )
          return false;
        return (
          !needle ||
          `${source.title} ${source.databaseId ? databaseLabels[source.databaseId] || source.databaseId : "Shared knowledge"}`
            .toLowerCase()
            .includes(needle)
        );
      })
      .sort((left, right) => {
        const comparison =
          sort.key === "title"
            ? left.title.localeCompare(right.title)
            : (parseServerTimestamp(left.indexed_on)?.getTime() || 0) -
              (parseServerTimestamp(right.indexed_on)?.getTime() || 0);
        return (
          (sort.ascending ? comparison : -comparison) ||
          left.id.localeCompare(right.id)
        );
      });
  }, [sources, databaseLabels, search, type, database, status, sort]);
  const hasFilters = Boolean(
    search || type !== ALL || database !== ALL || status !== ALL,
  );
  const toggleSort = (key: "title" | "indexed") =>
    setSort((current) => ({
      key,
      ascending: current.key === key ? !current.ascending : key === "title",
    }));
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await onDeleteSource(pendingDelete);
      if (selectedId === pendingDelete.id) setSelectedId("");
      setPendingDelete(null);
    } catch {
      // The caller reports the failure. Keep the confirmation open for retry.
    }
  };

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/60 bg-background/60"
      aria-label="Indexed sources"
    >
      <div className="space-y-3 border-b border-border/50 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">Sources</h3>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {isLoading ? "Loading…" : `${filtered.length} of ${sources.length}`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Sources are schemas, queries or documents. Each is split into
          searchable sections called chunks.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by source name or database…"
              aria-label="Search vector store sources"
              className="pl-9"
            />
          </div>
          <SourceFilter
            label="Database"
            value={database}
            onChange={setDatabase}
            options={[
              { value: ALL, label: "All databases" },
              ...Object.entries(databaseLabels)
                .sort(([, a], [, b]) => a.localeCompare(b))
                .map(([value, label]) => ({ value, label })),
              { value: SHARED, label: "Shared knowledge" },
              { value: REMOVED, label: "Removed connections" },
            ]}
          />
          <SourceFilter
            label="Source type"
            value={type}
            onChange={setType}
            options={[
              { value: ALL, label: "All types" },
              ...types.map((value) => ({
                value,
                label: readableSourceType(value),
              })),
            ]}
          />
          <SourceFilter
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: ALL, label: "All statuses" },
              ...statuses.map((value) => ({ value, label: value })),
            ]}
          />
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDatabase(ALL);
                setType(ALL);
                setStatus(ALL);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>
      <VectorStoreSourceTable
        sources={filtered}
        databaseLabels={databaseLabels}
        selectedId={selectedId}
        deletingSourceId={deletingSourceId}
        sort={sort}
        onSort={toggleSort}
        onInspect={(id) => {
          setSelectedId(id);
          setIsInspectorOpen(true);
        }}
        onDelete={setPendingDelete}
      />
      {isLoading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sources…
        </div>
      ) : !filtered.length ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {hasError
            ? "Sources could not be loaded. Refresh to try again."
            : sources.length
              ? "No sources match these filters."
              : "No sources yet. Add a source or expand Database sync to index a connection."}
        </p>
      ) : null}

      <Sheet
        open={isInspectorOpen && Boolean(selectedSource)}
        onOpenChange={setIsInspectorOpen}
      >
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="shrink-0 border-b border-border/50 pr-12">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle>Source details</SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Show in map"
                title="Show in map"
                onClick={() => {
                  if (!selectedSource) return;
                  setIsInspectorOpen(false);
                  onOpenMap(selectedSource);
                }}
              >
                <Network className="h-4 w-4" />
              </Button>
            </div>
            <SheetDescription className="sr-only">
              Inspect indexed content and its searchable chunks.
            </SheetDescription>
          </SheetHeader>
          {selectedSource ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SourceInspector
                key={selectedSource.id}
                source={selectedSource}
                detail={detailQuery.data as RagSourceDetail | undefined}
                databaseLabels={databaseLabels}
                isLoading={detailQuery.isFetching}
                hasError={detailQuery.isError}
                onRetry={() => {
                  void detailQuery.refetch();
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) =>
          !open && !deletingSourceId && setPendingDelete(null)
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove source from the vector store?</DialogTitle>
            <DialogDescription>
              This removes{" "}
              <strong className="text-foreground">
                {pendingDelete?.title}
              </strong>{" "}
              and its chunks and embeddings. The assistant stops retrieving it
              until indexed again. Your database and files are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(deletingSourceId)}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(deletingSourceId)}
              onClick={confirmDelete}
            >
              {deletingSourceId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SourceFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => onChange(String(value || ALL))}
    >
      <SelectTrigger
        className="h-8 w-auto min-w-28 max-w-52 text-xs"
        aria-label={`Filter sources by ${label.toLowerCase()}`}
      >
        <span className="truncate">
          {options.find((option) => option.value === value)?.label}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
