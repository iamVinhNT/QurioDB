/**
 * @file VectorStoreSourceList.tsx
 * @description Filterable list of indexed RAG sources with inline inspection and confirmed removal.
 */

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Loader2, Search, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { aiApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { readableSourceType, type RagSource, type RagSourceDetail } from "./vector-store-map-graph";
import { SourceInspector, sourceTypeCounts } from "./VectorStoreMapNodes";
import { parseServerTimestamp } from "./vector-store-overview";

const ALL_TYPES = "__all__";

interface VectorStoreSourceListProps {
  sources: RagSource[];
  databaseLabels: Record<string, string>;
  isLoading?: boolean;
  deletingSourceId?: string | null;
  onDeleteSource: (source: RagSource) => Promise<unknown>;
}

export function VectorStoreSourceList({
  sources,
  databaseLabels,
  isLoading,
  deletingSourceId,
  onDeleteSource,
}: VectorStoreSourceListProps) {
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [expandedSourceId, setExpandedSourceId] = useState("");
  const [sourcePendingDelete, setSourcePendingDelete] = useState<RagSource | null>(null);

  const typeOptions = useMemo(() => sourceTypeCounts(sources), [sources]);
  const filteredSources = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return sources.filter((source) => {
      if (typeFilter !== ALL_TYPES && source.sourceType !== typeFilter) return false;
      if (!needle) return true;
      const databaseLabel = source.databaseId ? databaseLabels[source.databaseId] || source.databaseId : "";
      return `${source.title} ${databaseLabel}`.toLowerCase().includes(needle);
    });
  }, [databaseLabels, searchText, sources, typeFilter]);

  const confirmDelete = async () => {
    if (!sourcePendingDelete) return;
    try {
      await onDeleteSource(sourcePendingDelete);
      if (expandedSourceId === sourcePendingDelete.id) setExpandedSourceId("");
      setSourcePendingDelete(null);
    } catch {
      // The caller reports the failure; keep the dialog open so the user can retry or cancel.
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border/50 bg-background/60">
      <div className="flex flex-col gap-3 border-b border-border/50 p-4 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search sources by title or database"
            className="h-9 rounded-lg pl-9 text-xs"
            aria-label="Search vector store sources"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(String(value || ALL_TYPES))}>
          <SelectTrigger className="h-9 w-full rounded-lg text-xs md:w-56" aria-label="Filter sources by type">
            <span className="flex-1 truncate text-left">
              {typeFilter === ALL_TYPES ? "All source types" : readableSourceType(typeFilter)}
            </span>
          </SelectTrigger>
          <SelectContent align="end" className="rounded-xl p-1">
            <SelectItem value={ALL_TYPES} className="rounded-lg">All source types ({sources.length})</SelectItem>
            {typeOptions.map((option) => (
              <SelectItem key={option.type} value={option.type} className="rounded-lg">
                {readableSourceType(option.type)} ({option.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="shrink-0 text-[11px] font-semibold text-muted-foreground tabular-nums">
          {filteredSources.length} of {sources.length}
        </div>
      </div>

      <div className="space-y-2 p-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredSources.length ? (
          filteredSources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              databaseLabels={databaseLabels}
              isExpanded={expandedSourceId === source.id}
              isDeleting={deletingSourceId === source.id}
              onToggle={() => setExpandedSourceId((current) => (current === source.id ? "" : source.id))}
              onDelete={() => setSourcePendingDelete(source)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 py-8 text-center text-sm text-muted-foreground">
            {sources.length ? "No sources match these filters." : "No sources indexed yet. Sync a database above or add sources under RAG Index."}
          </div>
        )}
      </div>

      <Dialog open={Boolean(sourcePendingDelete)} onOpenChange={(open) => !open && setSourcePendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Remove source from the vector store?</DialogTitle>
            <DialogDescription>
              This deletes <span className="font-semibold text-foreground">{sourcePendingDelete?.title}</span> with
              its chunks and embeddings. The assistant stops retrieving it until it is indexed again.
              Your database and files are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourcePendingDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={Boolean(deletingSourceId)}
              onClick={confirmDelete}
            >
              {deletingSourceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SourceRow({
  source,
  databaseLabels,
  isExpanded,
  isDeleting,
  onToggle,
  onDelete,
}: {
  source: RagSource;
  databaseLabels: Record<string, string>;
  isExpanded: boolean;
  isDeleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["rag-source-detail", source.id],
    queryFn: () => aiApi.getRagSource(source.id),
    enabled: isExpanded,
  });
  const indexedOn = parseServerTimestamp(source.indexed_on);
  const isIndexed = source.status === "indexed";
  const scopeLabel = source.databaseId
    ? databaseLabels[source.databaseId] || source.databaseId
    : source.accessScope || "global";

  return (
    <div className="rounded-lg border border-border/50 bg-background/70">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Hide" : "Inspect"} ${source.title}`}
        >
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", isIndexed ? "bg-emerald-500" : "bg-amber-500")}
            title={source.status}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" title={source.title}>{source.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span>{readableSourceType(source.sourceType)}</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
              <span className="truncate">{scopeLabel}</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
              <span title={indexedOn?.toLocaleString()}>
                {indexedOn ? `Indexed ${formatDistanceToNow(indexedOn, { addSuffix: true })}` : "Not indexed yet"}
              </span>
            </span>
          </span>
          {!isIndexed ? (
            <Badge variant="outline" className="shrink-0 rounded-md border-amber-500/30 text-[10px] font-bold text-amber-600">
              {source.status}
            </Badge>
          ) : null}
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={isDeleting}
          aria-label={`Remove ${source.title}`}
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
      {isExpanded ? (
        <div className="border-t border-border/40 p-3">
          <SourceInspector
            source={source}
            detail={detailQuery.data as RagSourceDetail | undefined}
            databaseLabels={databaseLabels}
            isLoading={detailQuery.isFetching}
          />
        </div>
      ) : null}
    </div>
  );
}
