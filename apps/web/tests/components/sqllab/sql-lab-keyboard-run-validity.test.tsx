/**
 * @file sql-lab-keyboard-run-validity.test.tsx
 * @description Regression: the Ctrl/Cmd+Enter keyboard run path must pass
 * through the SAME synchronous validity boundary (active tab + owning SQL +
 * editor session) as toolbar Run. A Monaco selection that was carved out of
 * content that no longer matches the authoritative active-tab SQL mirror —
 * e.g. Format or a saved-query load happened in the same batched interaction,
 * before the updated model event/render reached the editor — must never be
 * executed as an override; the NEW full tab SQL runs instead. A valid
 * immediate keyboard selection (no intervening mutation) still executes the
 * exact selected text, and an empty/collapsed selection still falls back to
 * the complete editor content.
 *
 * The fake Monaco keeps its model content deliberately independent of the
 * React `value` prop: like @monaco-editor/react, the model only receives new
 * text through a later commit, so tests can hold the model stale while the
 * SQL mirror has already advanced — exactly the window under regression.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "../../test-utils";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "sql-formatter";

const h = vi.hoisted(() => {
  const state: any = {
    selectionListeners: [] as Array<(e: any) => void>,
    positionListeners: [] as Array<(e: any) => void>,
    commands: [] as Array<{ keybinding: number; handler: () => void }>,
    /** Current Monaco selection: a `{ text }` range or `null`. */
    activeSelection: null as { text: string } | null,
    /**
     * Content of the live Monaco model. Independent from the React `value`
     * prop so tests can reproduce the pre-model-update window.
     */
    modelContent: "",
    sessionIds: [] as Array<string | undefined>,
  };
  state.editorApi = {
    onDidChangeCursorSelection: (cb: (e: any) => void) => {
      state.selectionListeners.push(cb);
      return { dispose: () => {} };
    },
    onDidChangeCursorPosition: (cb: (e: any) => void) => {
      state.positionListeners.push(cb);
      return { dispose: () => {} };
    },
    addCommand: (keybinding: number, handler: () => void) => {
      state.commands.push({ keybinding, handler });
    },
    getSelection: () => state.activeSelection,
    getModel: () => ({
      getValueInRange: (range: any) => range?.text ?? "",
      getValue: () => state.modelContent,
    }),
  };
  state.monacoApi = {
    editor: { setTheme: () => {}, defineTheme: () => {} },
    KeyMod: {
      CtrlCmd: 1 << 11,
      Shift: 1 << 10,
      Alt: 1 << 9,
    },
    KeyCode: {
      Enter: 10,
      KeyS: 11,
      KeyF: 12,
      KeyX: 13,
    },
  };
  return state;
});

// Mock the direct SQLEditor boundary used by the lazy editor container. This
// keeps the test harness independent from the Monaco package import while
// preserving the production keyboard and selection ownership contract.
vi.mock("@/lib/monaco/MonacoEditor", async () => {
  const React = await import("react");
  const SQLEditor = (props: Record<string, any>) => {
    const valueRef = React.useRef(props.value);
    const sessionRef = React.useRef(props.selectionSessionId);
    const runRef = React.useRef(props.onRun);
    const formatRef = React.useRef(props.onFormat);
    valueRef.current = props.value;
    sessionRef.current = props.selectionSessionId;
    runRef.current = props.onRun;
    formatRef.current = props.onFormat;

    React.useEffect(() => {
      const commandStart = h.commands.length;
      const selectionStart = h.selectionListeners.length;
      const positionStart = h.positionListeners.length;
      const selectionTimeouts = new Set<ReturnType<typeof setTimeout>>();

      const selectionListener = (event: any) => {
        const ownerSql = valueRef.current;
        const sessionId = sessionRef.current;
        const timeout = setTimeout(() => {
          selectionTimeouts.delete(timeout);
          props.onSelectionChange?.(
            h.editorApi.getModel().getValueInRange(event.selection) || "",
            { ownerSql, sessionId: sessionId ?? "" },
          );
        }, 200);
        selectionTimeouts.add(timeout);
      };
      h.selectionListeners.push(selectionListener);
      h.commands.push({
        keybinding: CTRL_ENTER,
        handler: () => {
          const selectedText = h.editorApi
            .getModel()
            .getValueInRange(h.editorApi.getSelection());
          if (!selectedText?.trim()) {
            runRef.current?.(undefined);
            return;
          }
          runRef.current?.(selectedText, {
            text: selectedText,
            ownerSql: h.editorApi.getModel().getValue(),
            sessionId: sessionRef.current ?? "",
          });
        },
      });
      return () => {
        selectionTimeouts.forEach(clearTimeout);
        h.commands.splice(commandStart);
        h.selectionListeners.splice(selectionStart);
        h.positionListeners.splice(positionStart);
      };
    }, []);

    React.useEffect(() => {
      formatRef.current = props.onFormat;
    }, [props.onFormat]);

    return React.createElement("div", { "data-testid": "fake-monaco" });
  };
  return { SQLEditor };
});


