/**
 * @file sql-lab-history-panel.test.tsx
 * @description Exercises history search, paging, scoped deletion and request races against independent API contract mocks.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { SQLLabHistoryPanel } from "@/app/sqllab/components/SQLLabHistoryPanel";
import type { QueryHistoryItem } from "@/lib/api-client";
import { server } from "../../mocks/server";

const lab = vi.hoisted(() => ({
  selectedDS: "db-1",
  selectedDSName: "Sales",
  selectedSchema: "public",
  setSql: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/sqllab/context/SQLLabContext", () => ({
  useSQLLabContext: () => lab,
}));
vi.mock("sonner", () => ({ toast }));
// JSDOM has no layout. Keep the real list rendering and mock only virtual row measurements.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      [0, 10, 49, 50, 60]
        .filter((index) => index < count)
        .map((index) => ({ key: index, index, start: index * 140, size: 140 })),
    getTotalSize: () => count * 140,
  }),
}));

const row = (
  id: string,
  sql: string,
  databaseName = "Sales",
): QueryHistoryItem => ({
  id,
  sql,
  database: { databaseName },
  status: "SUCCESS",
  executionTime: 2,
  created_on: null,
});
let histories: Record<string, QueryHistoryItem[]>;
let requests: URL[];
let deleteRequests: string[];
let client: QueryClient;

function renderPanel() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SQLLabHistoryPanel />
    </QueryClientProvider>,
  );
}

function switchDatabase(view: ReturnType<typeof renderPanel>, id: string) {
  lab.selectedDS = id;
  lab.selectedDSName = id === "db-1" ? "Sales" : "Reports";
  view.rerender(
    <QueryClientProvider client={client}>
      <SQLLabHistoryPanel />
    </QueryClientProvider>,
  );
}

async function openDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Delete history" }));
  await screen.findByRole("dialog");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  lab.selectedDS = "db-1";
  lab.selectedDSName = "Sales";
  histories = {
    "db-1": Array.from({ length: 61 }, (_, index) =>
      row(String(index), `SELECT ${index} AS history_${index}`),
    ),
    "db-2": [row("report", "SELECT report", "Reports")],
  };
  requests = [];
  deleteRequests = [];
  server.use(
    http.get("*/api/database/history", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const matches = (
        histories[url.searchParams.get("databaseId") || ""] || []
      ).filter(
        (item) =>
          item.sql.toLowerCase().includes(q) ||
          (item.database.databaseName || "").toLowerCase().includes(q),
      );
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      const items = matches.slice(offset, offset + limit);
      const hasMore = offset + items.length < matches.length;
      return HttpResponse.json({
        items,
        hasMore,
        nextOffset: hasMore ? offset + items.length : null,
      });
    }),
    http.delete("*/api/database/history", ({ request }) => {
      const id = new URL(request.url).searchParams.get("databaseId")!;
      deleteRequests.push(id);
      const deletedCount = histories[id].length;
      histories[id] = [];
      return HttpResponse.json({ deletedCount });
    }),
  );
});

afterEach(() => {
  cleanup();
  client?.clear();
});

