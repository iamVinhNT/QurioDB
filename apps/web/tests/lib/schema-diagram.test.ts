/**
 * @file schema-diagram.test.ts
 * @description Regression checks for schema graph preprocessing, detail sizing, and non-overlapping layout.
 */
import { describe, expect, it } from "vitest";
import {
  findHubTables,
  splitHubEdges,
  getHiddenHubColumns,
  HUB_THRESHOLD,
  getKeyColumns,
  getNodeHeight,
  getVisibleColumns,
  preprocessEdges,
  HEADER_HEIGHT,
  LIST_PADDING,
  ROW_HEIGHT,
  MAX_VISIBLE_ROWS,
  FOOTER_HEIGHT,
} from "@/app/sqllab/components/schemavisualizer/graph";
import { getLayoutedElements } from "@/app/sqllab/components/schemavisualizer/layout";
import type {
  DetailLevel,
  TableFlowNode,
  TableNodeData,
} from "@/app/sqllab/components/schemavisualizer/types";

function data(detailLevel: DetailLevel, count = 15): TableNodeData {
  return {
    label: "table",
    detailLevel,
    columns: Array.from({ length: count }, (_, index) => ({
      name: `col${index}`,
      type: "int",
      primary_key: index === 0,
    })),
    foreignKeyColumns: ["col1"],
    referencedColumns: ["col2"],
  };
}
function node(id: string, count = 15): TableFlowNode {
  return {
    id,
    type: "table",
    position: { x: 0, y: 0 },
    data: { ...data("all", count), label: id },
  };
}
function expectNoOverlaps(nodes: TableFlowNode[]) {
  nodes.forEach((a, index) =>
    nodes.slice(index + 1).forEach((b) => {
      const overlaps =
        a.position.x < b.position.x + b.width! &&
        a.position.x + a.width! > b.position.x &&
        a.position.y < b.position.y + b.height! &&
        a.position.y + a.height! > b.position.y;
      expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
    }),
  );
}

describe("schema detail sizing", () => {
  it("uses header only for name detail", () => {
    expect(getVisibleColumns(data("name"))).toEqual([]);
    expect(getNodeHeight(data("name"))).toBe(HEADER_HEIGHT);
  });
  it("includes PK, FK and referenced keys plus a hidden-column footer", () => {
    expect(
      getVisibleColumns(data("keys")).map((column) => column.name),
    ).toEqual(["col0", "col1", "col2"]);
    expect(getNodeHeight(data("keys"))).toBe(
      HEADER_HEIGHT + LIST_PADDING + 3 * ROW_HEIGHT + FOOTER_HEIGHT,
    );
  });
  it("caps scroll viewport while preserving all rows and handles empty columns", () => {
    expect(getVisibleColumns(data("all"))).toHaveLength(15);
    expect(getNodeHeight(data("all"))).toBe(
      HEADER_HEIGHT + LIST_PADDING + MAX_VISIBLE_ROWS * ROW_HEIGHT,
    );
    expect(getNodeHeight(data("all", 2))).toBe(
      HEADER_HEIGHT + LIST_PADDING + 2 * ROW_HEIGHT,
    );
    expect(getNodeHeight(data("all", 0))).toBe(HEADER_HEIGHT + LIST_PADDING);
  });
  it("handles metadata without PK or foreignColumn", () => {
    const keys = getKeyColumns(
      ["a", "b"],
      [{ table: "a", column: "x, y", foreignTable: "b" }],
    );
    const value = {
      ...data("keys"),
      columns: [
        { name: "x", type: "int" },
        { name: "other", type: "text" },
      ],
      foreignKeyColumns: [...keys.foreign.get("a")!],
      referencedColumns: [],
    };
    expect(getVisibleColumns(value)).toEqual([{ name: "x", type: "int" }]);
  });
});

describe("edge preprocessing", () => {
  it("merges ordered pairs and composite names, removes duplicates, self and missing endpoints", () => {
    const edges = preprocessEdges(
      ["a", "b"],
      [
        { table: "a", column: "x, y", foreignTable: "b" },
        { table: "a", column: "x", foreignTable: "b" },
        { table: "a", column: "z", foreignTable: "b" },
        { table: "b", column: "id", foreignTable: "a" },
        { table: "a", column: "parent", foreignTable: "a" },
        { table: "a", column: "external", foreignTable: "missing" },
        { table: "missing", column: "id", foreignTable: "a" },
      ],
    );
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      source: "a",
      target: "b",
      label: "x, y, z",
      type: "smoothstep",
    });
    expect(edges[0]).not.toHaveProperty("animated");
    expect(edges[1]).toMatchObject({ source: "b", target: "a" });
  });
  it("retains self/local FK keys and splits referenced composite columns", () => {
    const keys = getKeyColumns(
      ["a", "b"],
      [
        {
          table: "a",
          column: "parent",
          foreignTable: "a",
          foreignColumn: "id",
        },
        {
          table: "a",
          column: "x, y",
          foreignTable: "b",
          foreignColumn: "id1, id2",
        },
        { table: "a", column: "external", foreignTable: "outside" },
      ],
    );
    expect([...keys.foreign.get("a")!]).toEqual([
      "parent",
      "x",
      "y",
      "external",
    ]);
    expect([...keys.referenced.get("a")!]).toEqual(["id"]);
    expect([...keys.referenced.get("b")!]).toEqual(["id1", "id2"]);
  });
});

