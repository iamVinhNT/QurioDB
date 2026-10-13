/**
 * @file SQLLabHistoryPanel.tsx
 * @description Panel showing the history of executed SQL queries.
 */

import {
  Clock,
  Database,
  Play,
  CheckCircle2,
  XCircle,
  Search,
  Calendar,
  Copy,
  Loader2,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { databaseApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState, useRef, useId } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useSQLLabContext } from "../context/SQLLabContext";

export function SQLLabHistoryPanel() {
  const lab = useSQLLabContext();
  return (
    <DatabaseHistoryPanel
      key={lab.selectedDS}
      databaseId={lab.selectedDS}
      databaseName={lab.selectedDSName}
    />
  );
}

function DatabaseHistoryPanel({
  databaseId,
  databaseName,
}: {
  databaseId: string;
  databaseName: string;
}) {
  const lab = useSQLLabContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sessionId = useId();
  const queryClient = useQueryClient();
  const isDeleting =
    useIsMutating({ mutationKey: ["deleteHistory", databaseId] }) > 0;

  const {
    data,
    isLoading,
    isFetching,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // Each search/refresh/selection starts at offset zero, including returning to a previous search/database.
    queryKey: ["history", databaseId, searchTerm.trim(), sessionId, revision],
    queryFn: ({ pageParam }) =>
      databaseApi.getHistoryPage(databaseId, {
        q: searchTerm.trim(),
        limit: 50,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextOffset ?? undefined) : undefined,
    enabled: !!databaseId,
    gcTime: 0,
  });

  const deleteMutation = useMutation({
    mutationKey: ["deleteHistory", databaseId],
    mutationFn: (selectedDatabaseId: string) =>
      databaseApi.deleteHistory(selectedDatabaseId),
    onSuccess: async ({ deletedCount }, selectedDatabaseId) => {
      // Cancel earlier GETs so they cannot restore history after deletion, even after database switches.
      await queryClient.cancelQueries({
        queryKey: ["history", selectedDatabaseId],
      });
      await queryClient.resetQueries({
        queryKey: ["history", selectedDatabaseId],
      });
      toast.success(
        `Deleted ${deletedCount} history entries for database ${selectedDatabaseId}`,
      );
    },
    onError: (error, selectedDatabaseId) => {
      toast.error(
        `Could not delete history for database ${selectedDatabaseId}: ${error.message}`,
      );
    },
  });
  const filteredHistory = data?.pages.flatMap((page) => page.items) ?? [];
  const isLegacy = data?.pages.some((page) => page.legacy);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredHistory?.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("SQL copied to clipboard");
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-black uppercase tracking-widest">
            Query History
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh history"
            disabled={!databaseId || isFetching || isDeleting}
            onClick={() => setRevision((value) => value + 1)}
            className="h-8 w-8 p-0"
          >
            <Clock className="h-4 w-4 opacity-50" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive"
            aria-label="Delete history"
            disabled={!databaseId || isDeleting}
            onClick={() => {
              deleteMutation.reset();
              setConfirmDelete(true);
            }}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Breadcrumb - Matches ObjectPanel style */}
      <div className="flex items-center h-10 px-5 bg-background border-b text-[10px] text-muted-foreground/60 gap-2 shrink-0 font-bold uppercase tracking-tight">
        <Database className="h-3.5 w-3.5 opacity-40 shrink-0" />
        <span className="text-foreground/80 truncate">
          {lab.selectedSchema || "public"}
        </span>
      </div>

      {/* Search */}
      <div className="p-3 border-b bg-muted/5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search history..."
            aria-label="Search history"
            disabled={!databaseId || isDeleting}
            className="pl-8 h-8 text-[11px] font-medium bg-background border-none focus-visible:ring-1 focus-visible:ring-primary/20"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setRevision((value) => value + 1);
            }}
          />
        </div>
      </div>

      {isLegacy && (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          Older backend: only the latest 50 entries are searchable. Update the
          backend to search all history and load more.
        </p>
      )}
      {(error || deleteMutation.error) && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {deleteMutation.error
            ? `Could not delete history: ${deleteMutation.error.message}`
            : `Could not load history: ${error?.message}`}
        </p>
      )}

      {/* List */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {!databaseId ? (
          <p className="p-4 text-xs text-muted-foreground">
            Select a database to view query history.
          </p>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 opacity-20">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              Loading History
            </span>
          </div>
        ) : filteredHistory.length > 0 ? (
          <div
            className="divide-y divide-border/40 relative w-full"
            style={{ height: `${totalSize}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const item = filteredHistory[virtualRow.index];
              const createdOn = item.created_on
                ? new Date(item.created_on)
                : null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  className="p-4 hover:bg-muted/30 transition-all group border-l-2 border-transparent hover:border-primary absolute top-0 left-0 w-full"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {item.status === "SUCCESS" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="text-[10px] font-black flex items-center gap-1.5 uppercase tracking-tighter text-foreground/70">
                          <Database className="h-3 w-3 opacity-40 text-blue-500" />
                          {item.database.databaseName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-2.5 w-2.5" />
                          {createdOn && !Number.isNaN(createdOn.getTime())
                            ? formatDistanceToNow(createdOn, {
                                addSuffix: true,
                              })
                            : "Unknown time"}
                        </span>
                        <span>•</span>
                        <span>
                          {item.executionTime == null
                            ? "—"
                            : `${item.executionTime}ms`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => copyToClipboard(item.sql)}
                        title="Copy SQL"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary"
                        onClick={() => {
                          lab.setSql(item.sql);
                          toast.info("SQL loaded from history");
                        }}
                        title="Open in Editor"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="relative mt-2">
                    <pre className="text-[11px] font-mono p-3 bg-muted/40 rounded-lg overflow-hidden line-clamp-3 text-muted-foreground/80 group-hover:text-foreground/90 transition-colors border border-transparent group-hover:border-border/60">
                      {item.sql}
                    </pre>
                  </div>

                  {item.errorMessage && (
                    <p className="mt-2 text-[10px] text-red-500/80 font-medium italic line-clamp-1 border-l-2 border-red-500/20 pl-2">
                      {item.errorMessage}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : error ? null : (
          <div className="flex flex-col items-center justify-center h-64 p-12 text-center gap-6 opacity-10">
            <Clock className="h-16 w-16" />
            <p className="text-xs font-black uppercase tracking-[0.3em]">
              No Query History
            </p>
          </div>
        )}
      </div>
      {hasNextPage && (
        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isFetching || isDeleting}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading more…" : "Load more"}
          </Button>
        </div>
      )}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete query history?</DialogTitle>
            <DialogDescription>
              This permanently deletes all query history for database{" "}
              {databaseName ? `${databaseName} (${databaseId})` : databaseId},
              including entries outside the current search. This affects
              database health stats and AI context built from query history.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!databaseId || isDeleting}
              onClick={() => {
                if (!databaseId || isDeleting) return;
                setConfirmDelete(false);
                deleteMutation.mutate(databaseId);
              }}
            >
              Delete all history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
