/**
 * @file sql-lab-selection-run.test.tsx
 * @description Integration regressions for Monaco selection propagation into
 * SQL Lab state/context and the toolbar Run action:
 *   1. A real selection reported by the editor must reach the executed query,
 *      independently of cursor-position updates.
 *   2. A selection made in tab A must NOT leak into a Run issued on tab B
 *      before tab B's editor reports its own selection.
 *   3. A late/delayed selection callback originating from an unmounted editor
 *      instance must not restore stale text into the active tab.
 *   4. A pending debounced selection must never survive an SQL content change:
 *      neither by delivery (ownership metadata mismatch) nor at all (the real
 *      editor cancels it) — Run executes the current full SQL.
 *   5. Activation + Run inside one batched interaction resolves synchronously
 *      against the newly active tab, without waiting for effects.
 *   6. With no selection ever reported, Run executes the complete active SQL.
 */

import { act, fireEvent, render, screen, waitFor } from "../../test-utils";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, editorInstances } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  editorInstances: [] as Record<string, any>[],
}));

vi.mock("@/lib/api-client", () => ({
  databaseApi: {
     list: vi.fn(async () => ({
       data: [{ id: "db-1", type: "postgresql", databaseName: "pg-local" }],
     })),
     test: vi.fn(async () => ({ data: { success: true } })),

    getSchemas: vi.fn(async () => ["public"]),
    getTables: vi.fn(async () => []),
    getViews: vi.fn(async () => []),
    getFunctions: vi.fn(async () => []),
    getProcedures: vi.fn(async () => []),
    getTriggers: vi.fn(async () => []),
    getEvents: vi.fn(async () => []),
    getMaterializedViews: vi.fn(async () => []),
    getSequences: vi.fn(async () => []),
    getPartitions: vi.fn(async () => []),
    getRoles: vi.fn(async () => []),
    getGrants: vi.fn(async () => []),
    getTablespaces: vi.fn(async () => []),
    getExtensions: vi.fn(async () => []),
    getSynonyms: vi.fn(async () => []),
    getJobs: vi.fn(async () => []),
    getIndexes: vi.fn(async () => []),
    getForeignKeys: vi.fn(async () => []),
    getTableInfo: vi.fn(async () => null),
    getDDL: vi.fn(async () => ""),
    getColumns: vi.fn(async () => []),
    getAllColumns: vi.fn(async () => []),
    listSavedQueries: vi.fn(async () => []),
    saveQuery: vi.fn(async () => ({})),
    execute: executeMock,
    getExplainPlan: vi.fn(async () => ({})),
  },
}));

// Mock the heavy Monaco component but keep its prop contract: each mounted
// editor instance pushes its props so tests can drive the exact callbacks the
// real SQLEditor invokes (`onSelectionChange`, `onPositionChange`).
//
// `reportSelection(text)` emulates the real debounced selection channel:
// ownership metadata (owning SQL content + editor session) is frozen when the
// selection event fires, and the text is delivered through
// `onSelectionChange(text, meta)` 200ms later. It deliberately does NOT
// emulate the real editor's cancel-on-content-change lifecycle — the delivery
// side of that race must be rejected by the ownership contract alone, and the
// cancellation itself is covered at SQLEditor level.
vi.mock("@/lib/monaco/MonacoEditor", async () => {
  const React = await import("react");
  const SQLEditor = (props: Record<string, any>) => {
    const pendingRef = React.useRef<{
      timer: ReturnType<typeof setTimeout> | null;
      ownerSql: string;
      sessionId: string;
    }>({ timer: null, ownerSql: "", sessionId: "" });

    const reportSelection = (text: string) => {
      if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
      pendingRef.current.ownerSql = String(props.value ?? "");
      pendingRef.current.sessionId = String(props.selectionSessionId ?? "");
      pendingRef.current.timer = setTimeout(() => {
        props.onSelectionChange?.(text, {
          ownerSql: pendingRef.current.ownerSql,
          sessionId: pendingRef.current.sessionId,
        });
      }, 200);
    };

    // Props are frozen under React 19 dev; instances are snapshots per render.
    editorInstances.push({ ...props, reportSelection });
    return (
      <div data-testid="sql-editor" data-editor-value={String(props.value)} />
    );
  };
  return { SQLEditor };
});

