/**
 * @file vector-store-workspace.test.tsx
 * @description Regression coverage for source management, map selection stability and complete chunk inspection.
 */

import { useEffect, type ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../test-utils";
import { VectorStoreMapScreen } from "@/app/settings/components/ai-settings/VectorStoreMapScreen";
import { VectorStoreMap } from "@/app/settings/components/ai-settings/VectorStoreMap";
import { VectorStoreSourceList } from "@/app/settings/components/ai-settings/VectorStoreSourceList";
import { SourceInspector } from "@/app/settings/components/ai-settings/VectorStoreSourceInspector";
import { aiApi } from "@/lib/api-client";
import type {
  RagSource,
  VectorStoreGraphNode,
} from "@/app/settings/components/ai-settings/vector-store-map-graph";

const { flow, graphs } = vi.hoisted(() => ({
  flow: { fitView: vi.fn() },
  graphs: [] as Array<
    Array<{ id: string; position: { x: number; y: number } }>
  >,
}));

// JSDOM has no graph dimensions. Browser checks cover layout; this exercises real graph construction.
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  ReactFlow: ({
    nodes,
    onInit,
    onNodeClick,
    children,
  }: {
    nodes: VectorStoreGraphNode[];
    onInit: (flow: unknown) => void;
    onNodeClick: (event: unknown, node: VectorStoreGraphNode) => void;
    children: ReactNode;
  }) => {
    useEffect(() => {
      onInit(flow);
    }, [onInit]);
    graphs.push(nodes.map(({ id, position }) => ({ id, position })));
    return (
      <div data-testid="map-graph">
        {nodes.map((node) => (
          <button
            key={node.id}
            onClick={(event) => onNodeClick(event, node)}
          >{`Select ${node.data.label}`}</button>
        ))}
        {children}
      </div>
    );
  },
  Background: () => null,
  Controls: ({ children }: { children: ReactNode }) => (
    <div role="group" aria-label="Source map controls">
      {children}
    </div>
  ),
  MiniMap: () => <div>Minimap overview</div>,
}));

