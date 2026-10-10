/**
 * @file types.ts
 * @description Typed schema metadata and React Flow table node data.
 */
import type { Node } from "@xyflow/react";

export type DetailLevel = "name" | "keys" | "all";
export type SchemaColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
};
export type ForeignKey = {
  table: string;
  constraint?: string;
  column: string;
  foreignSchema?: string;
  foreignTable: string;
  foreignColumn?: string;
};
export type TableNodeData = {
  label: string;
  columns: SchemaColumn[];
  detailLevel: DetailLevel;
  foreignKeyColumns: string[];
  referencedColumns: string[];
  hiddenHubColumns?: Map<string, string>;
  hubIncomingCount?: number;
  onFocusTable?: (tableName: string) => void;
};
export type TableFlowNode = Node<TableNodeData, "table">;