import { SQLLabProvider, useSQLLabCursorContext } from "@/app/sqllab/context/SQLLabContext";
import { SQLLabToolbar } from "@/app/sqllab/components/SQLLabToolbar";
import { SQLLabEditorContainer } from "@/app/sqllab/components/SQLLabEditorContainer";

function CursorProbe() {
  const cursor = useSQLLabCursorContext();
  return (
    <div data-testid="cursor-probe">
      {`${cursor.cursorPos.lineNumber}:${cursor.cursorPos.column}`}
    </div>
  );
}

function SelectionRunHarness() {
  return (
    <SQLLabProvider>
      <SQLLabToolbar />
      <SQLLabEditorContainer enableValidation={false} />
      <CursorProbe />
    </SQLLabProvider>
  );
}

const seedTwoTabs = (
  tabASql = "SELECT 'from-a';",
  tabBSql = "SELECT 'from-b';",
) => {
  const mkTab = (id: string, name: string, sql: string) => ({
    id,
    name,
    sql,
    selectedDS: "",
    selectedSchema: "",
    results: [],
    columns: [],
    error: null,
  });
  localStorage.setItem(
    "sqllab_tabs",
    JSON.stringify([
      mkTab("tab-a", "console_a", tabASql),
      mkTab("tab-b", "console_b", tabBSql),
    ]),
  );
  localStorage.setItem("sqllab_active_tab", "tab-a");
};

const latestEditor = () => editorInstances[editorInstances.length - 1];

