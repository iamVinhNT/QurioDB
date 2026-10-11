/**
 * @file ai-chat-messages-performance.test.tsx
 * @description Regression/performance-oriented tests for AIChatMessages hot paths:
 * message-list virtualization, bounded rendering windows, and render-count
 * isolation between committed history and the streaming message.
 *
 * jsdom has no layout engine, so the virtualizer measures `offsetHeight` as 0
 * and would render nothing. This suite stubs the layout numbers (bounded window
 * size + per-row height) exactly as jsdom's virtualized-table tests do, while
 * the production components render for real.
 */

import { act, fireEvent, render, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIChatMessages } from "@/app/sqllab/components/ai/AIChatMessages";
import type { Message } from "@/app/sqllab/components/ai/types";

// Render counts per message id, driven by a memoized wrapper around the real
// AIMessage component (see the module mock below).
const { renderCounts } = vi.hoisted(() => ({ renderCounts: new Map<string, number>() }));

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));
}

const noopCallbacks = {
  onExplain: vi.fn(),
  onOptimize: vi.fn(),
  onSuggestionClick: vi.fn(),
};

vi.mock("@/app/sqllab/components/ai/AIMessage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/sqllab/components/ai/AIMessage")>();
  const RealAIMessage = mod.AIMessage;
  const CountingAIMessage = React.memo((props: React.ComponentProps<typeof RealAIMessage>) => {
    renderCounts.set(props.message.id, (renderCounts.get(props.message.id) ?? 0) + 1);
    return React.createElement(RealAIMessage, props);
  });
  CountingAIMessage.displayName = "CountingAIMessage";
  return { ...mod, AIMessage: CountingAIMessage };
});