vi.mock("@/lib/api-client", () => ({
  aiApi: {
    getRagStatus: vi.fn().mockResolvedValue({
      vectorStore: { enabled: true, backend: "sqlite_vec" },
    }),
    getRagPipelineStatus: vi.fn().mockResolvedValue({ stages: [] }),
    getRagSources: vi.fn(),
    getRagSource: vi.fn(),
    deleteRagSource: vi.fn().mockResolvedValue({}),
    syncRagDatabase: vi.fn().mockResolvedValue({
      summary: { chunks: 3, embeddings: 3, indexedSources: 1 },
    }),
  },
  databaseApi: {
    list: vi.fn().mockResolvedValue([
      { id: "db-a", name: "Warehouse" },
      { id: "db-b", name: "Analytics" },
    ]),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sources: RagSource[] = [
  {
    id: "a",
    title: "Warehouse schema",
    databaseId: "db-a",
    sourceType: "database_schema",
    status: "indexed",
    indexed_on: "2026-10-15T10:00:00Z",
  },
  {
    id: "b",
    title: "Analytics schema",
    databaseId: "db-b",
    sourceType: "database_schema",
    status: "pending",
    indexed_on: null,
  },
  {
    id: "c",
    title: "Team notes",
    sourceType: "free_text",
    status: "indexed",
    indexed_on: "2026-10-16T10:00:00Z",
  },
];
const labels = { "db-a": "Warehouse", "db-b": "Analytics" };
const detail = {
  ...sources[0],
  chunkCount: 35,
  chunks: Array.from({ length: 35 }, (_, index) => ({
    id: `chunk-${index + 1}`,
    objectName: `table_${index + 1}`,
    chunkType: "table",
    tokenCount: 100,
    ordinal: index,
  })),
};
const mocked = vi.mocked(aiApi);

beforeEach(() => {
  graphs.length = 0;
  mocked.getRagSources.mockResolvedValue(sources);
  mocked.getRagSource.mockResolvedValue(detail);
});
afterEach(cleanup);

async function chooseFilter(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(
      option,
    ),
  );
}

describe("Vector Store workspace", () => {
  it("toggles the minimap and refreshes from the canvas controls", () => {
    const refresh = vi.fn();
    render(<VectorStoreMap sources={sources} onRefresh={refresh} />);
    const controls = screen.getByRole("group", { name: "Source map controls" });
    const toggle = within(controls).getByRole("button", {
      name: "Toggle minimap",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Minimap overview")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("Minimap overview")).not.toBeInTheDocument();
    fireEvent.click(
      within(controls).getByRole("button", { name: "Refresh source map" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("checkbox", { name: "Minimap" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fit source map" }),
    ).not.toBeInTheDocument();
  });

  it("keeps sync collapsed and preserves source filters across the map dialog", async () => {
    render(<VectorStoreMapScreen />);
    await screen.findByRole("button", {
      name: "Inspect Warehouse schema (Warehouse)",
    });
    expect(
      screen.getByText("Database sync").closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search vector store sources" }),
      { target: { value: "Warehouse" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open map" }));
    const dialog = await screen.findByRole("dialog", { name: "Source map" });
    await within(dialog).findByTestId("map-graph");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("textbox", { name: "Search vector store sources" }),
    ).toHaveValue("Warehouse");
    expect(
      screen.queryByRole("button", {
        name: "Inspect Team notes (Shared knowledge)",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps graph positions stable after selecting a source with 35 chunks", async () => {
    render(
      <VectorStoreMap
        sources={sources}
        databaseLabels={labels}
        vectorStatus={{ enabled: true }}
        onRefresh={vi.fn()}
      />,
    );
    const before = graphs.at(-1);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByText("Minimap overview")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select Warehouse schema" }),
    );
    await screen.findByText("1–10 of 35 chunks");
    fireEvent.click(screen.getByRole("button", { name: "Next chunks" }));
    expect(screen.getByText("11–20 of 35 chunks")).toBeInTheDocument();
    expect(graphs.at(-1)).toEqual(before);
    expect(graphs.at(-1)?.some((node) => node.id.startsWith("chunk:"))).toBe(
      false,
    );
    await waitFor(() =>
      expect(flow.fitView).toHaveBeenCalledWith(
        expect.objectContaining({ nodes: [{ id: "source:a" }], minZoom: 0.65 }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close map source details" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps pagination outside scrolling content and resets pagination when searching", () => {
    render(
      <SourceInspector
        source={sources[0]}
        detail={detail}
        databaseLabels={labels}
      />,
    );
    const pagination = screen.getByRole("navigation", {
      name: "Chunk pagination",
    });
    const content = screen.getByLabelText("Source detail content");
    expect(
      within(pagination).getByText("1–10 of 35 chunks"),
    ).toBeInTheDocument();
    expect(
      within(pagination).getByRole("button", { name: "Next chunks" }),
    ).not.toHaveTextContent("Next");
    expect(
      within(pagination).getByRole("button", { name: "Previous chunks" }),
    ).not.toHaveTextContent("Previous");
    const info = screen
      .getByLabelText("Source information")
      .closest("details")!;
    expect(info).not.toHaveAttribute("open");
    fireEvent.click(screen.getByLabelText("Source information"));
    expect(info).toHaveAttribute("open");
    expect(screen.getByText("Database Schema")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Source information"));
    expect(content).not.toContainElement(
      screen.getByRole("textbox", { name: "Search chunks" }),
    );
    expect(content).not.toContainElement(pagination);
    expect(content).toContainElement(
      screen.getByRole("region", { name: "Source chunks" }),
    );
    content.scrollTop = 120;
    for (let index = 0; index < 3; index++)
      fireEvent.click(
        within(pagination).getByRole("button", { name: "Next chunks" }),
      );
    expect(content.scrollTop).toBe(0);
    expect(screen.getByText("31–35 of 35 chunks")).toBeInTheDocument();
    expect(screen.getByText("table_35")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next chunks" })).toBeDisabled();
    fireEvent.click(
      within(pagination).getByRole("button", { name: "Previous chunks" }),
    );
    expect(screen.getByText("21–30 of 35 chunks")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search chunks" }), {
      target: { value: "table_2" },
    });
    expect(
      screen.getByText("1–10 of 11 chunks matching your search"),
    ).toBeInTheDocument();
    expect(screen.getByText("table_2")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search chunks" }), {
      target: { value: "table_35" },
    });
    expect(
      within(pagination).getByText("1–1 of 1 chunks matching your search"),
    ).toBeInTheDocument();
    expect(
      within(pagination).getByRole("button", { name: "Previous chunks" }),
    ).toBeDisabled();
    expect(
      within(pagination).getByRole("button", { name: "Next chunks" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Search chunks" }), {
      target: { value: "missing" },
    });
    expect(
      within(pagination).getByText("0 chunks matching your search"),
    ).toBeInTheDocument();
    expect(
      within(pagination).getByRole("button", { name: "Next chunks" }),
    ).toBeDisabled();
  });

  it("opens the selected source in the map, preserves its row and returns focus to Open map", async () => {
    const user = userEvent.setup();
    render(<VectorStoreMapScreen />);
    await user.click(
      await screen.findByRole("button", {
        name: "Inspect Warehouse schema (Warehouse)",
      }),
    );
    await screen.findByRole("dialog", { name: "Source details" });
    await screen.findByText("1–10 of 35 chunks");
    await user.click(screen.getByRole("button", { name: "Next chunks" }));
    expect(screen.getByText("11–20 of 35 chunks")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show in map" }));
    const dialog = await screen.findByRole("dialog", { name: "Source map" });
    await within(dialog).findByText("1–10 of 35 chunks");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen
        .getByRole("button", { name: "Inspect Warehouse schema (Warehouse)" })
        .closest("tr"),
    ).toHaveAttribute("data-state", "selected");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open map" })).toHaveFocus(),
    );
  });

  it("retains disabled indexing controls when retrieval is disabled", async () => {
    mocked.getRagStatus.mockResolvedValueOnce({
      vectorStore: { enabled: false },
    });
    render(<VectorStoreMapScreen />);
    await screen.findByText("Retrieval disabled");
    fireEvent.click(screen.getByText("Database sync").closest("summary")!);
    expect(
      await screen.findByRole("button", { name: "Re-sync Warehouse" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Retrieval is disabled. Syncing will not index new content.",
      ),
    ).toBeInTheDocument();
  });

  it("reports unavailable details instead of zero chunks and supports retry", () => {
    const retry = vi.fn();
    render(<SourceInspector source={sources[0]} hasError onRetry={retry} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText(/No chunks have been indexed/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("combines database/type/status/text filters and sorts sources", async () => {
    render(
      <VectorStoreSourceList
        sources={sources}
        databaseLabels={labels}
        onDeleteSource={vi.fn()}
        onOpenMap={vi.fn()}
      />,
    );
    await chooseFilter("Filter sources by database", "Warehouse");
    await chooseFilter("Filter sources by source type", "Database Schema");
    await chooseFilter("Filter sources by status", "indexed");
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search vector store sources" }),
      { target: { value: "missing" } },
    );
    expect(
      screen.getByText("No sources match these filters."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(
      within(rows[1]).getByRole("button", {
        name: "Inspect Analytics schema (Analytics)",
      }),
    ).toBeInTheDocument();
  });

  it("requires confirmation and keeps the dialog open after failed deletion", async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({});
    render(
      <VectorStoreSourceList
        sources={sources}
        databaseLabels={labels}
        onDeleteSource={remove}
        onOpenMap={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Warehouse schema (Warehouse)",
      }),
    );
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove source" }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove source" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(remove).toHaveBeenLastCalledWith(sources[0]);
  });
});
