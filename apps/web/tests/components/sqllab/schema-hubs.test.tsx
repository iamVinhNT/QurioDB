/**
 * @file schema-hubs.test.tsx
 * @description Regression checks for hub folding, labels, focus navigation, and dataset reset.
 */
import { act, fireEvent, render, screen } from "../../test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { useLayoutEffect } from "react";
import type { ReactFlow } from "@xyflow/react";
import type { Edge, NodeProps, ReactFlowInstance } from "@xyflow/react";
import type { TableFlowNode } from "@/app/sqllab/components/schemavisualizer/types";

const state = vi.hoisted(() => ({
  theme: "light",
  fitView: vi.fn(async () => true),
  renders: [] as ComponentProps<typeof ReactFlow<TableFlowNode, Edge>>[],
  props: null as ComponentProps<typeof ReactFlow<TableFlowNode, Edge>> | null,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: state.theme }) }));
// JSDOM cannot measure the flow viewport. Capture its public props to test the toolbar and handlers.
vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  const { useEffect } = await import("react");
  const instance = { fitView: state.fitView } as unknown as ReactFlowInstance<
    TableFlowNode,
    Edge
  >;
  return {
    ...original,
    ReactFlow: (
      props: ComponentProps<typeof ReactFlow<TableFlowNode, Edge>>,
    ) => {
      state.props = props;
      state.renders.push(props);
      useEffect(() => {
        props.onInit?.(instance);
      }, [props.onInit]);
      return <div data-testid="schema-flow" />;
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    BackgroundVariant: { Dots: "dots" },
    Position: { Left: "left", Right: "right" },
    Handle: () => null,
  };
});
vi.mock(
  "@/app/sqllab/components/schemavisualizer/layout",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/app/sqllab/components/schemavisualizer/layout")
      >();
    return {
      ...original,
      getLayoutedElements: vi.fn(original.getLayoutedElements),
    };
  },
);
import { TableNode } from "@/app/sqllab/components/schemavisualizer/TableNode";
import { MAX_LABELLED_EDGES } from "@/app/sqllab/components/schemavisualizer/useSchemaGraphModel";
import { SchemaVisualizer } from "@/app/sqllab/components/SchemaVisualizer";
import { getLayoutedElements } from "@/app/sqllab/components/schemavisualizer/layout";

const props = {
  tables: ["a", "b", "c"],
  columns: { a: [{ name: "id", type: "int" }] },
  foreignKeys: [
    { table: "a", column: "id", foreignTable: "b" },
    { table: "b", column: "id", foreignTable: "c" },
  ],
};

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
const event = new MouseEvent("mouseenter") as unknown as Parameters<
  NonNullable<NonNullable<typeof state.props>["onNodeMouseEnter"]>
>[0];
beforeEach(() => {
  state.theme = "light";
  state.renders = [];
  state.fitView.mockClear();
  frames.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => vi.restoreAllMocks());

function FullViewport() {
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ width: 640, height: 480, transform: [0, 0, 1] });
  }, [store]);
  return null;
}