vi.mock("@/lib/monaco/useEditorValidation", () => {
  const validate = () => Promise.resolve({ markers: [] });
  return {
    useEditorValidation: () => ({ errors: [], validate, clearMarkers: () => {} }),
  };
});
vi.mock("@/lib/monaco/useRevealPositionRequest", () => ({
  useRevealPositionRequest: () => {},
}));
vi.mock("@/lib/monaco/ErrorPanel", () => ({ ErrorPanel: () => null }));
vi.mock("@/stores/use-settings-store", () => ({
  useSettingsStore: () => ({
    editorInlineSuggestions: false,
    editorMinimap: false,
    editorTabSize: 4,
    editorFontSize: 13,
    editorFontFamily: "monospace",
    editorWordWrap: "off",
    editorLineNumbers: "on",
    editorLigatures: false,
    editorFormatOnPaste: false,
    defaultQueryLimit: 100,
  }),
}));
vi.mock("@/lib/monaco/themes", () => ({ defineThemes: () => {} }));
vi.mock("@/lib/monaco/sql-autocomplete", () => ({
  registerSqlAutocomplete: () => ({ dispose: () => {} }),
  registerSqlSuggestOnTyping: () => ({ dispose: () => {} }),
}));
vi.mock("@/lib/monaco/mongodb-autocomplete", () => ({
  registerMongoAutocomplete: () => ({ dispose: () => {} }),
}));
vi.mock("@/lib/monaco/redis-autocomplete", () => ({
  registerRedisAutocomplete: () => ({ dispose: () => {} }),
}));

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  databaseApi: {
    list: vi.fn(async () => ({
      data: [{ id: "db-1", type: "postgresql", databaseName: "pg-local" }],
    })),
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
    saveQuery: vi.fn(async () => ({ id: "sq-1" })),
    execute: executeMock,
    getExplainPlan: vi.fn(async () => ({})),
  },
}));

import { SQLLabProvider, useSQLLabContext } from "@/app/sqllab/context/SQLLabContext";
import { SQLLabToolbar } from "@/app/sqllab/components/SQLLabToolbar";
import { SQLLabEditorContainer } from "@/app/sqllab/components/SQLLabEditorContainer";

const CTRL_ENTER = h.monacoApi.KeyMod.CtrlCmd | h.monacoApi.KeyCode.Enter;

function getCtrlEnterHandler(): () => void {
  const command = h.commands.find(
    (cmd: { keybinding: number }) => cmd.keybinding === CTRL_ENTER,
  );
  expect(command, "Ctrl/Cmd+Enter command must be registered").toBeTruthy();
  return command!.handler;
}

/** Captures the live context so tests can inspect the validity boundary. */
const labCaptures: Array<ReturnType<typeof useSQLLabContext>> = [];

function LabProbe() {
  labCaptures.push(useSQLLabContext());
  return null;
}

/** Drives the production saved-query load handler through the real context. */
function SavedQueryLoadProbe({ saved }: { saved: Record<string, any> }) {
  const lab = useSQLLabContext();
  return (
    <button onClick={() => lab.handleSelectSavedQuery(saved)}>
      load-saved-probe
    </button>
  );
}

function Harness({ saved }: { saved?: Record<string, any> }) {
  return (
    <SQLLabProvider>
      <LabProbe />
      <SQLLabToolbar />
      <SQLLabEditorContainer enableValidation={false} />
      {saved ? <SavedQueryLoadProbe saved={saved} /> : null}
    </SQLLabProvider>
  );
}

const MULTI_SQL = "SELECT * FROM ab_user\n\nSELECT * FROM ab_group";
const SELECTED_STATEMENT = "SELECT * FROM ab_group";
const FORMATTED_SQL = () => format(MULTI_SQL, { language: "postgresql" });

const seedOneTab = (sql: string) => {
  localStorage.setItem(
    "sqllab_tabs",
    JSON.stringify([
      {
        id: "tab-a",
        name: "console_a",
        sql,
        selectedDS: "",
        selectedSchema: "",
        results: [],
        columns: [],
        error: null,
      },
    ]),
  );
  localStorage.setItem("sqllab_active_tab", "tab-a");
};

