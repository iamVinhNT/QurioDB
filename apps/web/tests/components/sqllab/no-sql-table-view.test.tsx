/**
 * @file no-sql-table-view.test.tsx
 * @description Regression tests for MongoDB table column discovery and SQLLab table presentation.
 */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoSQLTableView } from "@/app/sqllab/components/datatable/NoSQLTableView";
import { useSettingsStore } from "@/stores/use-settings-store";

describe("NoSQLTableView", () => {
  it("renders MongoDB columns with SQLLab table styling and configured value semantics", () => {
    const previousNullText = useSettingsStore.getState().showNullAs;
    act(() => {
      useSettingsStore.getState().updateData({ showNullAs: "∅" });
    });

    try {
      const { container } = render(
        <NoSQLTableView
          data={[
            {
              _id: "doc-1",
              name: "Alpha",
              active: true,
              meta: { enabled: true },
              nullable: null,
            },
            { name: "Beta", count: 42, enabled: false },
          ]}
        />,
      );

      const table = screen.getByRole("table");
      expect(table).toHaveClass("min-w-full", "text-sm", "table-fixed", "font-mono");
      expect(
        Array.from(container.querySelectorAll("thead th"), (header) =>
          header.textContent?.trim(),
        ),
      ).toEqual(["#", "_id", "name", "active", "meta", "nullable", "count", "enabled"]);

      expect(screen.getByText("∅")).toHaveClass(
        "text-muted-foreground/40",
        "font-black",
        "uppercase",
        "text-[9px]",
      );
      expect(screen.getByText("true")).toHaveClass(
        "text-emerald-700",
        "bg-emerald-100/50",
        "rounded-sm",
      );
      expect(screen.getByText("false")).toHaveClass(
        "text-red-700",
        "bg-red-100/50",
        "rounded-sm",
      );
      expect(screen.getByText('{"enabled":true}')).toHaveClass("text-foreground/90");
    } finally {
      act(() => {
        useSettingsStore.getState().updateData({ showNullAs: previousNullText });
      });
    }
  });

  it("keeps explicit empty states for empty and non-tabular MongoDB results", () => {
    const emptyRender = render(<NoSQLTableView data={[]} />);
    expect(screen.getByText("No documents to display")).toBeInTheDocument();
    emptyRender.unmount();

    render(<NoSQLTableView data={[{}]} />);
    expect(screen.getByText("No tabular columns found in documents")).toBeInTheDocument();
  });
});
