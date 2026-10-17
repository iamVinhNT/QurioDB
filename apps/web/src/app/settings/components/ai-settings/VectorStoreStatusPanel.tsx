/**
 * @file VectorStoreStatusPanel.tsx
 * @description At-a-glance Vector Store status, index totals, and per-database sync coverage for AI settings.
 */

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FilePlus2,
  HardDrive,
  Layers3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RagVectorStatus } from "./vector-store-map-graph";
import type { VectorStoreDatabaseCoverage, VectorStoreOverview } from "./vector-store-overview";

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
}: VectorStoreStatusPanelProps) {
  const isEnabled = vectorStatus?.enabled !== false;
  const connectedDatabases = overview.databases.filter((entry) => entry.isConnected);
  const coveredDatabases = connectedDatabases.filter((entry) => entry.sourceCount > 0).length;

  return (
    <section className="overflow-hidden rounded-lg border border-border/50 bg-background/60">
      <div className="flex flex-col gap-4 border-b border-border/50 p-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
            <HardDrive className="h-5 w-5 text-amber-500" />
          </div>
          <div className="min-w-0 space-y-2">
            <div>
              <div className="truncate text-base font-bold">Vector Store</div>
              <div className="text-xs text-muted-foreground">
                Local retrieval index the AI Assistant searches to ground its answers.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "h-7 gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-widest",
                  isEnabled
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-600",
                )}
              >
                {isEnabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {isEnabled ? "Retrieval enabled" : "Retrieval disabled"}
              </Badge>
              <Badge variant="outline" className="h-7 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-widest">
                {vectorStatus?.backend || "sqlite_vec"}
                <span className="text-muted-foreground">
                  / {vectorStatus?.requiresExternalService ? "external" : "local"}
                </span>
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onAddSources ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 rounded-lg text-[11px] font-black uppercase tracking-widest"
              onClick={onAddSources}
            >
              <FilePlus2 className="h-4 w-4" />
              Add sources
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  aria-label="Refresh vector store status"
                >
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                </Button>
              }
            />
            <TooltipContent>Refresh status</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!isEnabled ? (
        <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Retrieval is turned off by the <code className="font-mono">QURIODB_RAG_ENABLED</code> setting.
            Sync requests return without indexing new content.
          </span>
        </div>
      ) : null}

      {hasError ? (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some vector store data could not be loaded. Refresh to try again.</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Layers3}
          label="Sources"
          value={isLoading ? "…" : String(overview.totalSources)}
          detail={
            overview.notIndexedSources > 0
              ? `${overview.indexedSources} indexed, ${overview.notIndexedSources} not indexed`
              : `${overview.sourceTypeCount} source type${overview.sourceTypeCount === 1 ? "" : "s"}`
          }
          tone={overview.notIndexedSources > 0 ? "warning" : "default"}
        />
        <StatTile
          icon={Database}
          label="Databases covered"
          value={isLoading ? "…" : `${coveredDatabases} / ${connectedDatabases.length}`}
          detail={
            overview.globalSources > 0
              ? `${overview.globalSources} source${overview.globalSources === 1 ? "" : "s"} not tied to a database`
              : "Connections with at least one source"
          }
          tone={connectedDatabases.length > 0 && coveredDatabases < connectedDatabases.length ? "warning" : "default"}
        />
        <StatTile
          icon={Clock}
          label="Last indexed"
          value={isLoading ? "…" : relativeTime(overview.lastIndexedOn)}
          detail={absoluteTime(overview.lastIndexedOn) || "Nothing indexed yet"}
        />
        <StatTile
          icon={Clock}
          label="Oldest source"
          value={isLoading ? "…" : relativeTime(overview.oldestIndexedOn)}
          detail={absoluteTime(overview.oldestIndexedOn) || "Nothing indexed yet"}
        />
      </div>

      <div className="border-t border-border/50 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            Database sync
          </div>
          <div className="text-[11px] text-muted-foreground">
            Sync re-indexes the schema and saved queries. Query history is opt-in under RAG Index.
          </div>
        </div>

        {connectedDatabases.length === 0 && overview.databases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-5 text-center text-sm text-muted-foreground">
            {isLoading ? "Loading connections…" : "No database connections yet. Add a connection to index its schema."}
          </div>
        ) : (
          <div className="space-y-2">
            {overview.databases.map((coverage) => (
              <DatabaseCoverageRow
                key={coverage.databaseId}
                coverage={coverage}
                isSyncing={syncingDatabaseId === coverage.databaseId}
                isSyncDisabled={!isEnabled || Boolean(syncingDatabaseId)}
                syncResult={syncResults[coverage.databaseId]}
                onSync={() => onSyncDatabase(coverage)}
              />
            ))}
          </div>
        )}
      </div>
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
          <span className="truncate text-sm font-bold" title={coverage.label}>{coverage.label}</span>
          {!coverage.isConnected ? (
            <Badge variant="outline" className="rounded-md border-destructive/30 text-[10px] font-bold text-destructive">
              Connection removed
            </Badge>
          ) : isIndexed ? (
            <Badge variant="outline" className="rounded-md border-emerald-500/30 text-[10px] font-bold text-emerald-600">
              {coverage.sourceCount} source{coverage.sourceCount === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="outline" className="rounded-md border-amber-500/30 text-[10px] font-bold text-amber-600">
              Not indexed
            </Badge>
          )}
          {coverage.notIndexedCount > 0 ? (
            <Badge variant="outline" className="rounded-md border-amber-500/30 text-[10px] font-bold text-amber-600">
              {coverage.notIndexedCount} not indexed
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {coverage.isConnected ? <span>Schema: {schemas.join(", ")}</span> : <span>Remove its sources from the list below.</span>}
          {coverage.lastIndexedOn ? (
            <span title={absoluteTime(coverage.lastIndexedOn) || undefined}>
              Indexed {relativeTime(coverage.lastIndexedOn)}
            </span>
          ) : null}
          {syncResult ? (
            <span className={cn(syncResult.chunks > 0 && syncResult.embeddings === 0 && "text-amber-600")}>
              Last sync: {syncResult.chunks} chunks, {syncResult.embeddings} embeddings
              {syncResult.chunks > 0 && syncResult.embeddings === 0 ? " (no embeddings created)" : ""}
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
          {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {isSyncing ? "Syncing" : isIndexed ? "Re-sync" : "Index now"}
        </Button>
      ) : null}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-background/70 px-3 py-3",
        tone === "warning" ? "border-amber-500/30" : "border-border/50",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 truncate text-xl font-black tabular-nums">{value}</div>
      <div className={cn("mt-0.5 truncate text-[11px]", tone === "warning" ? "text-amber-600" : "text-muted-foreground")} title={detail}>
        {detail}
      </div>
    </div>
  );
}

function relativeTime(date: Date | null) {
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "Never";
}

function absoluteTime(date: Date | null) {
  return date ? date.toLocaleString() : "";
}
