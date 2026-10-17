/**
 * @file vector-store-map-graph.ts
 * @description Builds React Flow nodes and edges for the RAG vector store map.
 */

import dagre from "dagre";
import { readableSourceType } from "./vector-store-overview";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";

export type VectorStoreMapMode = "store" | "pipeline";

export interface RagVectorStatus {
  backend?: string;
  enabled?: boolean;
  requiresExternalService?: boolean;
}

export interface RagPipelineStage {
  key: string;
  name: string;
  status: string;
  capabilities?: string[];
}

export interface RagPipelineStatus {
  enabled?: boolean;
  stageCount?: number;
  vectorStore?: RagVectorStatus;
  stages?: RagPipelineStage[];
}

export interface RagSource {
  id: string;
  sourceType: string;
  databaseId?: string;
  userId?: string;
  title: string;
  status: string;
  indexed_on?: string | null;
  accessScope?: string;
}

export interface RagSourceDetail extends RagSource {
  chunkCount?: number;
  chunks?: RagChunk[];
}

export interface RagChunk {
  id: string;
  chunkType: string;
  objectName?: string | null;
  schemaName?: string | null;
  tokenCount?: number;
  ordinal?: number;
  metadata?: {
    citation?: string;
  };
}

export interface VectorStoreGraphNodeData extends Record<string, unknown> {
  kind: "backend" | "pipelineStage" | "sourceGroup" | "source" | "chunk";
  label: string;
  subtitle?: string;
  status?: string;
  count?: number;
  meta?: string;
}

export type VectorStoreGraphNode = Node<VectorStoreGraphNodeData, "ragVector">;

type VectorStoreNodePayload = {
  label: string;
  subtitle?: string;
  status?: string;
  count?: number;
  meta?: string;
};

interface BuildVectorStoreGraphInput {
  mode: VectorStoreMapMode;
  vectorStatus?: RagVectorStatus;
  pipelineStatus?: RagPipelineStatus;
  sources: RagSource[];
  databaseLabels?: Record<string, string>;
  expandedSource?: RagSourceDetail | null;
}

const NODE_DIMENSIONS: Record<
  VectorStoreGraphNodeData["kind"],
  { width: number; height: number }
> = {
  backend: { width: 240, height: 108 },
  pipelineStage: { width: 320, height: 128 },
  sourceGroup: { width: 240, height: 108 },
  source: { width: 280, height: 112 },
  chunk: { width: 380, height: 126 },
};

const STORE_COLUMNS: Record<VectorStoreGraphNodeData["kind"], number> = {
  backend: 32,
  sourceGroup: 328,
  source: 624,
  chunk: 960,
  pipelineStage: 0,
};

const STORE_VERTICAL_GAP = 24;
const STORE_GROUP_GAP = 88;
const STORE_TOP_PADDING = 64;

const EDGE_STYLE = {
  stroke: "var(--muted-foreground)",
  strokeWidth: 1.5,
};

export function buildVectorStoreGraph({
  mode,
  vectorStatus,
  pipelineStatus,
  sources,
  databaseLabels = {},
  expandedSource,
}: BuildVectorStoreGraphInput): {
  nodes: VectorStoreGraphNode[];
  edges: Edge[];
} {
  const nodes: VectorStoreGraphNode[] = [
    createNode("backend", "rag-backend", {
      label: vectorStatus?.backend || "Vector store",
      subtitle: vectorStatus?.requiresExternalService
        ? "External knowledge index"
        : "Local knowledge index",
      status:
        vectorStatus?.enabled === true
          ? "enabled"
          : vectorStatus?.enabled === false
            ? "disabled"
            : "unavailable",
      meta: "Vector store",
    }),
  ];
  const edges: Edge[] = [];

  if (mode === "pipeline") {
    appendPipeline(nodes, edges, pipelineStatus?.stages || []);
  } else {
    appendSources(nodes, edges, sources, databaseLabels, expandedSource);
  }

  return mode === "pipeline"
    ? layoutPipelineGraph(nodes, edges)
    : layoutStoreGraph(nodes, edges);
}

function appendPipeline(
  nodes: VectorStoreGraphNode[],
  edges: Edge[],
  stages: RagPipelineStage[],
) {
  let previousId = "rag-backend";
  stages.forEach((stage, index) => {
    const nodeId = `stage:${stage.key}`;
    nodes.push(
      createNode("pipelineStage", nodeId, {
        label: stage.name,
        subtitle: `${stage.capabilities?.length || 0} capabilities`,
        status: stage.status,
        meta: `Stage ${index + 1}`,
      }),
    );
    edges.push(
      createEdge(
        `edge:${previousId}:${nodeId}`,
        previousId,
        nodeId,
        "pipelineNext",
      ),
    );
    previousId = nodeId;
  });
}

