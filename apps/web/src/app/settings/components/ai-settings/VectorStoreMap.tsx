/**
 * @file VectorStoreMap.tsx
 * @description Dialog-sized source map with a stable graph, optional inspector and minimap.
 */

import { type MouseEvent, useEffect, useMemo, useState } from "react";
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Map, RefreshCw, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/lib/api-client";
import {
  buildVectorStoreGraph,
  type RagSource,
  type RagSourceDetail,
  type RagVectorStatus,
  type VectorStoreGraphNode,
  type VectorStoreGraphNodeData,
} from "./vector-store-map-graph";
import { miniMapColor, RagVectorNode } from "./VectorStoreMapNodes";
import { SourceInspector } from "./VectorStoreSourceInspector";

interface VectorStoreMapProps {
  vectorStatus?: RagVectorStatus;
  sources: RagSource[];
  databaseLabels?: Record<string, string>;
  initialSourceId?: string;
  isLoading?: boolean;
  onRefresh: () => void;
}

const nodeTypes = { ragVector: RagVectorNode };

export function VectorStoreMap({
  vectorStatus,
  sources,
  databaseLabels = {},
  initialSourceId = "",
  isLoading,
  onRefresh,
}: VectorStoreMapProps) {
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [selectedId, setSelectedId] = useState(initialSourceId);
  const [flow, setFlow] =
    useState<ReactFlowInstance<VectorStoreGraphNode> | null>(null);
  const { theme, resolvedTheme } = useTheme();
  const colorMode = (resolvedTheme || theme || "light") as "light" | "dark";
  const selectedSource = sources.find((source) => source.id === selectedId);
  const detailQuery = useQuery({
    queryKey: ["rag-source-detail", selectedId],
    queryFn: () => aiApi.getRagSource(selectedId),
    enabled: Boolean(selectedSource),
  });
  // Selection only updates the inspector. Expanding chunks must not rebuild or displace the map.
  const graph = useMemo(
    () =>
      buildVectorStoreGraph({
        mode: "store",
        vectorStatus,
        sources,
        databaseLabels,
      }),
    [vectorStatus, sources, databaseLabels],
  );
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        selected: node.id === `source:${selectedId}`,
      })),
    [graph.nodes, selectedId],
  );

  useEffect(() => {
    if (!flow) return;
    // Let the dialog and optional inspector settle before fitting the measured nodes.
    const frame = requestAnimationFrame(() => {
      void flow.fitView({
        nodes: selectedSource
          ? [{ id: `source:${selectedSource.id}` }]
          : undefined,
        padding: 0.15,
        minZoom: 0.65,
        maxZoom: 1,
        duration: 200,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, graph.nodes, selectedSource]);

  const handleNodeClick = (
    _event: MouseEvent,
    node: Node<VectorStoreGraphNodeData>,
  ) => {
    if (node.data.kind === "source")
      setSelectedId(node.id.replace(/^source:/, ""));
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-w-0 flex-1" aria-label="Source graph">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.65, maxZoom: 1 }}
          minZoom={0.5}
          maxZoom={2}
          colorMode={colorMode}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          onInit={setFlow}
          onNodeClick={handleNodeClick}
        >
          <Background
            gap={24}
            size={1}
            color={
              colorMode === "dark"
                ? "rgba(255,255,255,0.10)"
                : "rgba(0,0,0,0.10)"
            }
          />
          {showMiniMap ? (
            <MiniMap
              pannable
              zoomable
              ariaLabel="Source map overview"
              nodeColor={(node) =>
                miniMapColor((node as VectorStoreGraphNode).data.kind)
              }
              // MiniMap derives its SVG geometry from style, not CSS classes.
              style={{ width: 160, height: 112 }}
              bgColor={colorMode === "dark" ? "#0f172a" : "#f8fafc"}
              maskColor={colorMode === "dark" ? "#02061799" : "#cbd5e180"}
              maskStrokeColor={colorMode === "dark" ? "#94a3b8" : "#64748b"}
              maskStrokeWidth={1}
              className="overflow-hidden rounded-md shadow-sm ring-1 ring-border/50"
            />
          ) : null}
          <Controls
            showInteractive={false}
            aria-label="Source map controls"
            className="bg-background! border-border! [&_button]:bg-background! [&_button]:text-foreground! [&_button[aria-pressed=true]]:bg-accent! [&_button[aria-pressed=true]]:text-accent-foreground!"
            fitViewOptions={{ minZoom: 0.65, maxZoom: 1, padding: 0.15 }}
          >
            <ControlButton
              aria-label="Toggle minimap"
              title="Toggle minimap"
              aria-pressed={showMiniMap}
              onClick={() => setShowMiniMap((visible) => !visible)}
            >
              <Map className="fill-none!" />
            </ControlButton>
            <ControlButton
              aria-label="Refresh source map"
              title="Refresh source map"
              onClick={onRefresh}
            >
              <RefreshCw className="fill-none!" />
            </ControlButton>
          </Controls>
        </ReactFlow>
        {isLoading ? (
          <div
            className="absolute inset-0 flex items-center justify-center bg-background/70"
            role="status"
          >
            <Loader2
              className="h-6 w-6 animate-spin"
              aria-label="Loading sources"
            />
          </div>
        ) : !sources.length ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-center text-sm text-muted-foreground">
            No sources yet. Add a source or sync a database to explore it here.
          </div>
        ) : null}
        <div className="pointer-events-none absolute bottom-3 left-14 right-3 text-[11px] text-muted-foreground">
          Drag to pan · Scroll to zoom · Select a source for its chunks
        </div>
      </div>
      {selectedSource ? (
        <aside
          className="absolute inset-y-0 right-0 z-10 flex min-h-0 w-80 max-w-[90%] flex-col border-l border-border/60 bg-background shadow-lg sm:static sm:shrink-0 sm:shadow-none"
          aria-label="Map source details"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-2">
            <h4 className="text-sm font-medium">Source details</h4>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Close map source details"
              onClick={() => setSelectedId("")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
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
        </aside>
      ) : null}
    </div>
  );
}
