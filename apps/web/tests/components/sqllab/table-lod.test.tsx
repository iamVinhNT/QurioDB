/**
 * @file table-lod.test.tsx
 * @description Real React Flow store tests for table LOD, hysteresis, and render isolation.
 */
import { Profiler, useState } from "react";
import { ReactFlowProvider, useStoreApi, type NodeProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import { TableNode } from "@/app/sqllab/components/schemavisualizer/TableNode";
import {
  getNodeHeight,
  NODE_WIDTH,
} from "@/app/sqllab/components/schemavisualizer/graph";
import {
  LOD_COMPACT_BELOW,
  LOD_FULL_ABOVE,
} from "@/app/sqllab/components/schemavisualizer/useTableLod";
import type {
  DetailLevel,
  TableFlowNode,
} from "@/app/sqllab/components/schemavisualizer/types";

function renderCard(detailLevel: DetailLevel = "keys", initialZoom?: number) {
  let store: ReturnType<typeof useStoreApi>;
  function CaptureStore() {
    store = useStoreApi();
    return null;
  }
  const props: NodeProps<TableFlowNode> = {
    id: "orders",
    type: "table",
    dragging: false,
    isConnectable: false,
    selected: true,
    selectable: true,
    deletable: false,
    draggable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      label: "orders",
      detailLevel,
      columns: [
        { name: "id", type: "int", primary_key: true },
        { name: "owner_id", type: "int" },
        { name: "description", type: "text" },
      ],
      foreignKeyColumns: ["owner_id"],
      referencedColumns: [],
      hiddenHubColumns: new Map([["owner_id", "users"]]),
      hubIncomingCount: 14,
      onFocusTable: vi.fn(),
    },
  };
  const commits = vi.fn();
  let addNode!: () => void;
  const secondProps: NodeProps<TableFlowNode> = {
    ...props,
    id: "second",
    data: { ...props.data, label: "second" },
  };
  function Cards() {
    const [lateNodes, setLateNodes] = useState(0);
    addNode = () => setLateNodes((count) => count + 1);
    return (
      <div
        data-testid="node-box"
        style={{ width: NODE_WIDTH, height: getNodeHeight(props.data) }}
      >
        <Profiler id="table" onRender={commits}>
          <TableNode {...props} />
        </Profiler>
        {Array.from({ length: lateNodes }, (_, index) => (
          <Profiler key={index} id={`late-${index}`} onRender={commits}>
            <TableNode
              {...secondProps}
              id={`late-${index}`}
              data={{ ...secondProps.data, label: `late-${index}` }}
            />
          </Profiler>
        ))}
      </div>
    );
  }
  const result = render(
    <ReactFlowProvider
      initialNodes={[
        {
          id: "orders",
          type: "table",
          position: { x: 40, y: 80 },
          width: NODE_WIDTH,
          height: getNodeHeight(props.data),
          data: props.data,
          selected: true,
        },
      ]}
    >
      <CaptureStore />
      <Cards />
    </ReactFlowProvider>,
  );
  function zoom(value: number, ready = true, fitViewQueued = false) {
    act(() =>
      store!.setState({
        transform: [10, 20, value],
        width: ready ? 640 : 0,
        height: ready ? 480 : 0,
        fitViewQueued,
      }),
    );
  }
  if (initialZoom !== undefined) zoom(initialZoom);
  return {
    ...result,
    zoom,
    commits,
    addNode: () => act(() => addNode()),
    store: store!,
    data: props.data,
    card: () => result.container.querySelector("[data-lod]")!,
  };
}

