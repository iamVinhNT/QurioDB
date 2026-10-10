/**
 * @file graph.ts
 * @description Pure schema graph preprocessing and column detail selection.
 */
import type { Edge } from "@xyflow/react";
import type { ForeignKey, TableNodeData, SchemaColumn } from "./types";

export const LARGE_SCHEMA_THRESHOLD = 30;
export const HUB_THRESHOLD = 10;

export const NODE_WIDTH = 320;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 28;
export const MAX_VISIBLE_ROWS = 10;
export const LIST_PADDING = 8;
export const FOOTER_HEIGHT = 28;

export function splitColumns(columns?: string): string[] {
  return (columns || "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

export function getVisibleColumns(data: TableNodeData): SchemaColumn[] {
  if (data.detailLevel === "name") return [];
  if (data.detailLevel === "all") return data.columns;
  const keys = new Set([...data.foreignKeyColumns, ...data.referencedColumns]);
  return data.columns.filter(
    (column) => column.primary_key || keys.has(column.name),
  );
}

export function getNodeHeight(data: TableNodeData): number {
  if (data.detailLevel === "name") return HEADER_HEIGHT;
  const count = getVisibleColumns(data).length;
  return (
    HEADER_HEIGHT +
    LIST_PADDING +
    Math.min(count, MAX_VISIBLE_ROWS) * ROW_HEIGHT +
    (count < data.columns.length ? FOOTER_HEIGHT : 0)
  );
}

export function preprocessEdges(
  tables: string[],
  foreignKeys: ForeignKey[],
): Edge[] {
  const tableNames = new Set(tables);
  const pairs = new Map<
    string,
    { source: string; target: string; columns: Set<string> }
  >();
  for (const fk of foreignKeys) {
    if (
      !tableNames.has(fk.table) ||
      !tableNames.has(fk.foreignTable) ||
      fk.table === fk.foreignTable
    )
      continue;
    const id = JSON.stringify([fk.table, fk.foreignTable]);
    const pair = pairs.get(id) || {
      source: fk.table,
      target: fk.foreignTable,
      columns: new Set<string>(),
    };
    splitColumns(fk.column).forEach((column) => pair.columns.add(column));
    pairs.set(id, pair);
  }
  return Array.from(pairs, ([id, pair]) => ({
    id,
    source: pair.source,
    target: pair.target,
    label: Array.from(pair.columns).join(", "),
    type: "smoothstep",
  }));
}

export function getKeyColumns(tables: string[], foreignKeys: ForeignKey[]) {
  const tableNames = new Set(tables);
  const foreign = new Map<string, Set<string>>();
  const referenced = new Map<string, Set<string>>();
  const addColumns = (
    map: Map<string, Set<string>>,
    table: string,
    columns?: string,
  ) => {
    const names = map.get(table) || new Set<string>();
    splitColumns(columns).forEach((column) => names.add(column));
    map.set(table, names);
  };
  for (const fk of foreignKeys) {
    // Keep local keys even when the relationship points outside the displayed schema.
    if (tableNames.has(fk.table)) addColumns(foreign, fk.table, fk.column);
    if (tableNames.has(fk.table) && tableNames.has(fk.foreignTable)) {
      addColumns(referenced, fk.foreignTable, fk.foreignColumn);
    }
  }
  return { foreign, referenced };
}

/** Count distinct incoming tables on the preprocessed graph. */
export function findHubTables(edges: Edge[]): Map<string, number> {
  const incoming = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const sources = incoming.get(edge.target) || new Set<string>();
    sources.add(edge.source);
    incoming.set(edge.target, sources);
  }
  return new Map(
    [...incoming]
      .filter(([, sources]) => sources.size >= HUB_THRESHOLD)
      .map(([table, sources]) => [table, sources.size]),
  );
}
export function splitHubEdges(edges: Edge[], hubs: Map<string, number>) {
  const hubEdges: Edge[] = [];
  const regularEdges: Edge[] = [];
  for (const edge of edges)
    (hubs.has(edge.target) ? hubEdges : regularEdges).push(edge);
  return { hubEdges, regularEdges };
}
export function getHiddenHubColumns(hubEdges: Edge[]) {
  const columns = new Map<string, Map<string, string>>();
  for (const edge of hubEdges) {
    const tableColumns = columns.get(edge.source) || new Map<string, string>();
    splitColumns(typeof edge.label === "string" ? edge.label : "").forEach(
      (column) => tableColumns.set(column, edge.target),
    );
    columns.set(edge.source, tableColumns);
  }
  return columns;
}