function appendSources(
  nodes: VectorStoreGraphNode[],
  edges: Edge[],
  sources: RagSource[],
  databaseLabels: Record<string, string>,
  expandedSource?: RagSourceDetail | null,
) {
  const groupedSources = groupSourcesByType(sources);
  Object.entries(groupedSources)
    .sort(([left], [right]) =>
      readableSourceType(left).localeCompare(readableSourceType(right)),
    )
    .forEach(([sourceType, groupSources], groupIndex) => {
      const groupId = `source-type:${sourceType}`;
      nodes.push(
        createNode("sourceGroup", groupId, {
          label: readableSourceType(sourceType),
          subtitle: `${groupSources.length} source${groupSources.length === 1 ? "" : "s"}`,
          status: groupSources.some((source) => source.status !== "indexed")
            ? "mixed"
            : "indexed",
          count: groupSources.length,
          meta: `Group ${groupIndex + 1}`,
        }),
      );
      edges.push(
        createEdge(
          `edge:rag-backend:${groupId}`,
          "rag-backend",
          groupId,
          "contains",
        ),
      );

      [...groupSources]
        .sort((left, right) => left.title.localeCompare(right.title))
        .forEach((source) => {
          const sourceId = `source:${source.id}`;
          nodes.push(
            createNode("source", sourceId, {
              label: source.title,
              subtitle: getSourceDatabaseLabel(source, databaseLabels),
              status: source.status,
              meta: readableSourceType(source.sourceType),
            }),
          );
          edges.push(
            createEdge(
              `edge:${groupId}:${sourceId}`,
              groupId,
              sourceId,
              "contains",
            ),
          );
        });
    });

  if (!expandedSource?.chunks?.length) {
    return;
  }

  const expandedNodeId = `source:${expandedSource.id}`;
  expandedSource.chunks.forEach((chunk) => {
    const chunkNodeId = `chunk:${chunk.id}`;
    nodes.push(
      createNode("chunk", chunkNodeId, {
        label:
          chunk.objectName ||
          chunk.metadata?.citation ||
          `Chunk ${Number(chunk.ordinal || 0) + 1}`,
        subtitle: chunk.schemaName || chunk.chunkType,
        status: chunk.tokenCount ? `${chunk.tokenCount} tokens` : "chunk",
        meta: chunk.chunkType,
      }),
    );
    edges.push(
      createEdge(
        `edge:${expandedNodeId}:${chunkNodeId}`,
        expandedNodeId,
        chunkNodeId,
        "contains",
      ),
    );
  });
}

function getSourceDatabaseLabel(
  source: RagSource,
  databaseLabels: Record<string, string>,
) {
  if (!source.databaseId) {
    return source.accessScope || "global";
  }
  return databaseLabels[source.databaseId] || "Removed connection";
}

function createNode(
  kind: VectorStoreGraphNodeData["kind"],
  id: string,
  data: VectorStoreNodePayload,
): VectorStoreGraphNode {
  return {
    id,
    type: "ragVector",
    // Controlled nodes need dimensions on the supplied node for MiniMap rendering.
    initialWidth: NODE_DIMENSIONS[kind].width,
    initialHeight: NODE_DIMENSIONS[kind].height,
    position: { x: 0, y: 0 },
    data: { ...data, kind },
  };
}

function createEdge(
  id: string,
  source: string,
  target: string,
  label: string,
): Edge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: EDGE_STYLE,
    ariaLabel: label,
    labelStyle: {
      fill: "var(--muted-foreground)",
      fontSize: 10,
      fontWeight: 700,
    },
  };
}

