/**
 * @file schema-rank-layout.test.ts
 * @description Aspect-ratio and ordering regressions for large hub-and-spoke schemas.
 */
import dagre from "dagre";
import { getViewportForBounds } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getLayoutedElements } from "@/app/sqllab/components/schemavisualizer/layout";
import {
  getNodeHeight,
  NODE_WIDTH,
  preprocessEdges,
} from "@/app/sqllab/components/schemavisualizer/graph";
import type { TableFlowNode } from "@/app/sqllab/components/schemavisualizer/types";

function node(id: string, count: number): TableFlowNode {
  return {
    id,
    type: "table",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      detailLevel: "all",
      columns: Array.from({ length: count }, (_, index) => ({
        name: `c${index}`,
        type: "int",
      })),
      foreignKeyColumns: [],
      referencedColumns: [],
    },
  };
}
function hubSchema(isolatedCount = 0) {
  const nodes = [
    ...Array.from({ length: 3 }, (_, index) =>
      node(`hub${index}`, index * 3 + 1),
    ),
    ...Array.from({ length: 120 }, (_, index) =>
      node(`spoke${index}`, index % 12),
    ),
    ...Array.from({ length: isolatedCount }, (_, index) =>
      node(`isolated${index}`, index % 10),
    ),
  ];
  const foreignKeys = Array.from({ length: 120 }, (_, index) => [
    { table: `spoke${index}`, column: "c0", foreignTable: `hub${index % 3}` },
    ...(index % 2
      ? [
          {
            table: `spoke${index}`,
            column: "c1",
            foreignTable: `hub${(index + 1) % 3}`,
          },
        ]
      : []),
  ]).flat();
  return {
    nodes,
    edges: preprocessEdges(
      nodes.map((item) => item.id),
      foreignKeys,
    ),
  };
}
function bounds(nodes: TableFlowNode[]) {
  const width =
    Math.max(...nodes.map((item) => item.position.x + item.width!)) -
    Math.min(...nodes.map((item) => item.position.x));
  const height =
    Math.max(...nodes.map((item) => item.position.y + item.height!)) -
    Math.min(...nodes.map((item) => item.position.y));
  return { width, height, ratio: width / height };
}
function expectNoOverlaps(nodes: TableFlowNode[]) {
  nodes.forEach((a, index) =>
    nodes.slice(index + 1).forEach((b) => {
      expect(
        a.position.x >= b.position.x + b.width! ||
          b.position.x >= a.position.x + a.width! ||
          a.position.y >= b.position.y + b.height! ||
          b.position.y >= a.position.y + a.height!,
        `${a.id} / ${b.id}`,
      ).toBe(true);
    }),
  );
}
function originalPositions(input: ReturnType<typeof hubSchema>) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 100 });
  input.nodes.forEach((item) =>
    graph.setNode(item.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(item.data),
    }),
  );
  input.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return new Map(
    input.nodes.map((item) => [
      item.id,
      {
        x: graph.node(item.id).x - NODE_WIDTH / 2,
        y: graph.node(item.id).y - getNodeHeight(item.data) / 2,
      },
    ]),
  );
}