describe("schema layout", () => {
  it("packs isolated tables below connected tables without rectangle overlap", () => {
    const input = [
      node("a", 2),
      node("b", 20),
      ...Array.from({ length: 12 }, (_, index) =>
        node(`isolated${index}`, index),
      ),
    ];
    const edges = preprocessEdges(
      input.map((item) => item.id),
      [{ table: "a", column: "id", foreignTable: "b" }],
    );
    const { nodes } = getLayoutedElements(input, edges);
    expectNoOverlaps(nodes);
    const connectedBottom = Math.max(
      ...nodes.slice(0, 2).map((item) => item.position.y + item.height!),
    );
    expect(
      nodes.slice(2).every((item) => item.position.y > connectedBottom),
    ).toBe(true);
    expect(
      new Set(nodes.slice(2).map((item) => item.position.x)).size,
    ).toBeGreaterThan(1);
    expect(nodes[0].position.x).toBeLessThan(nodes[1].position.x);
    expect(
      input.every((item) => item.position.x === 0 && item.position.y === 0),
    ).toBe(true);
  });
  it("handles empty, all isolated, cycles and invalid raw edges", () => {
    expect(getLayoutedElements([], [])).toEqual({ nodes: [], edges: [] });
    const isolated = getLayoutedElements(
      Array.from({ length: 9 }, (_, index) => node(`${index}`)),
      [],
    );
    expectNoOverlaps(isolated.nodes);
    expect(new Set(isolated.nodes.map((item) => item.position.y)).size).toBe(3);
    const cycle = getLayoutedElements(
      [node("a"), node("b")],
      [
        { id: "ab", source: "a", target: "b" },
        { id: "ba", source: "b", target: "a" },
        { id: "aa", source: "a", target: "a" },
        { id: "bad", source: "a", target: "missing" },
      ],
    );
    expect(cycle.edges).toHaveLength(2);
    expectNoOverlaps(cycle.nodes);
  });
  it("is deterministic without theme input", () => {
    const input = [node("a"), node("b")];
    const edges = preprocessEdges(
      ["a", "b"],
      [{ table: "a", column: "id", foreignTable: "b" }],
    );
    expect(getLayoutedElements(input, edges)).toEqual(
      getLayoutedElements(input, edges),
    );
  });
});

describe("hub folding", () => {
  const tables = ["hub", ...Array.from({ length: 10 }, (_, i) => `t${i}`)];
  const foreignKeys = tables.slice(1).map((table) => ({
    table,
    column: "created_by, changed_by",
    foreignTable: "hub",
  }));
  it("counts distinct incoming tables at 9 versus 10 after filtering and merging", () => {
    expect(HUB_THRESHOLD).toBe(10);
    const nine = preprocessEdges(tables, [
      ...foreignKeys.slice(0, 9),
      foreignKeys[0],
      { table: "hub", column: "self", foreignTable: "hub" },
      { table: "outside", column: "bad", foreignTable: "hub" },
    ]);
    expect(nine).toHaveLength(9);
    expect(findHubTables([...nine, nine[0]])).toEqual(new Map());
    expect(findHubTables(preprocessEdges(tables, foreignKeys))).toEqual(
      new Map([["hub", 10]]),
    );
  });
  it("splits targets and maps every composite FK column to its hidden hub", () => {
    const edges = preprocessEdges(tables, [
      ...foreignKeys,
      { table: "t0", column: "regular", foreignTable: "t1" },
    ]);
    const { hubEdges, regularEdges } = splitHubEdges(
      edges,
      findHubTables(edges),
    );
    expect(hubEdges).toHaveLength(10);
    expect(regularEdges).toEqual([edges[10]]);
    expect(getHiddenHubColumns(hubEdges).get("t0")).toEqual(
      new Map([
        ["created_by", "hub"],
        ["changed_by", "hub"],
      ]),
    );
    expect(getHiddenHubColumns([]).size).toBe(0);
  });
  it("excludes folded links from layout and puts isolated hubs first", () => {
    const input = [
      node("isolated"),
      ...tables.slice(1).map((id) => node(id)),
      { ...node("hub"), data: { ...data("all"), hubIncomingCount: 10 } },
    ];
    const edges = preprocessEdges(
      input.map((n) => n.id),
      [...foreignKeys, { table: "t0", column: "regular", foreignTable: "t1" }],
    );
    const { regularEdges } = splitHubEdges(edges, findHubTables(edges));
    const layout = getLayoutedElements(input, regularEdges);
    expect(layout.edges).toHaveLength(1);
    const hub = layout.nodes.find((n) => n.id === "hub")!;
    expect(hub.position.x).toBe(0);
    const isolated = layout.nodes.filter((n) => !["t0", "t1"].includes(n.id));
    expect(hub.position.y).toBe(Math.min(...isolated.map((n) => n.position.y)));
    expect(
      layout.nodes.find((n) => n.id === "isolated")!.position.x,
    ).toBeGreaterThan(hub.position.x);
    expectNoOverlaps(layout.nodes);
  });
});
