/**
 * @file VectorStoreStatusPanel.tsx
 * @description Compact retrieval summary and expandable database sync controls for AI settings.
 */

import type { RefObject } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  Database,
  FilePlus2,
  HardDrive,
  Loader2,
  Network,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RagVectorStatus } from "./vector-store-map-graph";
import type {
  VectorStoreDatabaseCoverage,
  VectorStoreOverview,
} from "./vector-store-overview";

export interface VectorStoreSyncSummary {
  chunks: number;
  embeddings: number;
  indexedSources: number;
  completedAt: Date;
}

interface VectorStoreStatusPanelProps {
  vectorStatus?: RagVectorStatus;
  overview: VectorStoreOverview;
  isLoading?: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  syncingDatabaseId?: string | null;
  syncResults: Record<string, VectorStoreSyncSummary>;
  onRefresh: () => void;
  onSyncDatabase: (coverage: VectorStoreDatabaseCoverage) => void;
  onAddSources?: () => void;
  onOpenMap: () => void;
  mapTriggerRef?: RefObject<HTMLButtonElement | null>;
}

export function VectorStoreStatusPanel({
  vectorStatus,
  overview,
  isLoading,
  isRefreshing,
  hasError,
  syncingDatabaseId,
  syncResults,
  onRefresh,
  onSyncDatabase,
  onAddSources,
  onOpenMap,
  mapTriggerRef,
}: VectorStoreStatusPanelProps) {
  const isEnabled = vectorStatus?.enabled === true;
  const connected = overview.databases.filter((entry) => entry.isConnected);
  const covered = connected.filter((entry) => entry.sourceCount > 0).length;
  const needsIndexing = connected.filter(
    (entry) => !entry.sourceCount || entry.notIndexedCount > 0,
  ).length;
  const removed = overview.databases.filter(
    (entry) => !entry.isConnected,
  ).length;

  return (
    <section
      className="rounded-xl border border-border/60 bg-background/60"
      aria-label="Vector store overview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400">
            <HardDrive className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">Vector Store</h3>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-md text-[11px]",
                  isEnabled &&
                    "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
                )}
              >
                {isLoading
                  ? "Loading…"
                  : !vectorStatus
                    ? "Status unavailable"
                    : isEnabled
                      ? "Retrieval enabled"
                      : "Retrieval disabled"}
              </Badge>
            </div>
            <p className="mt-1 max-w-lg text-xs text-muted-foreground">
              Knowledge the AI Assistant searches to help answer your questions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onAddSources ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onAddSources}
            >
              <FilePlus2 className="h-4 w-4" />
              Add source
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            ref={mapTriggerRef}
            onClick={onOpenMap}
          >
            <Network className="h-4 w-4" />
            Open map
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isRefreshing || isLoading}
            aria-label="Refresh vector store status"
          >
            <RefreshCw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
          </Button>
        </div>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span>
          <strong className="font-semibold text-foreground">
            {isLoading ? "…" : overview.totalSources}
          </strong>{" "}
          sources
        </span>
        <span>
          <strong className="font-semibold text-foreground">
            {isLoading ? "…" : overview.indexedSources}
          </strong>{" "}
          indexed
        </span>
        <span>
          <strong className="font-semibold text-foreground">
            {isLoading ? "…" : `${covered}/${connected.length}`}
          </strong>{" "}
          databases with sources
        </span>
        <span title={absoluteTime(overview.lastIndexedOn)}>
          Last indexed: {isLoading ? "…" : relativeTime(overview.lastIndexedOn)}
        </span>
        <details className="ml-auto">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            Storage details
          </summary>
          <div className="mt-2 space-y-1">
            <p>
              Backend: {vectorStatus?.backend || "Unavailable"} ·{" "}
              {vectorStatus?.requiresExternalService
                ? "External service"
                : "Local storage"}
            </p>
            <p>Oldest source: {relativeTime(overview.oldestIndexedOn)}</p>
            <p>{overview.globalSources} sources without a database</p>
          </div>
        </details>
      </div>
      {!isLoading && vectorStatus?.enabled === false ? (
        <p
          role="status"
          className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
        >
          Retrieval is disabled. Syncing will not index new content.
        </p>
      ) : null}
      {hasError ? (
        <p
          role="alert"
          className="flex items-center gap-2 border-t border-destructive/20 px-4 py-3 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Some vector store data could not be loaded. Refresh to try again.
        </p>
      ) : null}
      <details className="group border-t border-border/40">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-b-xl px-4 py-3 text-xs focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Database sync</span>
          <span className="text-muted-foreground">
            {isLoading
              ? "Loading…"
              : needsIndexing
                ? `${needsIndexing} need indexing`
                : connected.length
                  ? "All connections have indexed sources"
                  : "No connections"}
            {removed > 0
              ? ` · ${removed} removed connection${removed === 1 ? "" : "s"}`
              : ""}
          </span>
          {syncingDatabaseId ? (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing…
            </span>
          ) : null}
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-border/40 p-3">
          <p className="px-1 pb-1 text-xs text-muted-foreground">
            Sync updates schema and saved queries. Query history is opt-in under
            RAG Index.
          </p>
          {overview.databases.length ? (
            overview.databases.map((coverage) => (
              <DatabaseCoverageRow
                key={coverage.databaseId}
                coverage={coverage}
                isSyncing={syncingDatabaseId === coverage.databaseId}
                isSyncDisabled={!isEnabled || Boolean(syncingDatabaseId)}
                syncResult={syncResults[coverage.databaseId]}
                onSync={() => onSyncDatabase(coverage)}
              />
            ))
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              {isLoading
                ? "Loading connections…"
                : "Add a database connection to index its schema."}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

function DatabaseCoverageRow({
  coverage,
  isSyncing,
  isSyncDisabled,
  syncResult,
  onSync,
}: {
  coverage: VectorStoreDatabaseCoverage;
  isSyncing: boolean;
  isSyncDisabled: boolean;
  syncResult?: VectorStoreSyncSummary;
  onSync: () => void;
}) {
  const isIndexed = coverage.sourceCount > 0;
  const schemas = coverage.schemas.length ? coverage.schemas : ["public"];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-bold" title={coverage.label}>
            {coverage.label}
          </span>
          {!coverage.isConnected ? (
            <Badge
              variant="outline"
              className="rounded-md border-destructive/30 text-[10px] font-bold text-destructive"
            >
              Connection removed
            </Badge>
          ) : isIndexed ? (
            <Badge
              variant="outline"
              className="rounded-md border-emerald-500/30 text-[10px] font-bold text-emerald-600"
            >
              {coverage.sourceCount} source
              {coverage.sourceCount === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="rounded-md border-amber-500/30 text-[10px] font-bold text-amber-600"
            >
              Not indexed
            </Badge>
          )}
          {coverage.notIndexedCount > 0 ? (
            <Badge
              variant="outline"
              className="rounded-md border-amber-500/30 text-[10px] font-bold text-amber-600"
            >
              {coverage.notIndexedCount} not indexed
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {coverage.isConnected ? (
            <span>Schema: {schemas.join(", ")}</span>
          ) : (
            <span>Remove its sources from the list below.</span>
          )}
          {coverage.lastIndexedOn ? (
            <span title={absoluteTime(coverage.lastIndexedOn) || undefined}>
              Indexed {relativeTime(coverage.lastIndexedOn)}
            </span>
          ) : null}
          {syncResult ? (
            <span
              className={cn(
                syncResult.chunks > 0 &&
                  syncResult.embeddings === 0 &&
                  "text-amber-600",
              )}
            >
              Last sync: {syncResult.chunks} chunks, {syncResult.embeddings}{" "}
              embeddings
              {syncResult.chunks > 0 && syncResult.embeddings === 0
                ? " (no embeddings created)"
                : ""}
            </span>
          ) : null}
        </div>
      </div>

      {coverage.isConnected ? (
        <Button
          type="button"
          variant={isIndexed ? "outline" : "default"}
          size="sm"
          className="h-8 shrink-0 gap-2 self-start rounded-lg text-[10px] font-black uppercase tracking-widest md:self-center"
          disabled={isSyncDisabled}
          onClick={onSync}
          aria-label={`${isIndexed ? "Re-sync" : "Index"} ${coverage.label}`}
        >
          {isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {isSyncing ? "Syncing" : isIndexed ? "Re-sync" : "Index now"}
        </Button>
      ) : null}
    </div>
  );
}

function relativeTime(date: Date | null) {
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "Never";
}

function absoluteTime(date: Date | null) {
  return date ? date.toLocaleString() : "";
}