describe("table viewport LOD", () => {
  it("starts compact until viewport dimensions and initial fitView are ready", () => {
    const view = renderCard();
    expect(view.card()).toHaveAttribute("data-lod", "compact");
    expect(screen.queryByText("owner_id")).not.toBeInTheDocument();
    view.zoom(1, false);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
    view.zoom(1, true, true);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
    view.zoom(0.1);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
    view.zoom(LOD_FULL_ABOVE);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    expect(screen.getByText("owner_id")).toBeInTheDocument();
  });
  it("latches readiness: a later refit or zero-size viewport does not turn ready cards compact", () => {
    const view = renderCard("keys", 0.5);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    // SchemaVisualizer calls fitView on every geometry/fullscreen change, which queues a fit again.
    view.zoom(0.5, true, true);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    view.zoom(0.5, false);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    view.zoom(0.1);
    view.zoom(0.1, true, true);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
    view.zoom(0.1, false);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
  });
  it.each(["keys", "all", "name"] as const)(
    "omits rows/footer/chips at overview in %s mode without changing the box or handles",
    (detail) => {
      const view = renderCard(detail, 0.1);
      const box = screen.getByTestId("node-box");
      const originalStyle = box.getAttribute("style");
      expect(view.card()).toHaveClass("h-full", "border-primary");
      expect(screen.getByText("orders")).toHaveAttribute("title", "orders");
      expect(screen.getByText("3 columns")).toBeInTheDocument();
      expect(screen.getByText("Referenced by 14")).toBeInTheDocument();
      expect(
        view.container.querySelectorAll("[data-column-role]"),
      ).toHaveLength(0);
      expect(view.container.querySelector(".nowheel")).toBeNull();
      expect(screen.queryByText(/more columns/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(
        view.container.querySelector("[data-lod-body]"),
      ).toBeInTheDocument();
      expect(
        view.container.querySelectorAll(".react-flow__handle"),
      ).toHaveLength(2);
      view.zoom(0.5);
      expect(view.card()).toHaveAttribute("data-lod", "full");
      expect(box).toHaveAttribute("style", originalStyle!);
      expect(
        view.container.querySelectorAll(".react-flow__handle"),
      ).toHaveLength(2);
      if (detail === "name") {
        expect(view.container.querySelector(".nowheel")).toBeNull();
      } else {
        expect(screen.getByText("owner_id")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "→ users" }),
        ).toBeInTheDocument();
        if (detail === "keys")
          expect(screen.getByText("+1 more columns")).toBeInTheDocument();
        else expect(screen.getByText("description")).toBeInTheDocument();
      }
      view.zoom(0.1);
      expect(box).toHaveAttribute("style", originalStyle!);
      expect(view.card()).toHaveAttribute("data-lod", "compact");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
  it("preserves the previous flag in both directions through the hysteresis band", () => {
    const view = renderCard("all", 0.1);
    expect(LOD_COMPACT_BELOW).toBe(0.3);
    expect(LOD_FULL_ABOVE).toBe(0.36);
    for (const value of [0.3, 0.32, 0.359]) {
      view.zoom(value);
      expect(view.card()).toHaveAttribute("data-lod", "compact");
    }
    view.zoom(0.36);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    for (const value of [0.35, 0.32, 0.3]) {
      view.zoom(value);
      expect(view.card()).toHaveAttribute("data-lod", "full");
    }
    view.zoom(0.299);
    expect(view.card()).toHaveAttribute("data-lod", "compact");
  });
  it("shares full and compact hysteresis values with cards mounted inside the band", () => {
    const view = renderCard("all", 0.5);
    view.zoom(0.32);
    expect(view.card()).toHaveAttribute("data-lod", "full");
    view.addNode();
    expect(view.container.querySelectorAll('[data-lod="full"]')).toHaveLength(
      2,
    );
    view.zoom(0.29);
    expect(
      view.container.querySelectorAll('[data-lod="compact"]'),
    ).toHaveLength(2);
    view.zoom(0.32);
    view.addNode();
    expect(
      view.container.querySelectorAll('[data-lod="compact"]'),
    ).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-lod="full"]')).toHaveLength(
      0,
    );
  });
  it("keeps hysteresis isolated between two flow stores", () => {
    const fullFlow = renderCard("all", 0.5);
    const compactFlow = renderCard("all", 0.1);
    fullFlow.zoom(0.32);
    compactFlow.zoom(0.32);
    fullFlow.addNode();
    compactFlow.addNode();
    expect(
      fullFlow.container.querySelectorAll('[data-lod="full"]'),
    ).toHaveLength(2);
    expect(
      compactFlow.container.querySelectorAll('[data-lod="compact"]'),
    ).toHaveLength(2);
    fullFlow.zoom(0.29);
    expect(
      fullFlow.container.querySelectorAll('[data-lod="compact"]'),
    ).toHaveLength(2);
    expect(
      compactFlow.container.querySelectorAll('[data-lod="compact"]'),
    ).toHaveLength(2);
  });
  it("commits once per flag flip and never per zoom tick, keeping graph state unchanged", () => {
    const view = renderCard("all", 0.1);
    view.commits.mockClear();
    const nodes = view.store.getState().nodes;
    const edges = view.store.getState().edges;
    const setNodes = vi.spyOn(view.store.getState(), "setNodes");
    const setEdges = vi.spyOn(view.store.getState(), "setEdges");
    for (const value of [0.15, 0.2, 0.3, 0.35]) view.zoom(value);
    expect(view.commits).not.toHaveBeenCalled();
    view.zoom(0.36);
    expect(view.commits).toHaveBeenCalledTimes(1);
    for (const value of [0.37, 0.5, 0.8, 0.35, 0.3]) view.zoom(value);
    expect(view.commits).toHaveBeenCalledTimes(1);
    view.zoom(0.29);
    expect(view.commits).toHaveBeenCalledTimes(2);
    for (const value of [0.28, 0.1, 0.31]) view.zoom(value);
    expect(view.commits).toHaveBeenCalledTimes(2);
    expect(view.store.getState().nodes).toBe(nodes);
    expect(nodes[0].data).toBe(view.data);
    expect(nodes[0].position).toEqual({ x: 40, y: 80 });
    expect(nodes[0].height).toBe(132);
    expect(nodes[0].selected).toBe(true);
    expect(view.store.getState().fitViewQueued).toBe(false);
    expect(view.store.getState().edges).toBe(edges);
    expect(setNodes).not.toHaveBeenCalled();
    expect(setEdges).not.toHaveBeenCalled();
    expect(view.card()).toHaveClass("border-primary");
    expect(getNodeHeight(view.data)).toBe(132);
  });
});
