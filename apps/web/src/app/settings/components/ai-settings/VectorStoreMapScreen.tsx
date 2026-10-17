/**
 * @file VectorStoreMapScreen.tsx
 * @description AI settings screen for the RAG vector store: status overview, database sync, source management, and graph map.
 */

import { useMemo, useState } from "react";
import { List, Network } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { aiApi, databaseApi } from "@/lib/api-client";
import { VectorStoreMap } from "./VectorStoreMap";
import { VectorStoreSourceList } from "./VectorStoreSourceList";
import { VectorStoreStatusPanel, type VectorStoreSyncSummary } from "./VectorStoreStatusPanel";
import type { RagPipelineStatus, RagSource } from "./vector-store-map-graph";
import { buildVectorStoreOverview, type VectorStoreDatabaseCoverage } from "./vector-store-overview";

type VectorStoreView = "sources" | "map";

interface RagSyncResponse {
  summary?: {
    chunks?: number;
    embeddings?: number;
    indexedSources?: number;
  };
}

const viewOptions: Array<{ view: VectorStoreView; label: string; icon: typeof List }> = [
  { view: "sources", label: "Sources", icon: List },
  { view: "map", label: "Map", icon: Network },
];

const getDatabaseLabel = (database: any) => database.databaseName || database.name || database.id;

interface VectorStoreMapScreenProps {
  onAddSources?: () => void;
}

export function VectorStoreMapScreen({ onAddSources }: VectorStoreMapScreenProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<VectorStoreView>("sources");
  const [syncResults, setSyncResults] = useState<Record<string, VectorStoreSyncSummary>>({});

  const statusQuery = useQuery({
    queryKey: ["rag-status"],
    queryFn: () => aiApi.getRagStatus(),
  });

  const pipelineStatusQuery = useQuery({
    queryKey: ["rag-pipeline-status"],
    queryFn: () => aiApi.getRagPipelineStatus(),
  });

  const sourcesQuery = useQuery({
    queryKey: ["rag-sources"],
    queryFn: () => aiApi.getRagSources(),
  });

  const databasesQuery = useQuery({
    queryKey: ["databases"],
    queryFn: () => databaseApi.list(),
  });

  const sources = useMemo(() => (sourcesQuery.data || []) as RagSource[], [sourcesQuery.data]);
  const databaseOptions = useMemo(
    () => (databasesQuery.data || []).map((database: any) => ({ id: database.id, label: getDatabaseLabel(database) })),
    [databasesQuery.data],
  );
  const databaseLabels = useMemo(
    () => Object.fromEntries(databaseOptions.map((database: { id: string; label: string }) => [database.id, database.label])),
    [databaseOptions],
  );
  const overview = useMemo(() => buildVectorStoreOverview(sources, databaseOptions), [databaseOptions, sources]);

  const queries = [statusQuery, pipelineStatusQuery, sourcesQuery, databasesQuery];
  const isLoading = queries.some((query) => query.isLoading);
  const isRefreshing = !isLoading && queries.some((query) => query.isFetching);
  const hasError = queries.some((query) => query.isError);

  const refreshMap = () => {
    queryClient.invalidateQueries({ queryKey: ["rag-sources"] });
    queryClient.invalidateQueries({ queryKey: ["rag-status"] });
    queryClient.invalidateQueries({ queryKey: ["rag-pipeline-status"] });
    queryClient.invalidateQueries({ queryKey: ["rag-source-detail"] });
    queryClient.invalidateQueries({ queryKey: ["databases"] });
  };

  const syncDatabaseMutation = useMutation({
    mutationFn: async (coverage: VectorStoreDatabaseCoverage) => {
      const schemas = coverage.schemas.length ? coverage.schemas : ["public"];
      const totals = { chunks: 0, embeddings: 0, indexedSources: 0 };
      // One request per indexed schema; saved queries are database-wide, so index them once.
      for (const [index, schema] of schemas.entries()) {
        const result = await aiApi.syncRagDatabase(coverage.databaseId, {
          schema_name: schema,
          includeSavedQueries: index === 0,
          includeQueryHistory: false,
        }) as RagSyncResponse;
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
      toast.success(`Synced ${coverage.label}: ${totals.chunks} chunks, ${totals.embeddings} embeddings.`);
    },
    onError: (err: any, coverage) => toast.error(`Sync failed for ${coverage.label}: ${err.message}`),
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
    <div className="space-y-4">
      <VectorStoreStatusPanel
        vectorStatus={statusQuery.data?.vectorStore}
        overview={overview}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        hasError={hasError}
        syncingDatabaseId={syncDatabaseMutation.isPending ? syncDatabaseMutation.variables?.databaseId : null}
        syncResults={syncResults}
        onRefresh={refreshMap}
        onSyncDatabase={(coverage) => syncDatabaseMutation.mutate(coverage)}
        onAddSources={onAddSources}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          Indexed content
        </div>
        <div className="inline-flex rounded-lg border border-border/50 bg-muted/20 p-1" role="group" aria-label="Indexed content view">
          {viewOptions.map((option) => {
            const Icon = option.icon;
            return (
              <Button
                key={option.view}
                type="button"
                variant={view === option.view ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-2 rounded-md px-3 text-[11px] font-black uppercase tracking-widest"
                aria-pressed={view === option.view}
                onClick={() => setView(option.view)}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>

      {view === "sources" ? (
        <VectorStoreSourceList
          sources={sources}
          databaseLabels={databaseLabels}
          isLoading={sourcesQuery.isLoading}
          deletingSourceId={deleteSourceMutation.isPending ? deleteSourceMutation.variables?.id : null}
          onDeleteSource={(source) => deleteSourceMutation.mutateAsync(source)}
        />
      ) : (
        <VectorStoreMap
          vectorStatus={statusQuery.data?.vectorStore}
          pipelineStatus={pipelineStatusQuery.data as RagPipelineStatus | undefined}
          sources={sources}
          databaseLabels={databaseLabels}
          isLoading={isLoading}
          onRefresh={refreshMap}
        />
      )}
    </div>
  );
}