describe("SQLLabHistoryPanel", () => {
  it("refreshes displayed rows when query execution invalidates the history prefix", async () => {
    renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    histories["db-1"] = [row("executed", "SELECT newly_executed")];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["history", "db-1"] });
    });
    await screen.findByText("SELECT newly_executed");
    expect(screen.queryByText("SELECT 0 AS history_0")).not.toBeInTheDocument();
  });

  it("finds matching SQL beyond the first 50 with server search", async () => {
    renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    expect(
      screen.queryByText("SELECT 60 AS history_60"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
      target: { value: " history_60 " },
    });
    await screen.findByText("SELECT 60 AS history_60");
    expect(screen.queryByText("SELECT 0 AS history_0")).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("history_60");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("loads explicit pages and resets on refresh, search and returning to a database", async () => {
    const view = renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("SELECT 60 AS history_60");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await screen.findByRole("button", { name: "Load more" });
    expect(
      screen.queryByText("SELECT 60 AS history_60"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("SELECT 60 AS history_60");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "history_60" },
    });
    await waitFor(() =>
      expect(
        screen.queryByText("SELECT 0 AS history_0"),
      ).not.toBeInTheDocument(),
    );
    await screen.findByText("SELECT 60 AS history_60");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    await screen.findByRole("button", { name: "Load more" });
    expect(
      screen.queryByText("SELECT 60 AS history_60"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("SELECT 60 AS history_60");
    switchDatabase(view, "db-2");
    await screen.findByText("SELECT report");
    expect(screen.queryByText("SELECT 0 AS history_0")).not.toBeInTheDocument();
    switchDatabase(view, "db-1");
    await screen.findByRole("button", { name: "Load more" });
    expect(
      screen.queryByText("SELECT 60 AS history_60"),
    ).not.toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
  });

  it("warns about database health stats and AI context, cancels safely, then deletes the entire database history", async () => {
    renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "history_60" },
    });
    await screen.findByText("SELECT 60 AS history_60");
    await openDelete();
    expect(
      screen.getByText(
        /Sales \(db-1\).*outside the current search.*database health stats and AI context/,
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteRequests).toEqual([]);
    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    await screen.findByText("No Query History");
    expect(deleteRequests).toEqual(["db-1"]);
    expect(histories["db-2"]).toHaveLength(1);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Deleted 61 history entries for database db-1",
      ),
    );
  });

  it("closes confirmation on database change and guards actions without a database", async () => {
    const view = renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    await openDelete();
    switchDatabase(view, "db-2");
    await screen.findByText("SELECT report");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteRequests).toEqual([]);
    const count = requests.length;
    switchDatabase(view, "");
    expect(
      screen.getByRole("button", { name: "Delete history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh history" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Select a database to view query history."),
    ).toBeVisible();
    expect(requests).toHaveLength(count);
  });

  it("shows GET errors and permits refresh recovery", async () => {
    let hasFailed = false;
    server.use(
      http.get("*/api/database/history", () => {
        if (!hasFailed) {
          hasFailed = true;
          return HttpResponse.json(
            { detail: "History unavailable" },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          items: [row("ok", "SELECT recovered")],
          hasMore: false,
          nextOffset: null,
        });
      }),
    );
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load history: History unavailable",
    );
    expect(screen.queryByText("No Query History")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await screen.findByText("SELECT recovered");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains loaded rows when load more fails and can retry the same offset", async () => {
    renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    server.use(
      http.get("*/api/database/history", () =>
        HttpResponse.json({ detail: "Page failed" }, { status: 500 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Page failed");
    expect(screen.getByText("SELECT 0 AS history_0")).toBeVisible();
    server.use(
      http.get("*/api/database/history", ({ request }) => {
        expect(new URL(request.url).searchParams.get("offset")).toBe("50");
        return HttpResponse.json({
          items: histories["db-1"].slice(50),
          hasMore: false,
          nextOffset: null,
        });
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("SELECT 60 AS history_60");
  });

  it("clearly limits old sidecar searches and keeps rows when DELETE is unsupported", async () => {
    server.use(
      http.get("*/api/database/history", () =>
        HttpResponse.json(histories["db-1"].slice(0, 50)),
      ),
      http.delete("*/api/database/history", () =>
        HttpResponse.json({ detail: "Method Not Allowed" }, { status: 405 }),
      ),
    );
    renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    expect(screen.getByRole("status")).toHaveTextContent(
      "only the latest 50 entries are searchable",
    );
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete history: Method Not Allowed",
    );
    expect(screen.getByText("SELECT 0 AS history_0")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "history_60" },
    });
    await screen.findByText("No Query History");
    expect(screen.getByRole("status")).toHaveTextContent("Update the backend");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "history_10" },
    });
    await screen.findByText("SELECT 10 AS history_10");
    expect(screen.queryByText("SELECT 0 AS history_0")).not.toBeInTheDocument();
  });

  it("ignores late GET results after switching database or search", async () => {
    const late = deferred<Response>();
    let hasStarted = false;
    server.use(
      http.get("*/api/database/history", ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("databaseId") === "db-1" && !params.get("q")) {
          hasStarted = true;
          return late.promise;
        }
        return HttpResponse.json({
          items: [row("new", "SELECT current")],
          hasMore: false,
          nextOffset: null,
        });
      }),
    );
    const view = renderPanel();
    await waitFor(() => expect(hasStarted).toBe(true));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "current" },
    });
    await screen.findByText("SELECT current");
    switchDatabase(view, "db-2");
    await screen.findByText("SELECT current");
    await act(async () => {
      late.resolve(
        HttpResponse.json({
          items: [row("late", "SELECT stale")],
          hasMore: false,
          nextOffset: null,
        }),
      );
    });
    expect(screen.queryByText("SELECT stale")).not.toBeInTheDocument();
    expect(screen.getByText("SELECT current")).toBeVisible();
  });

  it("keeps pending deletion scoped to its captured database after switching", async () => {
    const late = deferred<Response>();
    let requestedId: string | null = null;
    server.use(
      http.delete("*/api/database/history", ({ request }) => {
        requestedId = new URL(request.url).searchParams.get("databaseId");
        return late.promise;
      }),
    );
    const view = renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    await waitFor(() => expect(requestedId).toBe("db-1"));
    expect(
      screen.getByRole("button", { name: "Delete history" }),
    ).toBeDisabled();
    switchDatabase(view, "db-2");
    await screen.findByText("SELECT report");
    histories["db-1"] = [];
    await act(async () => {
      late.resolve(HttpResponse.json({ deletedCount: 61 }));
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Deleted 61 history entries for database db-1",
      ),
    );
    expect(screen.getByText("SELECT report")).toBeVisible();
    switchDatabase(view, "db-1");
    await screen.findByText("No Query History");
  });

  it("prevents an earlier GET from restoring rows after successful deletion", async () => {
    const late = deferred<Response>();
    let calls = 0;
    server.use(
      http.get("*/api/database/history", () => {
        calls += 1;
        return calls === 1
          ? late.promise
          : HttpResponse.json({ items: [], hasMore: false, nextOffset: null });
      }),
    );
    renderPanel();
    await waitFor(() => expect(calls).toBe(1));
    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    await screen.findByText("No Query History");
    await act(async () => {
      late.resolve(
        HttpResponse.json({
          items: [row("stale", "SELECT stale")],
          hasMore: false,
          nextOffset: null,
        }),
      );
    });
    expect(screen.queryByText("SELECT stale")).not.toBeInTheDocument();
    expect(screen.getByText("No Query History")).toBeVisible();
  });

  it("blocks duplicate deletion after returning to a pending database and reports late failure", async () => {
    const late = deferred<Response>();
    let deleteCalls = 0;
    server.use(
      http.delete("*/api/database/history", () => {
        deleteCalls += 1;
        return late.promise;
      }),
    );
    const view = renderPanel();
    await screen.findByText("SELECT 0 AS history_0");
    await openDelete();
    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    await waitFor(() => expect(deleteCalls).toBe(1));
    switchDatabase(view, "db-2");
    await screen.findByText("SELECT report");
    expect(
      screen.getByRole("button", { name: "Delete history" }),
    ).toBeEnabled();
    switchDatabase(view, "db-1");
    await screen.findByText("SELECT 0 AS history_0");
    expect(
      screen.getByRole("button", { name: "Delete history" }),
    ).toBeDisabled();
    await act(async () => {
      late.resolve(
        HttpResponse.json({ detail: "Delete failed" }, { status: 500 }),
      );
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not delete history for database db-1: Delete failed",
      ),
    );
    expect(screen.getByText("SELECT 0 AS history_0")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Delete history" }),
    ).toBeEnabled();
    expect(deleteCalls).toBe(1);
  });

  it("preserves copy/editor actions and renders nullable timestamps", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    server.use(
      http.get("*/api/database/history", () =>
        HttpResponse.json({
          items: [row("1", "SELECT saved")],
          hasMore: false,
          nextOffset: null,
        }),
      ),
    );
    renderPanel();
    await screen.findByText("SELECT saved");
    expect(screen.getByText("Unknown time")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy SQL" }));
    expect(writeText).toHaveBeenCalledWith("SELECT saved");
    fireEvent.click(screen.getByRole("button", { name: "Open in Editor" }));
    expect(lab.setSql).toHaveBeenCalledWith("SELECT saved");
  });
});