describe("overfull Dagre ranks", () => {
  it("wraps a mixed-height hub schema into non-overlapping screen-shaped bounds", () => {
    const input = hubSchema();
    const result = getLayoutedElements(input.nodes, input.edges);
    expectNoOverlaps(result.nodes);
    const box = bounds(result.nodes);
    expect(box.ratio).toBeGreaterThanOrEqual(0.6);
    expect(box.ratio).toBeLessThanOrEqual(3);
    const expectedFullscreenScale = getViewportForBounds(
      { x: 0, y: 0, ...box },
      1280,
      720,
      0.05,
      1,
      0.15,
    ).zoom;
    expect(expectedFullscreenScale).toBeGreaterThanOrEqual(0.15);
    expect(result).toEqual(getLayoutedElements(input.nodes, input.edges));
    expect(result.edges).toEqual(input.edges);
    const hubs = result.nodes.filter((item) => item.id.startsWith("hub"));
    const spokes = result.nodes.filter((item) => item.id.startsWith("spoke"));
    expect(new Set(spokes.map((item) => item.position.x)).size).toBeGreaterThan(
      1,
    );
    expect(Math.min(...hubs.map((item) => item.position.x))).toBeGreaterThan(
      Math.max(...spokes.map((item) => item.position.x + item.width!)),
    );
  });
  it("preserves Dagre y order through wrapped sub-columns", () => {
    const input = hubSchema();
    const original = originalPositions(input);
    const nodes = getLayoutedElements(input.nodes, input.edges).nodes.filter(
      (item) => item.id.startsWith("spoke"),
    );
    const before = [...nodes]
      .sort((a, b) => original.get(a.id)!.y - original.get(b.id)!.y)
      .map((item) => item.id);
    const after = [...nodes]
      .sort(
        (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
      )
      .map((item) => item.id);
    expect(after).toEqual(before);
  });
  it("keeps isolated tables in a wide grid below the wrapped connected part", () => {
    const input = hubSchema(24);
    const result = getLayoutedElements(input.nodes, input.edges);
    expectNoOverlaps(result.nodes);
    const connected = result.nodes.filter(
      (item) => !item.id.startsWith("isolated"),
    );
    const isolated = result.nodes.filter((item) =>
      item.id.startsWith("isolated"),
    );
    const connectedBottom = Math.max(
      ...connected.map((item) => item.position.y + item.height!),
    );
    expect(
      isolated.every((item) => item.position.y >= connectedBottom + 70),
    ).toBe(true);
    expect(
      new Set(isolated.map((item) => item.position.x)).size,
    ).toBeGreaterThan(3);
    const box = bounds(result.nodes);
    expect(box.ratio).toBeGreaterThanOrEqual(0.6);
    expect(box.ratio).toBeLessThanOrEqual(3);
  });
  it("shifts later ranks after wrapping multiple ranks without overlap", () => {
    const nodes = [
      node("hub", 3),
      ...Array.from({ length: 60 }, (_, index) => [
        node(`source${index}`, index % 8),
        node(`middle${index}`, index % 10),
      ]).flat(),
    ];
    const edges = preprocessEdges(
      nodes.map((item) => item.id),
      Array.from({ length: 60 }, (_, index) => [
        {
          table: `source${index}`,
          column: "c0",
          foreignTable: `middle${index}`,
        },
        { table: `middle${index}`, column: "c0", foreignTable: "hub" },
      ]).flat(),
    );
    const result = getLayoutedElements(nodes, edges);
    expectNoOverlaps(result.nodes);
    const sources = result.nodes.filter((item) => item.id.startsWith("source"));
    const middle = result.nodes.filter((item) => item.id.startsWith("middle"));
    expect(
      new Set(sources.map((item) => item.position.x)).size,
    ).toBeGreaterThan(1);
    expect(new Set(middle.map((item) => item.position.x)).size).toBeGreaterThan(
      1,
    );
    expect(Math.min(...middle.map((item) => item.position.x))).toBeGreaterThan(
      Math.max(...sources.map((item) => item.position.x + item.width!)),
    );
    expect(result.nodes[0].position.x).toBeGreaterThan(
      Math.max(...middle.map((item) => item.position.x + item.width!)),
    );
  });

  it("preserves exact old positions in an eight-node graph that needs no wrapping", () => {
    const nodes = [
      node("hub", 2),
      ...Array.from({ length: 7 }, (_, index) =>
        node(`spoke${index}`, index % 3),
      ),
    ];
    const edges = preprocessEdges(
      nodes.map((item) => item.id),
      nodes
        .slice(1)
        .map((item) => ({ table: item.id, column: "c0", foreignTable: "hub" })),
    );
    const original = originalPositions({ nodes, edges });
    const result = getLayoutedElements(nodes, edges);
    result.nodes.forEach((item) =>
      expect(item.position).toEqual(original.get(item.id)),
    );
    expect(
      new Set(result.nodes.slice(1).map((item) => item.position.x)).size,
    ).toBe(1);
  });
});
