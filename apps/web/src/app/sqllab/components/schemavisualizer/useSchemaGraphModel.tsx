/**
 * @file useSchemaGraphModel.tsx
 * @description Memoized hub folding layout and focus-only edge presentation.
 */
import { useMemo } from "react";
import type { Edge } from "@xyflow/react";
import { getLayoutedElements } from "./layout";
import {
  findHubTables,
  getHiddenHubColumns,
  getKeyColumns,
  preprocessEdges,
  splitHubEdges,
  LARGE_SCHEMA_THRESHOLD,
} from "./graph";
import type {
  DetailLevel,
  ForeignKey,
  SchemaColumn,
  TableFlowNode,
} from "./types";
export const MAX_LABELLED_EDGES = 12;

const emptyColumns = new Map<string, string>();
type GraphOptions = {
  tables: string[];
  columns: Record<string, SchemaColumn[]>;
  foreignKeys: ForeignKey[];
  detailLevel: DetailLevel;
  showHubLinks: boolean;
  selectedTable: string | null;
  hoveredTable: string | null;
  onFocusTable: (table: string) => void;
};
export function useSchemaGraphModel({
  tables,
  columns,
  foreignKeys,
  detailLevel,
  showHubLinks,
  selectedTable,
  hoveredTable,
  onFocusTable,
}: GraphOptions) {
  const graph = useMemo(() => {
    const edges = preprocessEdges(tables, foreignKeys);
    const hubs =
      tables.length > LARGE_SCHEMA_THRESHOLD
        ? findHubTables(edges)
        : new Map<string, number>();
    return {
      edges,
      hubs,
      ...splitHubEdges(edges, hubs),
      keys: getKeyColumns(tables, foreignKeys),
    };
  }, [tables, foreignKeys]);
  const isFolded = graph.hubs.size > 0 && !showHubLinks;
  const { nodes, edges } = useMemo(() => {
    const hiddenColumns = getHiddenHubColumns(isFolded ? graph.hubEdges : []);
    const rawNodes: TableFlowNode[] = tables.map((tableName) => ({
      id: tableName,
      type: "table",
      position: { x: 0, y: 0 },
      data: {
        label: tableName,
        columns: columns[tableName] || [],
        detailLevel,
        foreignKeyColumns: Array.from(graph.keys.foreign.get(tableName) || []),
        referencedColumns: Array.from(
          graph.keys.referenced.get(tableName) || [],
        ),
        hiddenHubColumns: hiddenColumns.get(tableName) || emptyColumns,
        hubIncomingCount: graph.hubs.get(tableName),
        onFocusTable,
      },
    }));
    return getLayoutedElements(
      rawNodes,
      isFolded ? graph.regularEdges : graph.edges,
    );
  }, [tables, columns, graph, detailLevel, isFolded, onFocusTable]);
  const styledEdges = useMemo(() => {
    const names = new Set(tables);
    const selected =
      selectedTable && names.has(selectedTable) ? selectedTable : null;
    const hovered =
      hoveredTable && names.has(hoveredTable) ? hoveredTable : null;
    const active = hovered || selected;
    const incident = (edge: Edge, table: string | null) =>
      table !== null && (edge.source === table || edge.target === table);
    const extraEdges = isFolded
      ? graph.hubEdges.filter(
          (edge) =>
            incident(edge, selected) ||
            (hovered !== null &&
              !graph.hubs.has(hovered) &&
              incident(edge, hovered)),
        )
      : [];
    const visibleEdges = [...edges, ...extraEdges];
    const isHighlighted = (edge: Edge) =>
      incident(edge, active) || (isFolded && incident(edge, selected));
    const hasDenseFocus =
      visibleEdges.filter(isHighlighted).length > MAX_LABELLED_EDGES;
    return visibleEdges.map((edge) => {
      const highlighted = isHighlighted(edge);
      const label = typeof edge.label === "string" ? edge.label : "";
      return {
        ...edge,
        // React Flow renders labels inside SVG text; bound the text length.
        label:
          highlighted && !hasDenseFocus ? (
            <tspan>
              <title>{label}</title>
              {label.length > 28 ? `${label.slice(0, 27)}…` : label}
            </tspan>
          ) : undefined,
        // With automatic edge elevation disabled, keep every edge below cards.
        zIndex: -1,
        animated: false,
        style: {
          stroke: highlighted ? "var(--primary)" : "var(--muted-foreground)",
          strokeWidth: highlighted ? (hasDenseFocus ? 1.5 : 2.5) : 1,
          opacity: active && !highlighted ? 0.15 : highlighted ? 1 : 0.4,
        },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        labelShowBg: false,
      };
    });
  }, [edges, graph, isFolded, tables, selectedTable, hoveredTable]);
  return {
    nodes,
    edges,
    styledEdges,
    hubs: graph.hubs,
    hubLinkCount: graph.hubEdges.length,
    hiddenHubCount: graph.edges.length - styledEdges.length,
  };
}
