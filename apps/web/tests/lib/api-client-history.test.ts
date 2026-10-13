/**
 * @file api-client-history.test.ts
 * @description Verifies the fixed query history contract and old sidecar compatibility independently of the API implementation.
 */
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { databaseApi, type QueryHistoryItem } from "@/lib/api-client";
import { server } from "../mocks/server";

const items: QueryHistoryItem[] = [
  {
    id: "1",
    sql: "SELECT '100%_\\'",
    status: "SUCCESS",
    created_on: null,
    database: { databaseName: "Sales" },
  },
  {
    id: "2",
    sql: "SELECT 2",
    status: "SUCCESS",
    database: { databaseName: "Reports" },
  },
];

describe("query history API client", () => {
  it("sends literal search/paging parameters and preserves the page envelope", async () => {
    const page = { items, hasMore: true, nextOffset: 52 };
    server.use(
      http.get("*/api/database/history", ({ request }) => {
        const url = new URL(request.url);
        expect(Object.fromEntries(url.searchParams)).toEqual({
          databaseId: "db & 1",
          q: "100%_\\",
          limit: "2",
          offset: "50",
          paginated: "true",
        });
        return HttpResponse.json(page);
      }),
    );
    expect(
      await databaseApi.getHistoryPage("db & 1", {
        q: "100%_\\",
        limit: 2,
        offset: 50,
      }),
    ).toEqual(page);
  });

  it("preserves legacy getHistory array response and its original request", async () => {
    server.use(
      http.get("*/api/database/history", ({ request }) => {
        expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
          databaseId: "db-1",
        });
        return HttpResponse.json(items);
      }),
    );
    expect(await databaseApi.getHistory("db-1")).toEqual(items);
  });

  it("normalizes old sidecar arrays as a single locally filtered legacy page", async () => {
    server.use(
      http.get("*/api/database/history", ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("limit")).toBe("50");
        expect(params.get("offset")).toBe("0");
        return HttpResponse.json(items);
      }),
    );
    expect(
      await databaseApi.getHistoryPage("db-1", { q: "  sALES  " }),
    ).toEqual({
      items: [items[0]],
      hasMore: false,
      nextOffset: null,
      legacy: true,
    });
    expect(
      (await databaseApi.getHistoryPage("db-1", { q: "100%_\\" })).items,
    ).toEqual([items[0]]);
    expect(
      (await databaseApi.getHistoryPage("db-1", { q: "missing" })).items,
    ).toEqual([]);
  });

  it("deletes only the requested database and preserves unsupported DELETE errors", async () => {
    server.use(
      http.delete("*/api/database/history", ({ request }) => {
        expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
          databaseId: "db-1",
        });
        return HttpResponse.json({ deletedCount: 61 });
      }),
    );
    expect(await databaseApi.deleteHistory("db-1")).toEqual({
      deletedCount: 61,
    });
    server.use(
      http.delete("*/api/database/history", () =>
        HttpResponse.json({ detail: "Method Not Allowed" }, { status: 405 }),
      ),
    );
    await expect(databaseApi.deleteHistory("db-1")).rejects.toThrow(
      "Method Not Allowed",
    );
  });

  it("rejects blank deletion scope without a request", async () => {
    const deleteRequest = vi.fn(() => HttpResponse.json({ deletedCount: 0 }));
    server.use(http.delete("*/api/database/history", deleteRequest));
    await expect(databaseApi.deleteHistory("  ")).rejects.toThrow(
      "Select a database",
    );
    expect(deleteRequest).not.toHaveBeenCalled();
  });
});