describe("SQLLab Run selection lifecycle", () => {
  beforeEach(() => {
    editorInstances.length = 0;
    executeMock.mockReset();
    executeMock.mockResolvedValue({ data: [], columns: [] });
    localStorage.clear();
    seedTwoTabs();
  });

  it("propagates the editor selection to the executed query independently of cursor position", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // Cursor moves first and after the selection: neither may influence Run.
    act(() => {
      latestEditor().onPositionChange?.({ lineNumber: 12, column: 34 });
    });
    expect(screen.getByTestId("cursor-probe")).toHaveTextContent("12:34");

    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    act(() => {
      latestEditor().onPositionChange?.({ lineNumber: 5, column: 7 });
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][0]).toBe("db-1");
    expect(executeMock.mock.calls[0][1]).toBe("SELECT * FROM ab_group");
    // Cursor channel stayed live and independent of the selection channel.
    expect(screen.getByTestId("cursor-probe")).toHaveTextContent("5:7");
  });

  it("does not run tab A's selection after activating tab B before B reports a selection", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // User selects text in tab A...
    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    // ...then activates tab B. Tab B's editor mounts fresh and has NOT yet
    // reported any selection when Run is clicked.
    fireEvent.click(screen.getByText("console_b"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-b';",
      ),
    );

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'from-b';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("ignores a delayed selection callback from the unmounted tab A editor", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    fireEvent.click(screen.getByText("console_b"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-b';",
      ),
    );
    const staleInstance = editorInstances.find(
      (instance) => instance.value === "SELECT 'from-a';",
    );

    // Simulates the real SQLEditor's debounced (200ms) selection callback
    // firing after its editor instance was unmounted by the tab switch.
    act(() => {
      staleInstance?.onSelectionChange?.("SELECT * FROM ab_group");
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'from-b';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("runs only the selected statement out of a multi-statement active tab", async () => {
    seedTwoTabs(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      "SELECT 'from-b';",
    );
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // User highlights only the second statement of the active tab.
    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][0]).toBe("db-1");
    expect(executeMock.mock.calls[0][1]).toBe("SELECT * FROM ab_group");
  });

  it("runs the complete active SQL when the selection is whitespace-only", async () => {
    seedTwoTabs(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      "SELECT 'from-b';",
    );
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    act(() => {
      latestEditor().onSelectionChange?.("   \n\t  ");
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    // The full multi-statement SQL must reach execute, not a mocked
    // handleRun(undefined) bypass and not the whitespace selection.
    expect(executeMock.mock.calls[0][1]).toBe(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
    );
  });

  it("invalidates tab A's stale selection after returning A→B→A without a fresh selection", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // Select in A, leave to B, then come back to A. The old selection was
    // never refreshed in the remounted editor, so it must be dead.
    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    fireEvent.click(screen.getByText("console_b"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-b';",
      ),
    );
    fireEvent.click(screen.getByText("console_a"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'from-a';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("invalidates the stored selection when the active tab's SQL content changes", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    // Typing / loading a saved query replaces the tab's SQL through the
    // editor's onChange channel.
    act(() => {
      latestEditor().onChange?.("SELECT 'replaced';");
    });
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'replaced';",
      ),
    );

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'replaced';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("runs the current full SQL when the SQL changes before a pending debounced selection is delivered", async () => {
    seedTwoTabs(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      "SELECT 'from-b';",
    );
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // Selection event schedules the debounced delivery while the editor still
    // holds the multi-statement content.
    const liveEditor = latestEditor();
    act(() => {
      liveEditor.reportSelection?.("SELECT * FROM ab_group");
    });

    // The SQL is replaced before the 200ms debounce elapses, without
    // unmounting the editor (saved query load / format / external update).
    act(() => {
      liveEditor.onChange?.("SELECT 'replaced';");
    });
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'replaced';",
      ),
    );

    // Let the debounce window fully elapse: whether the real editor cancelled
    // the pending callback or a stale delivery escaped anyway, Run must never
    // observe the pre-change selection text.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'replaced';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("never resurrects a pre-switch debounced selection delivered after its tab was left and reactivated", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // Selection scheduled on tab A's first editor mount...
    const firstMountEditor = latestEditor();
    act(() => {
      firstMountEditor.reportSelection?.("SELECT * FROM ab_group");
    });

    // ...then the user leaves to B and returns to A. The remounted A editor
    // shows no selection; only the zombie delivery from the dead instance
    // could restore one, and it must stay inert.
    fireEvent.click(screen.getByText("console_b"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-b';",
      ),
    );
    fireEvent.click(screen.getByText("console_a"));
    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'from-a';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("resolves Run synchronously against the newly active tab when activation and Run share one batched interaction", async () => {
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT 'from-a';",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // A selection exists for tab A...
    act(() => {
      latestEditor().onSelectionChange?.("SELECT * FROM ab_group");
    });

    // ...and the user activates tab B and hits Run inside the same React
    // batched interaction, before any effect (passive invalidation) can run.
    // The decision must be synchronous: tab B's full SQL executes.
    await act(async () => {
      fireEvent.click(screen.getByText("console_b"));
      fireEvent.click(runButton);
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'from-b';");
    expect(executeMock.mock.calls[0][1]).not.toBe("SELECT * FROM ab_group");
  });

  it("runs the complete active SQL exactly when no selection was ever reported", async () => {
    seedTwoTabs(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      "SELECT 'from-b';",
    );
    render(<SelectionRunHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("sql-editor")).toHaveAttribute(
        "data-editor-value",
        "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
      ),
    );
    const runButton = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(runButton).toBeEnabled());

    // No onSelectionChange ever fires.
    fireEvent.click(runButton);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][0]).toBe("db-1");
    expect(executeMock.mock.calls[0][1]).toBe(
      "SELECT * FROM ab_user\n\nSELECT * FROM ab_group",
    );
  });
});
