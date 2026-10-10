/**
 * @file layout.ts
 * @description Pure LR Dagre layout with bounded rank wrapping and an isolated-table grid.
 */
import dagre from "dagre";
import { type Edge, Position } from "@xyflow/react";
import { getNodeHeight, NODE_WIDTH } from "./graph";
import type { TableFlowNode } from "./types";

const GAP = 70;
const RANK_GAP = 100;
const MIN_COLUMN_HEIGHT = 1000;
const TARGET_ASPECT = 16 / 9;

function orderByCoordinate(nodes: TableFlowNode[], axis: "x" | "y") {
  return [...nodes].sort((a, b) => a.position[axis] - b.position[axis]);
}

function wrapRanks(nodes: TableFlowNode[]) {
  const area = nodes.reduce(
    (sum, node) => sum + (NODE_WIDTH + RANK_GAP) * (node.height! + GAP),
    0,
  );
  const targetHeight = Math.max(
    MIN_COLUMN_HEIGHT,
    Math.sqrt(area / TARGET_ASPECT),
  );
  const ranks = new Map<number, TableFlowNode[]>();
  for (const node of orderByCoordinate(nodes, "x")) {
    const rank = ranks.get(node.position.x) || [];
    rank.push(node);
    ranks.set(node.position.x, rank);
  }
  const columns: { nodes: TableFlowNode[]; height: number }[] = [];
  let addedWidth = 0;
  let hasWrappedRank = false;
  for (const rank of ranks.values()) {
    const rankHeight = rank.reduce(
      (sum, node) => sum + node.height! + GAP,
      -GAP,
    );
    if (rankHeight <= targetHeight) {
      columns.push({
        nodes: rank.map((node) => ({
          ...node,
          position: { ...node.position, x: node.position.x + addedWidth },
        })),
        height: 0,
      });
      continue;
    }
    hasWrappedRank = true;
    let column: TableFlowNode[] = [];
    let height = 0;
    const rankX = rank[0].position.x;
    for (const node of orderByCoordinate(rank, "y")) {
      if (column.length && height + GAP + node.height! > targetHeight) {
        columns.push({ nodes: column, height });
        addedWidth += NODE_WIDTH + GAP;
        column = [];
        height = 0;
      }
      const y = column.length ? height + GAP : 0;
      column.push({ ...node, position: { x: rankX + addedWidth, y } });
      height = y + node.height!;
    }
    columns.push({ nodes: column, height });
  }
  if (!hasWrappedRank) return nodes;
  // Once a rank wraps, remove Dagre alignment gaps in the other ranks too.
  let layoutHeight = 0;
  for (const column of columns) {
    if (!column.height) {
      let y = 0;
      column.nodes = orderByCoordinate(column.nodes, "y").map((node) => {
        const positioned = { ...node, position: { ...node.position, y } };
        y += node.height! + GAP;
        return positioned;
      });
      column.height = y - GAP;
    }
    layoutHeight = Math.max(layoutHeight, column.height);
  }
  return columns.flatMap((column) =>
    column.nodes.map((node) => ({
      ...node,
      position: {
        ...node.position,
        y: node.position.y + (layoutHeight - column.height) / 2,
      },
    })),
  );
}

export function getLayoutedElements(nodes: TableFlowNode[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: GAP, ranksep: RANK_GAP });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter(
    (edge) =>
      edge.source !== edge.target &&
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target),
  );
  const connectedIds = new Set(
    validEdges.flatMap((edge) => [edge.source, edge.target]),
  );
  const sizedNodes = nodes.map((node) => ({
    ...node,
    width: NODE_WIDTH,
    height: getNodeHeight(node.data),
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    style: {
      ...node.style,
      width: NODE_WIDTH,
      height: getNodeHeight(node.data),
    },
  }));
  sizedNodes.forEach((node) => {
    if (connectedIds.has(node.id))
      graph.setNode(node.id, { width: node.width, height: node.height });
  });
  validEdges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  if (connectedIds.size) dagre.layout(graph);

  const connected = sizedNodes
    .filter((node) => connectedIds.has(node.id))
    .map((node) => {
      const center = graph.node(node.id);
      return {
        ...node,
        position: {
          x: center.x - NODE_WIDTH / 2,
          y: center.y - node.height / 2,
        },
      };
    });
  let connectedWidth = 0;
  let connectedBottom = 0;
  const positioned = new Map<string, TableFlowNode>();
  for (const node of wrapRanks(connected)) {
    connectedWidth = Math.max(connectedWidth, node.position.x + NODE_WIDTH);
    connectedBottom = Math.max(connectedBottom, node.position.y + node.height!);
    positioned.set(node.id, node);
  }

  const isolated = sizedNodes
    .filter((node) => !connectedIds.has(node.id))
    .sort(
      (a, b) =>
        Number(Boolean(b.data.hubIncomingCount)) -
        Number(Boolean(a.data.hubIncomingCount)),
    );
  const targetWidth = Math.max(
    connectedWidth,
    Math.ceil(Math.sqrt(isolated.length)) * (NODE_WIDTH + GAP) - GAP,
  );
  const columnsPerRow = Math.max(
    1,
    Math.floor((targetWidth + GAP) / (NODE_WIDTH + GAP)),
  );
  let y = connectedIds.size ? connectedBottom + GAP : 0;
  for (let start = 0; start < isolated.length; start += columnsPerRow) {
    const row = isolated.slice(start, start + columnsPerRow);
    row.forEach((node, index) =>
      positioned.set(node.id, {
        ...node,
        position: { x: index * (NODE_WIDTH + GAP), y },
      }),
    );
    y += Math.max(...row.map((node) => node.height)) + GAP;
  }
  return {
    nodes: nodes.map((node) => positioned.get(node.id)!),
    edges: validEdges,
  };
}