const large = {
  tables: [...Array.from({ length: 30 }, (_, i) => `t${i}`), "hub"],
  columns: {
    t0: [
      { name: "created_by", type: "int" },
      { name: "changed_by", type: "int" },
    ],
  },
  foreignKeys: [
    ...Array.from({ length: 10 }, (_, i) => ({
      table: `t${i}`,
      column: "created_by, changed_by",
      foreignTable: "hub",
    })),
    { table: "t0", column: "regular", foreignTable: "t1" },
    { table: "t11", column: "unrelated", foreignTable: "t12" },
  ],
};
function node(id: string) {
  return state.props!.nodes!.find((n) => n.id === id)!;
}
function enter(id: string) {
  act(() => state.props!.onNodeMouseEnter!(event, node(id)));
}
function click(id: string) {
  act(() => state.props!.onNodeClick!(event, node(id)));
}
function clear() {
  act(() => {
    state.props!.onNodeMouseLeave!(event, node("hub"));
    state.props!.onPaneClick!(event);
  });
}
describe("hub folding", () => {
  it("draws all links with no toggle through 30 tables, even with a hub", () => {
    render(
      <SchemaVisualizer
        {...large}
        tables={large.tables.filter((t) => t !== "t29")}
      />,
    );
    expect(state.props!.edges).toHaveLength(12);
    expect(
      screen.queryByRole("button", { name: "Hub links" }),
    ).not.toBeInTheDocument();
    expect(node("hub").data.hubIncomingCount).toBeUndefined();
    expect(node("t0").data.hiddenHubColumns!.size).toBe(0);
    expect(state.props!.edges!.every((e) => e.label === undefined)).toBe(true);
  });
  it("folds 10 links, excludes them from layout and toggles exact counts", () => {
    render(<SchemaVisualizer {...large} />);
    const toggle = screen.getByRole("button", { name: "Hub links" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("10 hidden");
    expect(toggle).toHaveAttribute("title", "Hub tables: hub");
    expect(state.props!.edges).toHaveLength(2);
    expect(vi.mocked(getLayoutedElements).mock.lastCall![1]).toHaveLength(2);
    expect(screen.getByText(/31 Tables · 2 Links/)).toHaveTextContent(
      "(+10 hub links hidden)",
    );
    expect(node("hub").data.hubIncomingCount).toBe(10);
    expect(node("t0").data.hiddenHubColumns!.size).toBe(2);
    expect(
      state.props!.edges!.every(
        (e) =>
          e.label === undefined &&
          e.style!.strokeWidth === 1 &&
          e.style!.opacity === 0.4 &&
          !e.animated,
      ),
    ).toBe(true);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("10 shown");
    expect(state.props!.edges).toHaveLength(12);
    expect(vi.mocked(getLayoutedElements).mock.lastCall![1]).toHaveLength(12);
    expect(screen.getByText("31 Tables · 12 Links")).toBeInTheDocument();
    expect(node("t0").data.hiddenHubColumns!.size).toBe(0);
    expect(node("hub").data.hubIncomingCount).toBe(10);
    fireEvent.click(toggle);
    expect(state.props!.edges).toHaveLength(2);
  });
  it("reveals focused hub edges without relayout and avoids hub hover fan-out", () => {
    render(<SchemaVisualizer {...large} />);
    const nodes = state.props!.nodes!;
    const calls = vi.mocked(getLayoutedElements).mock.calls.length;
    enter("hub");
    expect(state.props!.edges).toHaveLength(2);
    expect(state.props!.edges!.every((e) => e.label === undefined)).toBe(true);
    clear();
    enter("t0");
    expect(state.props!.edges).toHaveLength(3);
    expect(state.props!.nodes).toBe(nodes);
    expect(
      state.props!.edges!.filter((e) => e.label !== undefined),
    ).toHaveLength(2);
    expect(
      state.props!.edges!.find((e) => e.source === "t11")!.style!.opacity,
    ).toBe(0.15);
    clear();
    click("t0");
    expect(state.props!.edges).toHaveLength(3);
    expect(node("t1")).toBe(nodes.find((n) => n.id === "t1"));
    enter("hub");
    expect(state.props!.edges).toHaveLength(3);
    expect(
      state.props!.edges!.find((e) => e.target === "hub")!.label,
    ).toBeDefined();
    clear();
    click("hub");
    expect(state.props!.edges).toHaveLength(12);
    expect(
      state.props!.edges!.filter((e) => e.label !== undefined),
    ).toHaveLength(10);
    expect(
      state
        .props!.edges!.filter((e) => e.target === "hub")
        .every((e) => e.zIndex === -1 && e.style!.stroke === "var(--primary)"),
    ).toBe(true);
    expect(vi.mocked(getLayoutedElements).mock.calls.length).toBe(calls);
    clear();
    expect(state.props!.edges).toHaveLength(2);
    expect(state.props!.edges!.every((e) => e.label === undefined)).toBe(true);
  });
  it("chip callback selects and focuses the hub with stable reference and no relayout", () => {
    render(<SchemaVisualizer {...large} />);
    flushFrames();
    state.fitView.mockClear();
    const callback = node("t0").data.onFocusTable!;
    const calls = vi.mocked(getLayoutedElements).mock.calls.length;
    const cardProps: NodeProps<TableFlowNode> = {
      ...node("t0"),
      type: "table",
      dragging: false,
      isConnectable: false,
      selected: false,
      selectable: true,
      deletable: false,
      draggable: false,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    };
    render(
      <ReactFlowProvider>
        <FullViewport />
        <TableNode {...cardProps} />
      </ReactFlowProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "→ hub" })[0]);
    flushFrames();
    expect(node("hub").selected).toBe(true);
    expect(state.fitView).toHaveBeenCalledExactlyOnceWith({
      nodes: [{ id: "hub" }],
      padding: 0.3,
      duration: 300,
      maxZoom: 1,
    });
    expect(state.props!.edges).toHaveLength(12);
    expect(node("t0").data.onFocusTable).toBe(callback);
    expect(vi.mocked(getLayoutedElements).mock.calls.length).toBe(calls);
  });
  it("resets toggle, selection, hover and detail when tables change", () => {
    const { rerender } = render(<SchemaVisualizer {...large} />);
    fireEvent.click(screen.getByRole("button", { name: "Hub links" }));
    fireEvent.click(screen.getByRole("button", { name: "Name only" }));
    click("hub");
    enter("t0");
    rerender(<SchemaVisualizer {...large} tables={[...large.tables]} />);
    expect(screen.getByRole("button", { name: "Hub links" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Keys" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(state.props!.nodes!.every((n) => !n.selected)).toBe(true);
    expect(state.props!.edges).toHaveLength(2);
    expect(
      state.props!.edges!.every(
        (e) => e.label === undefined && e.style!.opacity === 0.4,
      ),
    ).toBe(true);
  });
  it("labels only incident edges with bounded text when links are shown", () => {
    const longName = "this_foreign_key_column_name_is_very_long";
    render(
      <SchemaVisualizer
        {...large}
        foreignKeys={[
          ...large.foreignKeys,
          { table: "t0", column: longName, foreignTable: "t1" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hub links" }));
    click("t0");
    expect(
      state.props!.edges!.filter((e) => e.label !== undefined),
    ).toHaveLength(2);
    const label = state.props!.edges!.find((e) => e.target === "t1")!.label;
    const { container } = render(
      <svg>
        <text>{label}</text>
      </svg>,
    );
    expect(container.querySelector("title")).toHaveTextContent(
      `regular, ${longName}`,
    );
    expect(
      container.querySelector("tspan")!.lastChild!.textContent,
    ).toHaveLength(28);
    expect(container.querySelector("tspan")!.lastChild!.textContent).toMatch(
      /…$/,
    );
  });
});

describe("focused edge readability", () => {
  it.each([12, 14])(
    "keeps %i focused edges under every card and applies the label limit",
    (count) => {
      const foreignKeys = [
        ...Array.from({ length: count }, (_, i) => ({
          table: `t${i}`,
          column: "created_by",
          foreignTable: "hub",
        })),
        { table: "t20", column: "regular", foreignTable: "t21" },
      ];
      render(<SchemaVisualizer {...large} foreignKeys={foreignKeys} />);
      const layoutCalls = vi.mocked(getLayoutedElements).mock.calls.length;
      click("hub");
      const focused = state.props!.edges!.filter(
        (edge) => edge.target === "hub",
      );
      expect(MAX_LABELLED_EDGES).toBe(12);
      expect(focused).toHaveLength(count);
      expect(state.props!.edges).toHaveLength(count + 1);
      expect(state.props!.elevateEdgesOnSelect).toBe(false);
      for (const edge of state.props!.edges!) {
        for (const card of state.props!.nodes!) {
          expect(edge.zIndex).toBeLessThan(card.zIndex ?? 0);
        }
      }
      expect(
        focused.every(
          (edge) =>
            edge.style!.stroke === "var(--primary)" &&
            edge.style!.opacity === 1,
        ),
      ).toBe(true);
      expect(
        focused.every((edge) =>
          count <= 12 ? edge.label !== undefined : edge.label === undefined,
        ),
      ).toBe(true);
      expect(
        focused.every(
          (edge) => edge.style!.strokeWidth === (count <= 12 ? 2.5 : 1.5),
        ),
      ).toBe(true);
      expect(
        state.props!.edges!.find((edge) => edge.source === "t20")!,
      ).toMatchObject({
        label: undefined,
        style: { strokeWidth: 1, opacity: 0.15 },
      });
      expect(vi.mocked(getLayoutedElements).mock.calls.length).toBe(
        layoutCalls,
      );
      clear();
      enter("t0");
      const normal = state.props!.edges!.find((edge) => edge.source === "t0")!;
      expect(normal.label).toBeDefined();
      expect(normal.style!.strokeWidth).toBe(2.5);
    },
  );
});