describe("AIChatMessages long-conversation rendering", () => {
  let offsetHeightSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderCounts.clear();
    // The virtualizer needs measurable layout numbers in jsdom: rows report a
    // fixed height and the scroll container a fixed viewport height.
    offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-index")) return 160;
        return 600;
      });
  });

  afterEach(() => {
    offsetHeightSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("renders a 100+ message conversation through a bounded window, not the full list", () => {
    const messages = makeMessages(120);
    const parentRef = { current: null as HTMLDivElement | null };

    const { container } = render(
      <AIChatMessages
        messages={messages}
        isTyping={false}
        isFetchingConversation={false}
        parentRef={parentRef}
        {...noopCallbacks}
      />,
    );

    const rows = container.querySelectorAll('[data-testid="ai-message-row"]');
    // A bounded window renders, but never the whole 120-message list.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(30);
    // The earliest messages are the visible ones.
    expect(container).toHaveTextContent("message 0");
    expect(container).not.toHaveTextContent("message 119");
  });

  it("renders every message for small conversations", () => {
    const messages = makeMessages(5);
    const parentRef = { current: null as HTMLDivElement | null };

    const { container } = render(
      <AIChatMessages
        messages={messages}
        isTyping={false}
        isFetchingConversation={false}
        parentRef={parentRef}
        {...noopCallbacks}
      />,
    );

    expect(container.querySelectorAll('[data-testid="ai-message-row"]')).toHaveLength(5);
    expect(container).toHaveTextContent("message 4");
  });

  it("keeps the scroll position and shifts the rendered window as the user scrolls", () => {
    const messages = makeMessages(120);
    const parentRef = { current: null as HTMLDivElement | null };

    const { container } = render(
      <AIChatMessages
        messages={messages}
        isTyping={false}
        isFetchingConversation={false}
        parentRef={parentRef}
        {...noopCallbacks}
      />,
    );

    const scrollEl = parentRef.current!;
    expect(scrollEl).not.toBeNull();
    expect(container).toHaveTextContent("message 0");

    act(() => {
      scrollEl.scrollTop = 5000;
      fireEvent.scroll(scrollEl);
    });

    // Scroll position is preserved, and the window moved into the list.
    expect(scrollEl.scrollTop).toBe(5000);
    expect(container).not.toHaveTextContent("message 0");
    expect(container).toHaveTextContent(/message (2[5-9]|3[0-9])/);
  });

  it("does not re-render committed messages when the streaming message receives a chunk", () => {
    const committed = makeMessages(4);
    const streaming = (content: string): Message => ({
      id: "stream-1",
      role: "assistant",
      content,
      isStreaming: true,
    });
    const parentRef = { current: null as HTMLDivElement | null };
    const callbacks = {
      onExplain: vi.fn(),
      onOptimize: vi.fn(),
      onSuggestionClick: vi.fn(),
    };

    const { rerender } = render(
      <AIChatMessages
        messages={committed}
        streamingMessage={streaming("chunk 1")}
        isTyping={true}
        isFetchingConversation={false}
        parentRef={parentRef}
        conversationId={null}
        {...callbacks}
      />,
    );

    // The streaming message is rendered as part of the window.
    expect(renderCounts.get("stream-1")).toBeGreaterThan(0);

    // A new chunk updates only the streaming message.
    rerender(
      <AIChatMessages
        messages={committed}
        streamingMessage={streaming("chunk 2")}
        isTyping={true}
        isFetchingConversation={false}
        parentRef={parentRef}
        conversationId={null}
        {...callbacks}
      />,
    );

    for (const message of committed) {
      expect(renderCounts.get(message.id)).toBe(1);
    }
    expect(renderCounts.get("stream-1")).toBeGreaterThan(1);
  });

  it("preserves expanded reasoning when a message scrolls out of the window and back", () => {
    // Assistant messages carry thinking steps so the reasoning section renders.
    const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      ...(i % 2 !== 0
        ? {
            steps: [
              {
                type: "thinking" as const,
                content: `reasoning ${i}`,
                status: "complete" as const,
              },
            ],
          }
        : {}),
    }));
    const parentRef = { current: null as HTMLDivElement | null };

    const { container } = render(
      <AIChatMessages
        messages={messages}
        isTyping={false}
        isFetchingConversation={false}
        parentRef={parentRef}
        {...noopCallbacks}
      />,
    );

    // Expand the reasoning of the first assistant message.
    const row = Array.from(container.querySelectorAll('[data-testid="ai-message-row"]')).find((r) =>
      /message 1(?!\d)/.test(r.textContent ?? ""),
    );
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /xem hoạt động trợ lý/i }));
    expect(
      within(row as HTMLElement).getByRole("button", { name: /ẩn hoạt động trợ lý/i }),
    ).toBeInTheDocument();
    expect(row as HTMLElement).toHaveTextContent("reasoning 1");

    // Scroll far enough that the message leaves the virtualized window.
    const scrollEl = parentRef.current!;
    act(() => {
      scrollEl.scrollTop = 9000;
      fireEvent.scroll(scrollEl);
    });
    expect(container).not.toHaveTextContent("reasoning 1");

    // Scroll back: the remounted row must keep its reasoning expanded.
    act(() => {
      scrollEl.scrollTop = 0;
      fireEvent.scroll(scrollEl);
    });
    const restoredRow = Array.from(container.querySelectorAll('[data-testid="ai-message-row"]')).find((r) =>
      /message 1(?!\d)/.test(r.textContent ?? ""),
    );
    expect(restoredRow).not.toBeNull();
    expect(
      within(restoredRow as HTMLElement).getByRole("button", { name: /ẩn hoạt động trợ lý/i }),
    ).toBeInTheDocument();
  });

  it("keeps the streaming row mounted when the stream commits so local UI state survives", () => {
    const committed = makeMessages(4);
    const streamedMessage: Message = {
      id: "stream-commit",
      role: "assistant",
      content: "final answer",
      isStreaming: true,
    };
    const parentRef = { current: null as HTMLDivElement | null };
    const callbacks = {
      onExplain: vi.fn(),
      onOptimize: vi.fn(),
      onSuggestionClick: vi.fn(),
    };

    const { rerender, container } = render(
      <AIChatMessages
        messages={committed}
        streamingMessage={streamedMessage}
        isTyping={true}
        isFetchingConversation={false}
        parentRef={parentRef}
        conversationId={null}
        {...callbacks}
      />,
    );

    const rowBefore = findRowForText(container, "final answer");
    expect(rowBefore).not.toBeNull();

    // Commit: the streamed message moves into committed history with the same id.
    const committedAfter: Message[] = [
      ...committed,
      { ...streamedMessage, isStreaming: false },
    ];

    rerender(
      <AIChatMessages
        messages={committedAfter}
        streamingMessage={null}
        isTyping={false}
        isFetchingConversation={false}
        parentRef={parentRef}
        conversationId={null}
        {...callbacks}
      />,
    );

    // The same DOM row survives the commit (no remount), so local UI state
    // such as expanded reasoning or feedback is preserved.
    expect(findRowForText(container, "final answer")).toBe(rowBefore);
    expect(container).toHaveTextContent("final answer");
  });
});

function findRowForText(container: HTMLElement, text: string): Element | null {
  const rows = Array.from(container.querySelectorAll('[data-testid="ai-message-row"]'));
  return rows.find((row) => row.textContent?.includes(text)) ?? null;
}
