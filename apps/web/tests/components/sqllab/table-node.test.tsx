/**
 * @file table-node.test.tsx
 * @description Render checks for name, keys, and all-column table cards with real React Flow handles.
 */
import { ReactFlowProvider, useStoreApi, type NodeProps } from "@xyflow/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../test-utils";
import { TableNode } from "@/app/sqllab/components/schemavisualizer/TableNode";
import type {
  DetailLevel,
  TableFlowNode,
  TableNodeData,
} from "@/app/sqllab/components/schemavisualizer/types";

function FullViewport() {
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ width: 640, height: 480, transform: [0, 0, 1] });
  }, [store]);
  return null;
}

const columns = [
  { name: "id", type: "int", primary_key: true },
  { name: "owner_id", type: "int" },
  { name: "code", type: "text" },
  { name: "description", type: "text" },
];
function renderNode(
  detailLevel: DetailLevel,
  selected = false,
  extra: Partial<TableNodeData> = {},
  onParentClick = () => {},
) {
  const data: TableNodeData = {
    label: "orders",
    columns,
    detailLevel,
    foreignKeyColumns: ["owner_id"],
    referencedColumns: ["code"],
    ...extra,
  };
  const props: NodeProps<TableFlowNode> = {
    id: "orders",
    data,
    type: "table",
    dragging: false,
    isConnectable: false,
    selected,
    selectable: true,
    deletable: false,
    draggable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
  return render(
    <ReactFlowProvider>
      <FullViewport />
      <div onClick={onParentClick}>
        <TableNode {...props} />
      </div>
    </ReactFlowProvider>,
  );
}

describe("TableNode", () => {
  it("renders the selected border", () => {
    const { container } = renderNode("keys", true);
    expect(container.querySelector(".border-primary")).toBeInTheDocument();
    expect(container.querySelector(".border-primary")).not.toHaveClass(
      "border-border",
    );
  });
  it("distinguishes key, FK and neutral icons by color and shape", () => {
    const { container } = renderNode("all");
    expect(container.querySelector('[data-column-role="key"]')).toHaveClass(
      "text-amber-500",
    );
    expect(
      container.querySelector('[data-column-role="foreign-key"]'),
    ).toHaveClass("text-primary");
    expect(container.querySelector('[data-column-role="column"]')).toHaveClass(
      "text-muted-foreground",
    );
    expect(container.querySelector('[data-column-role="key"]')).toHaveAttribute(
      "aria-label",
      "Primary or referenced key",
    );
  });
  it("shows header and count only in name mode", () => {
    const { container } = renderNode("name");
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("4 columns")).toBeInTheDocument();
    expect(screen.queryByText("owner_id")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-column-role]")).toHaveLength(0);
    expect(container.querySelectorAll(".react-flow__handle")).toHaveLength(2);
  });
  it("shows PK, foreign and referenced keys and hidden count in keys mode", () => {
    const { container } = renderNode("keys");
    ["id", "owner_id", "code", "+1 more columns"].forEach((text) =>
      expect(screen.getByText(text)).toBeInTheDocument(),
    );
    expect(screen.queryByText("description")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-column-role="key"]')).toHaveLength(
      2,
    );
    expect(
      container.querySelectorAll('[data-column-role="foreign-key"]'),
    ).toHaveLength(1);
    expect(container.querySelector(".nowheel.nodrag")).toBeInTheDocument();
  });
  it("shows all columns, neutral icon and muted type in all mode", () => {
    const { container } = renderNode("all");
    expect(screen.getByText("description")).toBeInTheDocument();
    expect(screen.queryByText(/more columns/)).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-column-role="column"]'),
    ).toHaveLength(1);
    expect(screen.getAllByText("text")[0]).toHaveClass("text-muted-foreground");
  });
});

describe("hub card metadata", () => {
  it("shows only hidden FK chips, isolates click, and displays incoming count", () => {
    const focus = vi.fn();
    const parent = vi.fn();
    renderNode(
      "all",
      false,
      {
        hiddenHubColumns: new Map([
          ["owner_id", "users"],
          ["description", "other"],
        ]),
        onFocusTable: focus,
        hubIncomingCount: 10,
      },
      parent,
    );
    const chip = screen.getByRole("button", { name: "→ users" });
    expect(chip).toHaveClass("nodrag", "nopan", "text-[9px]", "truncate");
    expect(chip).toHaveAttribute("title", "→ users");
    expect(
      screen.queryByRole("button", { name: "→ other" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Referenced by 10")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(focus).toHaveBeenCalledExactlyOnceWith("users");
    expect(parent).not.toHaveBeenCalled();
  });
  it("shows no chips with visible links and keeps badge in name mode", () => {
    renderNode("name", false, {
      hiddenHubColumns: new Map(),
      hubIncomingCount: 12,
    });
    expect(screen.getByText("Referenced by 12")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
