/**
 * @file schema-visualizer.test.tsx
 * @description Interaction checks for detail defaults, theme-independent layout, edge emphasis, and one fullscreen flow.
 */
import { act, fireEvent, render, screen } from "../../test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ReactFlow } from "@xyflow/react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { TableFlowNode } from "@/app/sqllab/components/schemavisualizer/types";

const state = vi.hoisted(() => ({
  theme: "light",
  fitView: vi.fn(async () => true),
  renders: [] as ComponentProps<typeof ReactFlow<TableFlowNode, Edge>>[],
  props: null as ComponentProps<typeof ReactFlow<TableFlowNode, Edge>> | null,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: state.theme }) }));
// JSDOM cannot measure the flow viewport. Capture its public props to test the toolbar and handlers.
vi.mock("@xyflow/react", async () => {
  const { useEffect } = await import("react");
  const instance = { fitView: state.fitView } as unknown as ReactFlowInstance<
    TableFlowNode,
    Edge
  >;
  return {
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

describe("SchemaVisualizer interactions", () => {
  it("defaults to all through 30 tables and keys above 30, preserving explicit override", () => {
    const { rerender } = render(
      <SchemaVisualizer
        {...props}
        tables={Array.from({ length: 30 }, (_, i) => `${i}`)}
      />,
    );
    expect(screen.getByRole("button", { name: "All columns" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    rerender(
      <SchemaVisualizer
        {...props}
        tables={Array.from({ length: 31 }, (_, i) => `${i}`)}
      />,
    );
    expect(screen.getByRole("button", { name: "Keys" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Name only" }));
    const sameTables = state.props!.nodes!.map((node) => node.id);
    // Changing dataset intentionally resets the override; same-reference rerenders preserve it.
    const current = { ...props, tables: sameTables };
    rerender(<SchemaVisualizer {...current} />);
    fireEvent.click(screen.getByRole("button", { name: "Name only" }));
    rerender(<SchemaVisualizer {...current} />);
    expect(screen.getByRole("button", { name: "Name only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      state.props!.nodes!.every((node) => node.data.detailLevel === "name"),
    ).toBe(true);
    rerender(<SchemaVisualizer {...props} />);
    expect(screen.getByRole("button", { name: "All columns" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("keeps layout stable on theme and hover while highlighting only incident edges", () => {
    const { rerender } = render(<SchemaVisualizer {...props} />);
    const nodes = state.props!.nodes!;
    const layoutCalls = vi.mocked(getLayoutedElements).mock.calls.length;
    state.theme = "dark";
    rerender(<SchemaVisualizer {...props} />);
    expect(state.props!.nodes).toBe(nodes);
    expect(state.props!.colorMode).toBe("dark");
    fireEvent.mouseEnter(screen.getByTestId("schema-flow"));
    // Dispatch the public node handler through React's event batching.
    const event = new MouseEvent("mouseenter") as unknown as Parameters<
      NonNullable<NonNullable<typeof state.props>["onNodeMouseEnter"]>
    >[0];
    act(() => state.props!.onNodeMouseEnter!(event, nodes[0]));
    expect(state.props!.edges![0].style).toMatchObject({
      stroke: "var(--primary)",
      strokeWidth: 2.5,
      opacity: 1,
    });
    expect(state.props!.edges![1].style).toMatchObject({ opacity: 0.15 });
    act(() => state.props!.onNodeMouseLeave!(event, nodes[0]));
    expect(
      state.props!.edges!.every((edge) => edge.style!.opacity === 0.4),
    ).toBe(true);
    act(() => state.props!.onNodeClick!(event, nodes[0]));
    expect(state.props!.edges![0].style!.stroke).toBe("var(--primary)");
    act(() => state.props!.onPaneClick!(event));
    expect(
      state.props!.edges!.every((edge) => edge.style!.opacity === 0.4),
    ).toBe(true);
    expect(vi.mocked(getLayoutedElements).mock.calls.length).toBe(layoutCalls);
  });
  it("toggles fullscreen in place and exits with Escape", () => {
    const { container } = render(<SchemaVisualizer {...props} />);
    const flow = screen.getByTestId("schema-flow");
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(container.firstElementChild).toHaveClass("fixed", "inset-0", "z-50");
    expect(screen.getAllByTestId("schema-flow")).toHaveLength(1);
    expect(screen.getByTestId("schema-flow")).toBe(flow);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.firstElementChild).not.toHaveClass("fixed");
    expect(
      screen.getByRole("button", { name: "Enter fullscreen" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("schema-flow")).toBe(flow);
    expect(state.props).toMatchObject({
      onlyRenderVisibleElements: true,
      minZoom: 0.05,
      nodesConnectable: false,
      fitView: true,
    });
    expect(state.props!.edges!.every((edge) => !edge.animated)).toBe(true);
  });
  it("marks only the selected node without changing other node references or layout", () => {
    render(<SchemaVisualizer {...props} />);
    const nodes = state.props!.nodes!;
    const calls = vi.mocked(getLayoutedElements).mock.calls.length;
    act(() => state.props!.onNodeClick!(event, nodes[0]));
    expect(state.props!.nodes![0].selected).toBe(true);
    expect(state.props!.nodes!.slice(1).every((node) => !node.selected)).toBe(
      true,
    );
    expect(state.props!.nodes![1]).toBe(nodes[1]);
    expect(state.props!.nodes![2]).toBe(nodes[2]);
    act(() => state.props!.onNodeClick!(event, nodes[1]));
    expect(state.props!.nodes![0]).toBe(nodes[0]);
    expect(state.props!.nodes![1].selected).toBe(true);
    expect(state.props!.nodes![2]).toBe(nodes[2]);
    act(() => state.props!.onPaneClick!(event));
    expect(state.props!.nodes!.every((node) => !node.selected)).toBe(true);
    expect(vi.mocked(getLayoutedElements).mock.calls.length).toBe(calls);
  });
  it("clears stale hover, selection and detail override on a different table array", () => {
    const { rerender } = render(<SchemaVisualizer {...props} />);
    const oldNode = state.props!.nodes![0];
    act(() => {
      state.props!.onNodeClick!(event, oldNode);
      state.props!.onNodeMouseEnter!(event, oldNode);
    });
    fireEvent.click(screen.getByRole("button", { name: "Name only" }));
    const next = {
      tables: ["x", "y"],
      columns: {},
      foreignKeys: [{ table: "x", column: "id", foreignTable: "y" }],
    };
    state.renders = [];
    rerender(<SchemaVisualizer {...next} />);
    expect(
      state.renders.every((rendered) =>
        rendered.edges!.every((edge) => edge.style!.opacity === 0.4),
      ),
    ).toBe(true);
    expect(state.props!.nodes!.every((node) => !node.selected)).toBe(true);
    expect(screen.getByRole("button", { name: "All columns" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    rerender(<SchemaVisualizer {...props} />);
    expect(state.props!.nodes!.every((node) => !node.selected)).toBe(true);
    expect(
      state.props!.edges!.every((edge) => edge.style!.opacity === 0.4),
    ).toBe(true);
  });
  it("resets selection and override even when the new array contains the old selected id", () => {
    const { rerender } = render(<SchemaVisualizer {...props} />);
    act(() => state.props!.onNodeClick!(event, state.props!.nodes![0]));
    fireEvent.click(screen.getByRole("button", { name: "Name only" }));
    rerender(<SchemaVisualizer {...props} tables={[...props.tables]} />);
    expect(state.props!.nodes!.every((node) => !node.selected)).toBe(true);
    expect(
      state.props!.edges!.every((edge) => edge.style!.opacity === 0.4),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "All columns" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("refits once on init, geometry/detail and fullscreen changes, but not interaction or theme", () => {
    const { rerender } = render(<SchemaVisualizer {...props} />);
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(1);
    expect(state.fitView).toHaveBeenLastCalledWith({
      minZoom: 0.05,
      maxZoom: 1,
      padding: 0.15,
    });
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(1);
    act(() => state.props!.onNodeMouseEnter!(event, state.props!.nodes![0]));
    flushFrames();
    act(() => state.props!.onNodeMouseLeave!(event, state.props!.nodes![0]));
    flushFrames();
    act(() => state.props!.onNodeClick!(event, state.props!.nodes![0]));
    flushFrames();
    act(() => state.props!.onPaneClick!(event));
    flushFrames();
    state.theme = "dark";
    rerender(<SchemaVisualizer {...props} />);
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(2);
    rerender(
      <SchemaVisualizer
        {...props}
        columns={{ a: [{ name: "id", type: "text" }] }}
      />,
    );
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(document, { key: "Escape" });
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(5);
    rerender(<SchemaVisualizer {...props} tables={[...props.tables]} />);
    flushFrames();
    expect(state.fitView).toHaveBeenCalledTimes(6);
  });
  it("registers Escape only in fullscreen and removes the matching listener on exit/unmount", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<SchemaVisualizer {...props} />);
    const keyAdds = () => add.mock.calls.filter(([type]) => type === "keydown");
    expect(keyAdds()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(keyAdds()).toHaveLength(1);
    const firstListener = keyAdds()[0][1];
    fireEvent.keyDown(document, { key: "Escape" });
    expect(remove).toHaveBeenCalledWith("keydown", firstListener);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(keyAdds()).toHaveLength(2);
    const secondListener = keyAdds()[1][1];
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", secondListener);
  });
  it("labels merged drawn pairs as Links", () => {
    render(
      <SchemaVisualizer
        {...props}
        foreignKeys={[
          ...props.foreignKeys,
          { table: "a", column: "other_id", foreignTable: "b" },
        ]}
      />,
    );
    expect(screen.getByText("3 Tables · 2 Links")).toBeInTheDocument();
    expect(state.props!.edges).toHaveLength(2);
  });
  it("keeps the empty state", () => {
    render(<SchemaVisualizer {...props} tables={[]} />);
    expect(screen.getByText("No Tables Found")).toBeInTheDocument();
    expect(screen.queryByTestId("schema-flow")).not.toBeInTheDocument();
  });
});
