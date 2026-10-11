/**
 * @file ai-message.test.tsx
 * @description Unit tests for the SQL Lab AI assistant message presentation and interactions.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIMessage } from "@/app/sqllab/components/ai/AIMessage";

describe("AIMessage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders streamed SQL markdown immediately without a blank placeholder", () => {
    render(
      <AIMessage
        message={{
          id: "assistant-streaming",
          role: "assistant",
          content: "```sql\nSELECT * FROM users",
          isStreaming: true,
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    expect(screen.getByText("SELECT")).toBeInTheDocument();
    expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
  });

  it("copies the assistant response content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AIMessage
        message={{
          id: "assistant-1",
          role: "assistant",
          content: "Use an indexed lookup for this query.",
          explanation: "The indexed path should reduce table scans.",
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    expect(await screen.findByText("Use an indexed lookup for this query.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /copy assistant response/i }));

    expect(writeText).toHaveBeenCalledWith(
      "Use an indexed lookup for this query.\n\nThe indexed path should reduce table scans.",
    );
    expect(screen.getByRole("button", { name: /response copied/i })).toBeInTheDocument();
  });

  it("clears the response copy reset timer when unmounted", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { unmount } = render(
      <AIMessage
        message={{
          id: "assistant-copy-unmount",
          role: "assistant",
          content: "Response to copy",
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy assistant response/i }));
    expect(screen.getByRole("button", { name: /response copied/i })).toBeInTheDocument();

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(2001);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders query tools without a manual data button", () => {
    render(
      <AIMessage
        message={{
          id: "assistant-sql",
          role: "assistant",
          content: "",
          sql: "SELECT 1;",
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^diff$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hiển thị dữ liệu/i })).not.toBeInTheDocument();
  });

  it("renders server query data immediately without executing again", () => {
    render(
      <AIMessage
        message={{ id: "result", role: "assistant", content: "", sql: "SELECT * FROM users;",
          columns: ["id", "name"], data: [{ id: 1, name: "Alice" }] }}
        onExplain={vi.fn()} onOptimize={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hiển thị dữ liệu/i })).not.toBeInTheDocument();
  });

  it("renders MongoDB queries, nested values and every bounded row and column", () => {
    const { container } = render(
      <AIMessage
        message={{ id: "mongo", role: "assistant", content: "", queryLanguage: "mongodb",
          queryText: 'db.orders.find({"status":"paid"})',
          columns: ["customer", "profile", "items", "active", "amount", "status"],
          data: Array.from({ length: 6 }, (_, i) => ({ customer: `Customer ${i}`,
            profile: { city: "Hanoi" }, items: [{ sku: "A" }], active: false, amount: 120, status: "paid" })) }}
        onExplain={vi.fn()} onOptimize={vi.fn()}
      />,
    );
    expect(screen.getByText("MongoDB Query")).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent('db.orders.find({"status":"paid"})');
    expect(screen.getByText("Customer 5")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "status" })).toBeInTheDocument();
    expect(screen.getAllByText('{"city":"Hanoi"}')).toHaveLength(6);
    expect(screen.getAllByText('[{"sku":"A"}]')).toHaveLength(6);
    expect(screen.getAllByText("false")).toHaveLength(6);
  });

  it("renders an empty successful result without a data button", () => {
    render(<AIMessage message={{ id: "empty", role: "assistant", content: "", columns: [], data: [] }}
      onExplain={vi.fn()} onOptimize={vi.fn()} />);
    expect(screen.getByText("Truy vấn thành công, không có dữ liệu phù hợp.")).toBeInTheDocument();
  });

  it("reveals saved thinking activity even when the assistant message has SQL", async () => {
    render(
      <AIMessage
        message={{
          id: "assistant-sql-thinking",
          role: "assistant",
          content: "",
          sql: "SELECT 1;",
          steps: [
            {
              type: "thinking",
              content: "Initializing context...",
              status: "complete",
            },
          ],
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /xem hoạt động trợ lý/i }));

    expect(screen.getByText("Initializing context...")).toBeInTheDocument();
  });

  it("keeps assistant activity hidden after the user hides it", async () => {
    render(
      <AIMessage
        message={{
          id: "assistant-hide-activity",
          role: "assistant",
          content: "",
          steps: [
            {
              type: "thinking",
              content: "Xác định yêu cầu của người dùng.",
              status: "complete",
            },
          ],
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /xem hoạt động trợ lý/i }));
    expect(screen.getByText("Xác định yêu cầu của người dùng.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ẩn hoạt động trợ lý/i }));

    expect(screen.getByRole("button", { name: /xem hoạt động trợ lý/i })).toBeInTheDocument();
    expect(screen.queryByText("Xác định yêu cầu của người dùng.")).not.toBeInTheDocument();
  });

  it("does not show confidence metadata after the assistant finishes", () => {
    render(
      <AIMessage
        message={{
          id: "assistant-complete-confidence",
          role: "assistant",
          content: "The query is ready.",
          confidence: 1,
          isStreaming: false,
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    expect(screen.getByText("The query is ready.")).toBeInTheDocument();
    expect(screen.queryByText(/20% Confidence/i)).not.toBeInTheDocument();
  });

  it("renders assistant SQL in a plain code block without a loading fallback", () => {
    const { container } = render(
      <AIMessage
        message={{
          id: "assistant-plain-sql",
          role: "assistant",
          content: "",
          sql: "SELECT id, name FROM users;",
        }}
        onExplain={vi.fn()}
        onOptimize={vi.fn()}
      />,
    );

    const code = container.querySelector("pre code");
    expect(code).toHaveTextContent("SELECT id, name FROM users;");
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("persists toggled thought visibility exactly once per click under StrictMode", () => {
    const onMessageUiStateChange = vi.fn();

    render(
      <React.StrictMode>
        <AIMessage
          message={{
            id: "msg-1",
            role: "assistant",
            content: "Đây là câu trả lời.",
            thought: "Đang phân tích...",
          }}
          onExplain={vi.fn()}
          onOptimize={vi.fn()}
          messageUiState={{ isThoughtVisible: false }}
          onMessageUiStateChange={onMessageUiStateChange}
        />
      </React.StrictMode>,
    );

    // StrictMode double-invokes state updater functions in development; a side
    // effect inside the updater would therefore fire twice on a single click.
    fireEvent.click(screen.getByRole("button", { name: /Xem hoạt động trợ lý/i }));
    expect(onMessageUiStateChange).toHaveBeenCalledTimes(1);
    expect(onMessageUiStateChange).toHaveBeenCalledWith("msg-1", { isThoughtVisible: true });

    fireEvent.click(screen.getByRole("button", { name: /Ẩn hoạt động trợ lý/i }));
    expect(onMessageUiStateChange).toHaveBeenCalledTimes(2);
    expect(onMessageUiStateChange).toHaveBeenLastCalledWith("msg-1", { isThoughtVisible: false });
  });
});