async function setupEditor(sql = MULTI_SQL, saved?: Record<string, any>) {
  seedOneTab(sql);
  // The visible model starts in sync with the tab SQL.
  h.modelContent = sql;
  render(<Harness saved={saved} />);
  await waitFor(() =>
    expect(screen.getByTestId("fake-monaco")).toBeInTheDocument(),
  );
  const runButton = screen.getByRole("button", { name: "Run" });
  await waitFor(() => expect(runButton).toBeEnabled());
  const latestLab = () => labCaptures[labCaptures.length - 1];
  await waitFor(() => expect(latestLab().selectedDS).toBe("db-1"));
  return latestLab;
}

/** Emits a real selection-change event and waits for the debounced report. */
async function selectStatement(text: string) {
  h.activeSelection = { text };
  await act(async () => {
    h.selectionListeners.forEach((cb: (e: any) => void) =>
      cb({ selection: { text } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

describe("keyboard run shares the selection validity boundary", () => {
  beforeEach(() => {
    cleanup();
    labCaptures.length = 0;
    h.selectionListeners.length = 0;
    h.positionListeners.length = 0;
    h.commands.length = 0;
    h.activeSelection = null;
    h.sessionIds.length = 0;
    executeMock.mockReset();
    executeMock.mockResolvedValue({ data: [], columns: [] });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    labCaptures.length = 0;
    h.selectionListeners.length = 0;
    h.positionListeners.length = 0;
    h.commands.length = 0;
    h.activeSelection = null;
    h.sessionIds.length = 0;
    executeMock.mockReset();
    localStorage.clear();
  });

  it("runs the formatted full SQL when Format and Ctrl+Enter share one batched interaction before the model update", async () => {
    const latestLab = await setupEditor();
    await selectStatement(SELECTED_STATEMENT);
    expect(latestLab().resolveSelectedSql()).toBe(SELECTED_STATEMENT);

    // One batched interaction: Format mutates the SQL mirror, then the
    // keyboard fires BEFORE the updated model event/render reaches Monaco
    // (h.modelContent intentionally left at the pre-format content).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Format" }));
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe(FORMATTED_SQL());
    expect(executeMock.mock.calls[0][1]).not.toBe(SELECTED_STATEMENT);
    // The shared boundary rejects the stale selection synchronously.
    expect(latestLab().resolveSelectedSql()).toBe("");
  });

  it("runs the loaded saved query when the load and Ctrl+Enter share one batched interaction", async () => {
    const saved = {
      id: "sq-1",
      name: "Loaded Q",
      sql: "SELECT 'loaded';",
      databaseId: "db-1",
    };
    const latestLab = await setupEditor(MULTI_SQL, saved);
    await selectStatement(SELECTED_STATEMENT);
    expect(latestLab().resolveSelectedSql()).toBe(SELECTED_STATEMENT);

    await act(async () => {
      fireEvent.click(screen.getByText("load-saved-probe"));
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe("SELECT 'loaded';");
    expect(executeMock.mock.calls[0][1]).not.toBe(SELECTED_STATEMENT);
  });

  it("executes the exact immediate keyboard selection that is still valid", async () => {
    const latestLab = await setupEditor();
    // Immediate press: selection made on the current content, before any
    // debounced report has been delivered — the keyboard path itself carries
    // the ownership facts, so it must not depend on the debounced store.
    h.activeSelection = { text: SELECTED_STATEMENT };

    await act(async () => {
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe(SELECTED_STATEMENT);
    expect(executeMock.mock.calls[0][1]).not.toBe(MULTI_SQL);
  });

  it("still executes the exact selection after the debounced report was delivered", async () => {
    await setupEditor();
    await selectStatement(SELECTED_STATEMENT);
    h.activeSelection = { text: SELECTED_STATEMENT };

    await act(async () => {
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe(SELECTED_STATEMENT);
  });

  it("falls back to the complete editor content for a collapsed selection", async () => {
    await setupEditor();
    h.activeSelection = { text: "" };

    await act(async () => {
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe(MULTI_SQL);
  });

  it("falls back to the complete editor content for a whitespace-only selection", async () => {
    await setupEditor();
    h.activeSelection = { text: "  \n\t  " };

    await act(async () => {
      getCtrlEnterHandler()();
    });

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    expect(executeMock.mock.calls[0][1]).toBe(MULTI_SQL);
  });
});
