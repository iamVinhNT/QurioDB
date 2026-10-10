/**
 * @file SchemaVisualizer.tsx
 * @description Schema diagram with compact detail levels, stable layout, and in-place fullscreen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Table, Maximize2, Minimize2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { TableNode } from "./schemavisualizer/TableNode";
import { LARGE_SCHEMA_THRESHOLD } from "./schemavisualizer/graph";
import { useSchemaGraphModel } from "./schemavisualizer/useSchemaGraphModel";
import { HubLinksToggle } from "./schemavisualizer/HubLinksToggle";
import type {
  DetailLevel,
  ForeignKey,
  SchemaColumn,
  TableFlowNode,
} from "./schemavisualizer/types";

const nodeTypes = { table: TableNode };
const detailOptions: { value: DetailLevel; label: string }[] = [
  { value: "name", label: "Name only" },
  { value: "keys", label: "Keys" },
  { value: "all", label: "All columns" },
];
const fitViewOptions = { minZoom: 0.05, maxZoom: 1, padding: 0.15 };

type SchemaVisualizerProps = {
  tables: string[];
  columns: Record<string, SchemaColumn[]>;
  foreignKeys: ForeignKey[];
  databaseName?: string;
};

export function SchemaVisualizer({
  tables,
  columns,
  foreignKeys,
  databaseName,
}: SchemaVisualizerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [detailOverride, setDetailOverride] = useState<DetailLevel | null>(
    null,
  );
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance<
    TableFlowNode,
    Edge
  > | null>(null);
  const [showHubLinks, setShowHubLinks] = useState(false);
  const flowRef = useRef<ReactFlowInstance<TableFlowNode, Edge> | null>(null);
  const onInit = useCallback(
    (instance: ReactFlowInstance<TableFlowNode, Edge>) => {
      flowRef.current = instance;
      setFlow(instance);
    },
    [],
  );
  const onFocusTable = useCallback((tableName: string) => {
    setHoveredTable(null);
    setSelectedTable(tableName);
    void flowRef.current?.fitView({
      nodes: [{ id: tableName }],
      padding: 0.3,
      duration: 300,
      maxZoom: 1,
    });
  }, []);
  const { theme, resolvedTheme } = useTheme();
  const currentTheme = (resolvedTheme || theme) === "dark" ? "dark" : "light";
  const detailLevel =
    detailOverride ?? (tables.length > LARGE_SCHEMA_THRESHOLD ? "keys" : "all");

  const { nodes, edges, styledEdges, hubs, hubLinkCount, hiddenHubCount } =
    useSchemaGraphModel({
      tables,
      columns,
      foreignKeys,
      detailLevel,
      showHubLinks,
      selectedTable,
      hoveredTable,
      onFocusTable,
    });

  const selectedNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.id === selectedTable ? { ...node, selected: true } : node,
      ),
    [nodes, selectedTable],
  );
  useEffect(() => {
    setHoveredTable(null);
    setSelectedTable(null);
    setDetailOverride(null);
    setShowHubLinks(false);
  }, [tables]);

  useEffect(() => {
    if (!isFullscreen) return;
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", exitFullscreen);
    return () => document.removeEventListener("keydown", exitFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    if (!flow || !nodes.length) return;
    const frame = requestAnimationFrame(() => {
      void flow.fitView(fitViewOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, nodes, isFullscreen]);

  if (!tables.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-12 text-center">
        <Table className="h-12 w-12 mb-6" />
        <p className="text-sm font-semibold">No Tables Found</p>
        <p className="text-xs mt-2">
          Select a schema to visualize its structure.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 bg-background"
          : "w-full h-full bg-background relative overflow-hidden"
      }
    >
      <div className="absolute top-3 right-3 left-3 z-10 flex flex-wrap justify-end items-center gap-2 pointer-events-none">
        <span className="text-[10px] bg-background border border-border rounded px-2 py-1 truncate max-w-40">
          {databaseName || "Database"}
        </span>
        <div
          role="group"
          aria-label="Column detail"
          className="flex bg-background border border-border rounded pointer-events-auto"
        >
          {detailOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              aria-pressed={detailLevel === option.value}
              onClick={() => setDetailOverride(option.value)}
              className={`px-2 py-1.5 text-[10px] rounded focus-visible:outline-2 focus-visible:outline-primary ${detailLevel === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {hubs.size > 0 && (
          <HubLinksToggle
            hubs={hubs}
            count={hubLinkCount}
            shown={showHubLinks}
            onToggle={() => setShowHubLinks((value) => !value)}
          />
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 bg-background pointer-events-auto"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          onClick={() => setIsFullscreen((value) => !value)}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>
      <ReactFlow<TableFlowNode, Edge>
        nodes={selectedNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.05}
        onlyRenderVisibleElements
        nodesConnectable={false}
        elevateEdgesOnSelect={false}
        onInit={onInit}
        colorMode={currentTheme}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, node) => setHoveredTable(node.id)}
        onNodeMouseLeave={() => setHoveredTable(null)}
        onNodeClick={(_, node) => setSelectedTable(node.id)}
        onPaneClick={() => setSelectedTable(null)}
        panActivationKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={
            currentTheme === "dark"
              ? "rgba(255,255,255,0.15)"
              : "rgba(0,0,0,0.2)"
          }
        />
        <Controls className="bg-background border border-border fill-foreground!" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 100, height: 70 }}
          nodeColor="var(--muted-foreground)"
          bgColor="var(--background)"
          maskColor="var(--muted)"
        />
      </ReactFlow>
      <div className="absolute bottom-3 left-14 z-10 bg-background border border-border rounded px-2 py-1 text-[10px] text-muted-foreground pointer-events-none">
        {tables.length} {tables.length === 1 ? "Table" : "Tables"} ·{" "}
        {edges.length} {edges.length === 1 ? "Link" : "Links"}
        {hiddenHubCount > 0 && (
          <span className="opacity-70">
            {" "}
            (+{hiddenHubCount} hub links hidden)
          </span>
        )}
      </div>
    </div>
  );
}
