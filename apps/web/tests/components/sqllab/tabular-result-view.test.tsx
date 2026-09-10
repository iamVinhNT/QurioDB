/**
 * @file tabular-result-view.test.tsx
 * @description Unit and regression tests for TabularResultView reusable component and SQLLab integration.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  TabularResultView,
  renderCellValue,
} from "@/app/sqllab/components/datatable/TabularResultView";
import { SQLLabDataTable } from "@/app/sqllab/components/SQLLabDataTable";

describe("TabularResultView", () => {
  it("uses SQLLab compact read-only styling and SQL value semantics", () => {
    const { container } = render(
      <TabularResultView
        columns={["name", "active", "score", "details"]}
        data={[
          {
            name: null,
            active: true,
            score: 98.5,
            details: { role: "admin" },
          },
        ]}
        nullText="(null)"
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass("min-w-full", "text-sm", "table-fixed", "font-mono");
    expect(table).not.toHaveClass("text-xs", "rounded-md", "bg-card");

    const header = screen.getByRole("columnheader", { name: "active" });
    expect(header).toHaveClass("font-black", "text-[11px]", "uppercase", "tracking-tighter");
    expect(table.querySelector("thead")).toHaveClass(
      "sticky",
      "bg-background/95",
      "backdrop-blur-md",
      "shadow-sm",
      "z-50",
    );
    expect(table.querySelector("thead")).not.toHaveClass("bg-muted/40", "z-10");

    const row = screen.getByText("98.5").closest("tr");
    expect(row).toHaveClass("hover:bg-primary/4", "odd:bg-muted/5");
    expect(row).not.toHaveClass("hover:bg-muted/30");
    expect(row?.querySelector("td")).toHaveClass("sticky", "bg-background");

    const nullSpan = screen.getByText("(null)");
    expect(nullSpan).toHaveClass(
      "text-muted-foreground/40",
      "font-black",
      "uppercase",
      "tracking-widest",
      "text-[9px]",
    );
    const trueSpan = screen.getByText("true");
    expect(trueSpan).toHaveClass(
      "text-[9px]",
      "font-black",
      "rounded-sm",
      "text-emerald-700",
      "bg-emerald-100/50",
    );
    expect(screen.getByText("98.5")).toHaveClass("text-foreground/90");
    expect(screen.getByText('{"role":"admin"}')).toHaveClass("text-foreground/90");
  });

  it("supports custom nullText prop", () => {
    render(
      <TabularResultView
        columns={["id", "name"]}
        data={[{ id: 1, name: null }]}
        nullText="(null)"
      />,
    );

    const nullSpan = screen.getByText("(null)");
    expect(nullSpan).toBeInTheDocument();
    expect(nullSpan).toHaveClass(
      "text-muted-foreground/40",
      "font-black",
      "uppercase",
      "text-[9px]",
    );
  });

  it("supports columnWidths and tableWidth with colgroup and table-fixed", () => {
    const { container } = render(
      <TabularResultView
        columns={["id", "name"]}
        data={[{ id: 1, name: "Alpha" }]}
        columnWidths={[100, 250]}
        tableWidth={398}
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toHaveClass("table-fixed");
    expect(table).toHaveStyle({ width: "398px" });

    const cols = Array.from(container.querySelectorAll("col"));
    expect(cols).toHaveLength(3);
    expect(cols[0].style.width).toBe("48px");
    expect(cols[1].style.width).toBe("100px");
    expect(cols[2].style.width).toBe("250px");
  });

  it("supports virtualized rows and spacer heights", () => {
    const { container } = render(
      <TabularResultView
        columns={["id", "name"]}
        data={[
          { id: 1, name: "First" },
          { id: 2, name: "Second" },
          { id: 3, name: "Third" },
        ]}
        virtualRows={[{ index: 1, start: 40, size: 40, end: 80, key: 1 }]}
        totalSize={200}
      />,
    );

    const rows = container.querySelectorAll("tbody tr");
    // Top spacer + 1 virtual item + bottom spacer = 3 tr elements
    expect(rows).toHaveLength(3);

    const topSpacer = rows[0].querySelector("td");
    expect(topSpacer?.style.height).toBe("40px");

    const bottomSpacer = rows[2].querySelector("td");
    expect(bottomSpacer?.style.height).toBe("120px");

    // The rendered data row is index 1 (second item)
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
  });

  it("supports onCellClick and getCellClassName callbacks", () => {
    const clickSpy = vi.fn();
    const getClassName = vi.fn((col) => (col === "name" ? "custom-name-cell" : undefined));

    const { container } = render(
      <TabularResultView
        columns={["id", "name"]}
        data={[{ id: 1, name: "Clickable" }]}
        onCellClick={clickSpy}
        getCellClassName={getClassName}
      />,
    );

    const nameCell = container.querySelector(".custom-name-cell");
    expect(nameCell).toBeInTheDocument();

    fireEvent.click(nameCell!);
    expect(clickSpy).toHaveBeenCalledWith(
      "name",
      "Clickable",
      { id: 1, name: "Clickable" },
      0,
    );
  });

  it("renders emptyContent when provided", () => {
    render(
      <TabularResultView
        columns={["id"]}
        data={[]}
        emptyContent={<div data-testid="custom-empty">No results found</div>}
      />,
    );

    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("SQLLabDataTable keeps the shared SQL read-only renderer", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);

    render(
      <SQLLabDataTable
        columns={["id", "status", "active", "count", "meta"]}
        data={[
          {
            id: 1,
            status: null,
            active: true,
            count: 42,
            meta: { env: "prod" },
          },
        ]}
      />,
    );

    expect(screen.getByText("true")).toHaveClass("text-emerald-700", "bg-emerald-100/50");
    expect(screen.getByText("42")).toHaveClass("text-foreground/90");
    expect(screen.getByText('{"env":"prod"}')).toHaveClass("text-foreground/90");
    expect(screen.getByText("(null)")).toHaveClass("text-muted-foreground/40");
  });
});