function layoutStoreGraph(nodes: VectorStoreGraphNode[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupIds = edges
    .filter((edge) => edge.source === "rag-backend")
    .map((edge) => edge.target)
    .filter((id) => nodeById.get(id)?.data.kind === "sourceGroup");

  const positioned = new Map<string, VectorStoreGraphNode>();
  const groupBlocks = groupIds.map((groupId) =>
    buildGroupBlock(groupId, edges, nodeById),
  );
  const graphHeight = stackHeight(groupBlocks, STORE_GROUP_GAP);
  let cursorY = STORE_TOP_PADDING;

  groupBlocks.forEach((groupBlock) => {
    const groupY =
      cursorY +
      centerOffset(groupBlock.height, NODE_DIMENSIONS.sourceGroup.height);
    const sourceStackHeight = stackHeight(
      groupBlock.sources,
      STORE_VERTICAL_GAP,
    );
    let sourceCursorY =
      cursorY + centerOffset(groupBlock.height, sourceStackHeight);

    positionNode(
      positioned,
      nodeById,
      groupBlock.id,
      STORE_COLUMNS.sourceGroup,
      groupY,
    );

    groupBlock.sources.forEach((sourceBlock) => {
      const sourceY =
        sourceCursorY +
        centerOffset(sourceBlock.height, NODE_DIMENSIONS.source.height);
      const chunkStackHeight = stackHeightByKind(sourceBlock.chunks, "chunk");
      let chunkCursorY =
        sourceCursorY + centerOffset(sourceBlock.height, chunkStackHeight);

      positionNode(
        positioned,
        nodeById,
        sourceBlock.id,
        STORE_COLUMNS.source,
        sourceY,
      );
      sourceBlock.chunks.forEach((chunkId) => {
        positionNode(
          positioned,
          nodeById,
          chunkId,
          STORE_COLUMNS.chunk,
          chunkCursorY,
        );
        chunkCursorY += NODE_DIMENSIONS.chunk.height + STORE_VERTICAL_GAP;
      });

      sourceCursorY += sourceBlock.height + STORE_VERTICAL_GAP;
    });

    cursorY += groupBlock.height + STORE_GROUP_GAP;
  });

  const backendY = groupBlocks.length
    ? STORE_TOP_PADDING +
      centerOffset(graphHeight, NODE_DIMENSIONS.backend.height)
    : STORE_TOP_PADDING;
  positionNode(
    positioned,
    nodeById,
    "rag-backend",
    STORE_COLUMNS.backend,
    backendY,
  );

  nodes.forEach((node) => {
    if (!positioned.has(node.id)) {
      positionNode(
        positioned,
        nodeById,
        node.id,
        STORE_COLUMNS[node.data.kind] || 56,
        cursorY,
      );
      cursorY += NODE_DIMENSIONS[node.data.kind].height + STORE_VERTICAL_GAP;
    }
  });

  return {
    nodes: nodes.map((node) => positioned.get(node.id) || node),
    edges,
  };
}

interface SourceLayoutBlock {
  id: string;
  height: number;
  chunks: string[];
}

interface GroupLayoutBlock {
  id: string;
  height: number;
  sources: SourceLayoutBlock[];
}

function buildGroupBlock(
  groupId: string,
  edges: Edge[],
  nodeById: Map<string, VectorStoreGraphNode>,
): GroupLayoutBlock {
  const sources = childIds(edges, groupId, "source", nodeById).map(
    (sourceId) => {
      const chunks = childIds(edges, sourceId, "chunk", nodeById);
      return {
        id: sourceId,
        chunks,
        height: Math.max(
          NODE_DIMENSIONS.source.height,
          stackHeightByKind(chunks, "chunk"),
        ),
      };
    },
  );
  return {
    id: groupId,
    sources,
    height: Math.max(
      NODE_DIMENSIONS.sourceGroup.height,
      stackHeight(sources, STORE_VERTICAL_GAP),
    ),
  };
}

function stackHeight(items: Array<{ height: number }>, gap: number) {
  if (!items.length) return 0;
  return (
    items.reduce((total, item) => total + item.height, 0) +
    (items.length - 1) * gap
  );
}

function stackHeightByKind(
  ids: string[],
  kind: VectorStoreGraphNodeData["kind"],
) {
  if (!ids.length) return 0;
  return (
    ids.length * NODE_DIMENSIONS[kind].height +
    (ids.length - 1) * STORE_VERTICAL_GAP
  );
}

function centerOffset(outerHeight: number, innerHeight: number) {
  return Math.max(0, (outerHeight - innerHeight) / 2);
}

function childIds(
  edges: Edge[],
  sourceId: string,
  kind: VectorStoreGraphNodeData["kind"],
  nodeById: Map<string, VectorStoreGraphNode>,
) {
  return edges
    .filter((edge) => edge.source === sourceId)
    .map((edge) => edge.target)
    .filter((id) => nodeById.get(id)?.data.kind === kind);
}

function positionNode(
  positioned: Map<string, VectorStoreGraphNode>,
  nodeById: Map<string, VectorStoreGraphNode>,
  id: string,
  x: number,
  y: number,
) {
  const node = nodeById.get(id);
  if (!node) return;
  positioned.set(id, {
    ...node,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    position: { x, y },
  });
}

function layoutPipelineGraph(nodes: VectorStoreGraphNode[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 74,
    ranksep: 150,
    marginx: 56,
    marginy: 56,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, NODE_DIMENSIONS[node.data.kind]);
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const dimensions = NODE_DIMENSIONS[node.data.kind];
      const point = graph.node(node.id);
      return {
        ...node,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: {
          x: point.x - dimensions.width / 2,
          y: point.y - dimensions.height / 2,
        },
      };
    }),
    edges,
  };
}

function groupSourcesByType(sources: RagSource[]) {
  return sources.reduce<Record<string, RagSource[]>>((groups, source) => {
    const key = source.sourceType || "unknown";
    groups[key] = groups[key] || [];
    groups[key].push(source);
    return groups;
  }, {});
}

export { readableSourceType } from "./vector-store-overview";
