/** @file types.ts @description Knowledge workspace contracts shared by forms and API. */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  databaseId: string;
  enabledForSql: boolean;
}
export interface Binding {
  schemaName: string;
  tableName: string;
  columnName?: string | null;
  catalogName?: string;
}
export interface Definition {
  kind: "concept" | "metric" | "rule" | "example";
  name: string;
  description: string;
  aliases: string[];
  formula: string;
  grain: string;
  timeColumn: string;
  timezone: string;
  filters: string;
  sql: string;
  dialect: string;
  verified: boolean;
}
export interface LogicalJoin {
  source: Binding;
  target: Binding;
  columnPairs: [string, string][];
  role: string;
  cardinality:
    | "unknown"
    | "one-to-one"
    | "many-to-one"
    | "one-to-many"
    | "many-to-many";
  confirmed: boolean;
}
export interface DefinitionData {
  bindings: Binding[];
  definitions: Definition[];
  joins: LogicalJoin[];
}
export type DocumentKind =
  | "design"
  | "dictionary"
  | "metric"
  | "rule"
  | "example"
  | "note";
export interface Job {
  id: string;
  revisionId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  mode: string;
  error?: string;
}
export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  kind: DocumentKind;
  bodyMarkdown: string;
  definitionData: DefinitionData;
  version: number;
  activeRevisionId: string | null;
  job?: Job | null;
}
export interface Revision extends Omit<KnowledgeDocument, "activeRevisionId"> {
  documentId: string;
  created_on: string;
  active: boolean;
  sections: { id: string; heading: string; content: string }[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface GraphNode {
  id: string;
  label: string;
  nodeType: string;
  schemaName?: string;
  tableName?: string;
  columnName?: string;
}
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  payloadJson: Record<string, unknown>;
}
export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: {
    id: string;
    edgeId: string;
    revisionId?: string;
    documentId?: string;
    knowledgeBaseId?: string;
    snapshotHash?: string;
    section?: string;
  }[];
  total: number;
  truncated: boolean;
}
export interface Evidence {
  title: string;
  sourceType: string;
  content: string;
  citation?: {
    id: string;
    knowledgeBaseId?: string;
    documentId?: string;
    revisionId?: string;
    section?: string;
  };
}
export interface ContextPreview {
  retrievalTrace?: { retrievalMode: string; fallbackReason?: string };
  items: Evidence[];
  warnings: string[];
  graph: { enabled: boolean; gaps: string[]; tableCount?: number };
  embeddingProvider: string;
  embeddingModel: string;
  enabledForSql: boolean;
  executesSql: false;
}
export const emptyDefinitions = (): DefinitionData => ({
  bindings: [],
  definitions: [],
  joins: [],
});
