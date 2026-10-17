/**
 * @file VectorStoreMapScreen.tsx
 * @description AI settings screen for the RAG vector store: status overview, database sync, source management, and graph map.
 */

import { lazy, Suspense, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  HardDrive,
  Loader2,
  Network,
  RefreshCw,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { aiApi, databaseApi } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VectorStoreSourceList } from "./VectorStoreSourceList";
import {
  VectorStoreStatusPanel,
  type VectorStoreSyncSummary,
} from "./VectorStoreStatusPanel";
import type { RagSource } from "./vector-store-map-graph";
import {
  buildVectorStoreOverview,
  type VectorStoreDatabaseCoverage,
} from "./vector-store-overview";

const VectorStoreMap = lazy(() =>
  import("./VectorStoreMap").then((module) => ({
    default: module.VectorStoreMap,
  })),
);

interface RagSyncResponse {
  summary?: {
    chunks?: number;
    embeddings?: number;
    indexedSources?: number;
  };
}

const getDatabaseLabel = (database: any) =>
  database.databaseName || database.name || database.id;

interface VectorStoreMapScreenProps {
  onAddSources?: () => void;
}

export function VectorStoreMapScreen({
  onAddSources,
}: VectorStoreMapScreenProps) {
  const queryClient = useQueryClient();
  const mapTriggerRef = useRef<HTMLButtonElement>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapSourceId, setMapSourceId] = useState("");
  const [syncResults, setSyncResults] = useState<
    Record<string, VectorStoreSyncSummary>
  >({});

  const statusQuery = useQuery({
    queryKey: ["rag-status"],
    queryFn: () => aiApi.getRagStatus(),
  });

  const sourcesQuery = useQuery({
    queryKey: ["rag-sources"],
    queryFn: () => aiApi.getRagSources(),
  });

  const databasesQuery = useQuery({
    queryKey: ["databases"],
    queryFn: () => databaseApi.list(),
  });

  const sources = useMemo(
    () => (sourcesQuery.data || []) as RagSource[],
    [sourcesQuery.data],
  );
  const databaseOptions = useMemo(
    () =>
      (databasesQuery.data || []).map((database: any) => ({
        id: database.id,
        label: getDatabaseLabel(database),
      })),
    [databasesQuery.data],
  );
  const databaseLabels = useMemo(
    () =>
      Object.fromEntries(
        databaseOptions.map((database: { id: string; label: string }) => [
          database.id,
          database.label,
        ]),
      ),
    [databaseOptions],
  );
  const overview = useMemo(
    () => buildVectorStoreOverview(sources, databaseOptions),
    [databaseOptions, sources],
  );

  const queries = [statusQuery, sourcesQuery, databasesQuery];
  const isLoading = queries.some((query) => query.isLoading);
  const isRefreshing = !isLoading && queries.some((query) => query.isFetching);
  const hasError = queries.some((query) => query.isError);
  const vectorStatus = statusQuery.data?.vectorStore;

  const refreshMap = () => {
    queryClient.invalidateQueries({ queryKey: ["rag-sources"] });
    queryClient.invalidateQueries({ queryKey: ["rag-status"] });
    queryClient.invalidateQueries({ queryKey: ["rag-source-detail"] });
    queryClient.invalidateQueries({ queryKey: ["databases"] });
  };

  const syncDatabaseMutation = useMutation({
    mutationFn: async (coverage: VectorStoreDatabaseCoverage) => {
      const schemas = coverage.schemas.length ? coverage.schemas : ["public"];
      const totals = { chunks: 0, embeddings: 0, indexedSources: 0 };
      // One request per indexed schema; saved queries are database-wide, so index them once.
      for (const [index, schema] of schemas.entries()) {
        const result = (await aiApi.syncRagDatabase(coverage.databaseId, {
          schema_name: schema,
          includeSavedQueries: index === 0,
          includeQueryHistory: false,
        })) as RagSyncResponse;
        totals.chunks += result.summary?.chunks || 0;
        totals.embeddings += result.summary?.embeddings || 0;
        totals.indexedSources += result.summary?.indexedSources || 0;
      }
      return totals;
    },
    onSuccess: (totals, coverage) => {
      setSyncResults((current) => ({
        ...current,
        [coverage.databaseId]: { ...totals, completedAt: new Date() },
      }));
      toast.success(
        `Synced ${coverage.label}: ${totals.chunks} chunks, ${totals.embeddings} embeddings.`,
      );
    },
    onError: (err: any, coverage) =>
      toast.error(`Sync failed for ${coverage.label}: ${err.message}`),
    onSettled: refreshMap,
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (source: RagSource) => aiApi.deleteRagSource(source.id),
    onSuccess: (_result, source) => {
      toast.success(`Removed "${source.title}" from the vector store.`);
      refreshMap();
    },
    onError: (err: any) => toast.error(`Source removal failed: ${err.message}`),
  });

  return (
    <Card className="group/card relative border-none bg-card/50 shadow-premium backdrop-blur-sm">
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-amber-500 to-orange-600 transition-all group-hover/card:w-1.5" />
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 shadow-sm">
              <HardDrive
                className="h-5 w-5 text-amber-500"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 data-slot="card-title" className="text-xl font-bold">
                  Vector Store
                </h3>
                <Badge
                  variant="outline"
                  className={
                    vectorStatus?.enabled
                      ? "rounded-md border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-400"
                      : "rounded-md text-[11px]"
                  }
                >
                  {isLoading
                    ? "Loading…"
                    : !vectorStatus
                      ? "Status unavailable"
                      : vectorStatus.enabled
                        ? "Retrieval enabled"
                        : "Retrieval disabled"}
                </Badge>
              </div>
              <CardDescription>
                Knowledge the AI Assistant searches to help answer your
                questions.
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onAddSources ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onAddSources}
              >
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                Add source
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              ref={mapTriggerRef}
              onClick={() => {
                setMapSourceId("");
                setIsMapOpen(true);
              }}
            >
              <Network className="h-4 w-4" aria-hidden="true" />
              Open map
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={refreshMap}
              disabled={isRefreshing || isLoading}
              aria-label="Refresh vector store status"
            >
              <RefreshCw
                className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2 md:p-5 md:pt-2">
        <VectorStoreStatusPanel
          vectorStatus={vectorStatus}
          overview={overview}
          isLoading={isLoading}
          hasError={hasError}
          syncingDatabaseId={
            syncDatabaseMutation.isPending
              ? syncDatabaseMutation.variables?.databaseId
              : null
          }
          syncResults={syncResults}
          onSyncDatabase={(coverage) => syncDatabaseMutation.mutate(coverage)}
        />

        <VectorStoreSourceList
          sources={sources}
          databaseLabels={databaseLabels}
          isLoading={sourcesQuery.isLoading}
          hasError={sourcesQuery.isError}
          deletingSourceId={
            deleteSourceMutation.isPending
              ? deleteSourceMutation.variables?.id
              : null
          }
          onDeleteSource={(source) => deleteSourceMutation.mutateAsync(source)}
          onOpenMap={(source) => {
            setMapSourceId(source.id);
            setIsMapOpen(true);
          }}
        />
      </CardContent>
      <Dialog open={isMapOpen} onOpenChange={setIsMapOpen}>
        <DialogContent
          finalFocus={mapTriggerRef}
          className="flex h-[94dvh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b border-border/50 px-5 py-4 pr-14">
            <DialogTitle className="text-base font-semibold">
              Source map
            </DialogTitle>
            <DialogDescription>
              Explore how sources are organized. Select a source to inspect its
              chunks.
            </DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Loader2
                  className="h-6 w-6 animate-spin"
                  aria-label="Loading map"
                />
              </div>
            }
          >
            {isMapOpen ? (
              <VectorStoreMap
                vectorStatus={statusQuery.data?.vectorStore}
                sources={sources}
                databaseLabels={databaseLabels}
                initialSourceId={mapSourceId}
                isLoading={isLoading}
                onRefresh={refreshMap}
              />
            ) : null}
          </Suspense>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
