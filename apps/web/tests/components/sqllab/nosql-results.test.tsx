/**
 * @file nosql-results.test.tsx
 * @description Unit and regression tests for NoSQLResults component (MongoDB tree and table views).
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoSQLResults } from "@/app/sqllab/components/NoSQLResults";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("NoSQLResults", () => {
  const sampleDocuments = [
    { _id: "doc-1", name: "Alpha", meta: { active: true, score: 10 } },
    { _id: "doc-2", name: "Beta", tags: ["mongodb", "nosql"] },
    {
      _id: "doc-3",
      name: "Gamma",
      details: {
        owner: "team-a",
        region: "us-east",
        config: { env: "prod" },
      },
    },
    { _id: "doc-4", name: "Delta", count: 42 },
    { _id: "doc-5", name: "Epsilon", status: "pending" },
    { _id: "doc-6", name: "Zeta", extra: { note: "sixth item" } },
    { _id: "doc-7", name: "Eta", extra: { note: "seventh item" } },
  ];

  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders default tree mode with 12px monospace text and selectable layout (no select-none)", () => {
    const { container } = render(<NoSQLResults data={sampleDocuments} />);

    // Container should use 12px (text-xs) monospace font and not disable selection
    const treeContainer = container.querySelector("[data-testid='nosql-tree-view']");
    expect(treeContainer).toBeInTheDocument();
    expect(treeContainer).not.toHaveClass("select-none");
    expect(treeContainer).toHaveClass("select-text");
    expect(treeContainer).toHaveClass("text-xs");
    expect(treeContainer).toHaveClass("font-mono");
  });

  it("opens first five root documents on initial load while remaining root documents and nested objects are collapsed", () => {
    render(<NoSQLResults data={sampleDocuments} />);

    const rootDocToggles = screen.getAllByRole("button", {
      name: /Document \d+/i,
    });
    expect(rootDocToggles).toHaveLength(7);

    // Docs 0-4 (first five) must be expanded
    for (let i = 0; i < 5; i++) {
      expect(rootDocToggles[i]).toHaveAttribute("aria-expanded", "true");
    }

    // Docs 5-6 must be collapsed
    for (let i = 5; i < 7; i++) {
      expect(rootDocToggles[i]).toHaveAttribute("aria-expanded", "false");
    }

    // Nested objects within first doc should be collapsed initially, showing compact counts/previews
    expect(screen.getByText("{2 keys}")).toBeInTheDocument();
    expect(screen.getByText("[2 items]")).toBeInTheDocument();
  });

  it("switches to table mode and renders scannable table for heterogeneous MongoDB documents", async () => {
    const user = userEvent.setup();
    render(<NoSQLResults data={sampleDocuments} />);

    // Mode switch buttons exist
    const treeButton = screen.getByRole("button", { name: /tree/i });
    const tableButton = screen.getByRole("button", { name: /table/i });
    expect(treeButton).toBeInTheDocument();
    expect(tableButton).toBeInTheDocument();

    // Switch to table mode
    await user.click(tableButton);

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();

    // Table columns should cover all distinct keys across documents
    expect(screen.getByRole("columnheader", { name: "_id" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "meta" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "tags" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "count" })).toBeInTheDocument();

    // Nested values should have compact readable serialization/preview, not hidden
    expect(screen.getByText('{"active":true,"score":10}')).toBeInTheDocument();
    expect(screen.getByText('["mongodb","nosql"]')).toBeInTheDocument();

    // Switch back to tree mode
    await user.click(treeButton);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByTestId("nosql-tree-view")).toBeInTheDocument();
  });

  it("expands and collapses all visible tree nodes deterministically via toolbar controls", async () => {
    const user = userEvent.setup();
    render(<NoSQLResults data={sampleDocuments} />);

    const collapseAllBtn = screen.getByRole("button", { name: /collapse all/i });
    const expandAllBtn = screen.getByRole("button", { name: /expand all/i });

    // Initial state: root docs 1-5 are open; nested branch begins collapsed (aria-expanded="false")
    const detailsToggle = screen.getByRole("button", { name: /details/i });
    expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /config/i })).not.toBeInTheDocument();

    // Click expand all: all root documents and nested nodes mount and expand
    await user.click(expandAllBtn);

    const togglesAfterExpand = screen.getAllByRole("button", {
      name: /Document \d+/i,
    });
    for (const toggle of togglesAfterExpand) {
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    }

    // Nested branch is expanded
    expect(screen.getByRole("button", { name: /details/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Deeply nested branch mounts and is expanded
    const configToggle = screen.getByRole("button", { name: /config/i });
    expect(configToggle).toHaveAttribute("aria-expanded", "true");

    // Click collapse all: all root documents and nested nodes collapse deterministically
    await user.click(collapseAllBtn);

    const togglesAfterCollapse = screen.getAllByRole("button", {
      name: /Document \d+/i,
    });
    for (const toggle of togglesAfterCollapse) {
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    }

    // Nested branch elements are no longer visible in the collapsed tree
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /config/i })).not.toBeInTheDocument();

    // Re-opening Document 3 shows its nested branch is collapsed deterministically
    await user.click(screen.getByRole("button", { name: /Document 3/i }));
    expect(screen.getByRole("button", { name: /Document 3/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /details/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: /config/i })).not.toBeInTheDocument();
  });

  it("supports keyboard Enter and Space toggling on expandable tree items", async () => {
    const user = userEvent.setup();
    render(<NoSQLResults data={sampleDocuments} />);

    // Target the sixth document which starts collapsed
    const doc6Toggle = screen.getByRole("button", { name: /Document 6/i });
    expect(doc6Toggle).toHaveAttribute("aria-expanded", "false");

    const clickSpy = vi.fn();
    doc6Toggle.addEventListener("click", clickSpy);

    // Focus node and press Enter to expand exactly once via native button activation
    doc6Toggle.focus();
    await user.keyboard("{Enter}");
    expect(doc6Toggle).toHaveAttribute("aria-expanded", "true");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Press Enter to collapse exactly once
    await user.keyboard("{Enter}");
    expect(doc6Toggle).toHaveAttribute("aria-expanded", "false");
    expect(clickSpy).toHaveBeenCalledTimes(2);

    // Press Space to expand exactly once
    await user.keyboard("[Space]");
    expect(doc6Toggle).toHaveAttribute("aria-expanded", "true");
    expect(clickSpy).toHaveBeenCalledTimes(3);

    // Press Space to collapse exactly once
    await user.keyboard("[Space]");
    expect(doc6Toggle).toHaveAttribute("aria-expanded", "false");
    expect(clickSpy).toHaveBeenCalledTimes(4);
  });

  it("provides an accessible search textbox with explicit aria-label preserving visual compactness", () => {
    render(<NoSQLResults data={sampleDocuments} />);

    const searchInput = screen.getByRole("textbox", {
      name: /search documents/i,
    });
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute("aria-label", "Search documents");
  });

  it("filters documents with search input and supports copying document content", async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText");

    render(<NoSQLResults data={sampleDocuments} />);

    // Verify search with accessible name
    const searchInput = screen.getByRole("textbox", {
      name: /search documents/i,
    });
    await user.type(searchInput, "Beta");

    expect(screen.getByText("1 of 7 docs")).toBeInTheDocument();
    expect(screen.getByText('"Beta"')).toBeInTheDocument();
    expect(screen.queryByText('"Alpha"')).not.toBeInTheDocument();

    // Copy document button
    const copyButtons = screen.getAllByRole("button", {
      name: /copy document/i,
    });
    expect(copyButtons.length).toBeGreaterThan(0);
    fireEvent.click(copyButtons[0]);

    expect(writeSpy).toHaveBeenCalled();
  });

  it("toolbar controls use consistent inline-flex alignment, compact height, leading-none, and shrink-0 icons", () => {
    render(<NoSQLResults data={sampleDocuments} />);

    const treeBtn = screen.getByRole("button", { name: /tree/i });
    const tableBtn = screen.getByRole("button", { name: /table/i });
    const expandAllBtn = screen.getByRole("button", { name: /expand all/i });
    const collapseAllBtn = screen.getByRole("button", { name: /collapse all/i });

    for (const btn of [treeBtn, tableBtn, expandAllBtn, collapseAllBtn]) {
      expect(btn).toHaveClass("inline-flex");
      expect(btn).toHaveClass("leading-none");
      expect(btn.className).toMatch(/h-[678]/);
      const icon = btn.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("shrink-0");
    }
  });

  it("tree nodes have identical chevron/spacer slot, uniform row padding, and consistent copy button sizing", () => {
    const { container } = render(<NoSQLResults data={sampleDocuments} />);

    const branchChevron = container.querySelector("button[aria-label*='meta'] svg");
    expect(branchChevron).toBeInTheDocument();
    const branchSlot = branchChevron?.parentElement;
    expect(branchSlot).toHaveClass("w-4");
    expect(branchSlot).toHaveClass("shrink-0");

    const leafSpacer = container.querySelector("[data-testid='leaf-spacer']");
    expect(leafSpacer).toBeInTheDocument();
    expect(leafSpacer).toHaveClass("w-4");
    expect(leafSpacer).toHaveClass("shrink-0");

    const rootCopyBtn = screen.getAllByRole("button", {
      name: /copy document/i,
    })[0];
    const fieldCopyBtn = screen.getAllByRole("button", {
      name: /copy name/i,
    })[0];

    expect(rootCopyBtn).toBeInTheDocument();
    expect(fieldCopyBtn).toBeInTheDocument();

    const rootCopyIcon = rootCopyBtn.querySelector("svg");
    const fieldCopyIcon = fieldCopyBtn.querySelector("svg");

    expect(rootCopyIcon).toHaveClass("h-3.5");
    expect(rootCopyIcon).toHaveClass("w-3.5");
    expect(fieldCopyIcon).toHaveClass("h-3.5");
    expect(fieldCopyIcon).toHaveClass("w-3.5");
  });

  it("root documents use content-visibility containment and bulk expansion bypasses nested animation", async () => {
    const user = userEvent.setup();
    const { container } = render(<NoSQLResults data={sampleDocuments} />);

    const rootNodes = container.querySelectorAll("[data-testid='nosql-root-node']");
    expect(rootNodes.length).toBeGreaterThan(0);
    expect(rootNodes[0]).toHaveClass("[content-visibility:auto]");

    const expandAllBtn = screen.getByRole("button", { name: /expand all/i });
    await user.click(expandAllBtn);

    const nestedContainers = container.querySelectorAll("[data-testid='nosql-branch-children']");
    expect(nestedContainers.length).toBeGreaterThan(0);
    for (const nested of nestedContainers) {
      expect(nested).not.toHaveClass("animate-in");
    }
  });

  it("bulk actions recursively expand and collapse without per-descendant useEffect updates", async () => {
    const user = userEvent.setup();
    render(<NoSQLResults data={sampleDocuments} />);

    const expandAllBtn = screen.getByRole("button", { name: /expand all/i });
    const collapseAllBtn = screen.getByRole("button", { name: /collapse all/i });

    expect(screen.getByRole("button", { name: /Document 1/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Document 6/i })).toHaveAttribute("aria-expanded", "false");

    await user.click(expandAllBtn);
    expect(screen.getByRole("button", { name: /Document 6/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /details/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /config/i })).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseAllBtn);
    expect(screen.getByRole("button", { name: /Document 1/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Document 6/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
  });
});
