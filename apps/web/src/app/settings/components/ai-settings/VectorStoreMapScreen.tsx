/**
 * @file VectorStoreMapScreen.tsx
 * @description AI settings screen for the RAG vector store: status overview, database sync, source management, and graph map.
 */

import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
    <div className="space-y-4">
      <VectorStoreStatusPanel
        vectorStatus={statusQuery.data?.vectorStore}
        overview={overview}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        hasError={hasError}
        syncingDatabaseId={
          syncDatabaseMutation.isPending
            ? syncDatabaseMutation.variables?.databaseId
            : null
        }
        syncResults={syncResults}
        onRefresh={refreshMap}
        onSyncDatabase={(coverage) => syncDatabaseMutation.mutate(coverage)}
        onAddSources={onAddSources}
        mapTriggerRef={mapTriggerRef}
        onOpenMap={() => {
          setMapSourceId("");
          setIsMapOpen(true);
        }}
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
    </div>
  );
}
