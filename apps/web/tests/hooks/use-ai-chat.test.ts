/**
 * @file use-ai-chat.test.ts
 * @description Regression tests for SQL Lab AI chat stream status handling.
 */

import { act, renderHook, waitFor } from "../test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiApi } from "@/lib/api-client";
import {
  getActiveAIConversationStorageKey,
  isLabeledThinkingEvent,
  isStatusThinkingEvent,
  stripInternalToolEnvelopes,
  stripThinkingLabel,
  translateThinkingStatus,
  useAIChat,
} from "@/app/sqllab/hooks/useAIChat";

describe("useAIChat stream status handling", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recognizes localized startup statuses so they render as separate activity steps", () => {
    expect(isStatusThinkingEvent("Đang khởi tạo bối cảnh...")).toBe(true);
    expect(isStatusThinkingEvent("Phân tích lược đồ...")).toBe(true);
  });

  it("does not classify model reasoning as a status event", () => {
    expect(isStatusThinkingEvent("I will inspect tables before writing SQL.")).toBe(false);
  });

  it("recognizes ready statuses so following reasoning does not merge into them", () => {
    expect(isStatusThinkingEvent("Sẵn sàng.")).toBe(true);
    expect(isStatusThinkingEvent("Intent: Xác định người dùng sử dụng từ ngữ nhạy cảm.")).toBe(false);
  });

  it("translates legacy English SQL thinking statuses before display", () => {
    expect(translateThinkingStatus("Generating SQL...")).toBe("Đang tạo SQL...");
    expect(translateThinkingStatus("Testing generated SQL safely...")).toBe("Đang chạy thử SQL đã tạo một cách an toàn...");
    expect(translateThinkingStatus("SQL preview passed.")).toBe("SQL đã chạy thử thành công.");
    expect(translateThinkingStatus("Preview failed; repairing SQL (1/2)...")).toBe("Bản chạy thử thất bại; đang sửa SQL (1/2)...");
  });

  it("recognizes labeled thinking events as separate stream steps", () => {
    expect(isLabeledThinkingEvent("Intent: Xác định người dùng sử dụng từ ngữ nhạy cảm.")).toBe(true);
    expect(isLabeledThinkingEvent("Schema mapping: use voice_message_meta.transcription.")).toBe(true);
    expect(isLabeledThinkingEvent("Strategy: scan transcripts with a keyword filter.")).toBe(true);
    expect(isLabeledThinkingEvent("Continue the previous sentence.")).toBe(false);
  });

  it("removes thinking labels from assistant-visible activity", () => {
    expect(stripThinkingLabel("Intent: Xác định người dùng có thể đã sử dụng từ ngữ nhạy cảm.")).toBe(
      "Xác định người dùng có thể đã sử dụng từ ngữ nhạy cảm.",
    );
    expect(stripThinkingLabel("Schema mapping: use voice_message_meta.transcription.")).toBe(
      "use voice_message_meta.transcription.",
    );
  });

  it("strips internal tool JSON envelopes from assistant-visible content", () => {
    const content = [
      '{"name": "SchemaContextLoader", "args": {"databaseId": "db-1", "intent": "Xin chào"}}',
      '{"name": "RetrievalTrace", "args": {"intent": "Xin chào", "tables": []}}',
      "Xin chào! Tôi là QurioDB copilot.",
    ].join("\n");

    expect(stripInternalToolEnvelopes(content)).toBe("Xin chào! Tôi là QurioDB copilot.");
  });

  it("restores the active conversation after the assistant remounts", async () => {
    window.localStorage.setItem(getActiveAIConversationStorageKey("db-1"), "conv-1");
    const getConversationMessages = vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
      id: "conv-1",
      messages: [{ id: "msg-1", role: "user", content: "SELECT 1;" }],
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await waitFor(() => {
      expect(result.current.conversationId).toBe("conv-1");
    });
    expect(getConversationMessages).toHaveBeenCalledWith("conv-1");
    expect(result.current.messages).toEqual([
      {
        id: "msg-1",
        role: "user",
        content: "SELECT 1;",
        isActionable: false,
      },
    ]);
  });

  it("stores loaded conversations and clears them when starting a new chat", async () => {
    vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
      id: "conv-2",
      messages: [],
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-2");
    });

    expect(window.localStorage.getItem(getActiveAIConversationStorageKey("db-1"))).toBe("conv-2");

    act(() => {
      result.current.startNewChat();
    });

    expect(window.localStorage.getItem(getActiveAIConversationStorageKey("db-1"))).toBeNull();
    expect(result.current.conversationId).toBeNull();
  });

  it.each([{ rows: [] }, { rows: [{ customer: "An", profile: { city: "Hanoi" } }] }])(
    "keeps structured MongoDB query results through streaming and history restore: %j", async ({ rows }) => {
      const queryText = 'db.orders.find({"status":"paid"})';
      const columns = ["customer", "profile"];
      vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk) => {
        onChunk("Đơn hàng đã thanh toán.", "message");
        onChunk({ queryLanguage: "mongodb", queryText }, "query");
        onChunk({ columns, data: rows }, "query_result");
        onChunk([{ label: "Tổng", prompt: "Tính tổng amount", intent: "other" }], "suggestions");
      });
      vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
        id: "conv-mongo", messages: [{ id: "saved", role: "assistant", content: "Đơn hàng",
          events: [], queryLanguage: "mongodb", queryText, columns, data: rows }],
      });
      const { result } = renderHook(() => useAIChat("db-1", "analytics"));
      await act(async () => { await result.current.handleSend("show paid orders"); });
      expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
        queryLanguage: "mongodb", queryText, columns, data: rows, isStreaming: false,
      }));
      expect(result.current.messages.at(-1)?.content).not.toContain("[object Object]");
      expect(result.current.messages.at(-1)?.suggestions).toEqual([
        { label: "Tổng", prompt: "Tính tổng amount", intent: "other" },
      ]);
      await act(async () => { await result.current.loadConversation("conv-mongo"); });
      expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
        queryLanguage: "mongodb", queryText, columns, data: rows,
      }));
    },
  );

  it("keeps final streamed assistant content when chunks are frame-batched", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk, onHeaders) => {
      onHeaders?.(new Headers({ "X-Conversation-Id": "conv-stream" }));
      onChunk("SELECT", "message");
      onChunk(" 1;", "message");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("make a test query");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)).toEqual(
        expect.objectContaining({
          role: "assistant",
          content: "SELECT 1;",
          isStreaming: false,
        }),
      );
    });
    expect(result.current.conversationId).toBe("conv-stream");
  });

  it("extracts SQL from legacy labeled assistant text", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk, onHeaders) => {
      onHeaders?.(new Headers({ "X-Conversation-Id": "conv-legacy-sql" }));
      onChunk(
        'SQL: SELECT p."fullName", COUNT(*) AS total_bookings\nFROM public."Profile" p\nAnalysis: Truy van tinh tong dat cho theo host.',
        "message",
      );
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("Tinh doanh thu trung binh");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)).toEqual(
        expect.objectContaining({
          role: "assistant",
          content: "",
          sql: 'SELECT p."fullName", COUNT(*) AS total_bookings\nFROM public."Profile" p',
          analysis: "Truy van tinh tong dat cho theo host.",
          isStreaming: false,
        }),
      );
    });
  });

  it("extracts SQL from legacy labeled persisted assistant content", async () => {
    vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
      id: "conv-legacy-history",
      messages: [{
        id: "msg-legacy",
        role: "assistant",
        content: "SQL: SELECT 1;\nAnalysis: Reads a constant.",
        events: [{ type: "message", content: "SQL: SELECT 1;\nAnalysis: Reads a constant." }],
      }],
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-legacy-history");
    });

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        content: "",
        sql: "SELECT 1;",
        analysis: "Reads a constant.",
      }),
    );
  });

  it("strips labels from streamed thinking steps", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk, onHeaders) => {
      onHeaders?.(new Headers({ "X-Conversation-Id": "conv-thinking" }));
      onChunk("Intent: Xác định người dùng có thể đã sử dụng từ ngữ nhạy cảm.", "thinking");
      onChunk("Schema mapping: use voice_message_meta.transcription.", "thinking");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("kiểm tra từ ngữ nhạy cảm");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)?.steps).toEqual([
        expect.objectContaining({
          content: "Xác định người dùng có thể đã sử dụng từ ngữ nhạy cảm.",
        }),
        expect.objectContaining({
          content: "use voice_message_meta.transcription.",
        }),
      ]);
    });
  });

  it("renders streamed legacy English thinking statuses in Vietnamese", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk, onHeaders) => {
      onHeaders?.(new Headers({ "X-Conversation-Id": "conv-translated-thinking" }));
      onChunk("Generating SQL...", "thinking");
      onChunk("Testing generated SQL safely...", "thinking");
      onChunk("SQL preview passed.", "thinking");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("tạo truy vấn kiểm thử");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)?.steps?.map((step) => step.content)).toEqual([
        "Đang tạo SQL...",
        "Đang chạy thử SQL đã tạo một cách an toàn...",
        "SQL đã chạy thử thành công.",
      ]);
    });
  });

  it("shows assistant activity immediately while waiting for the first stream chunk", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    let resolveStream: (() => void) | undefined;
    vi.spyOn(aiApi, "streamChat").mockImplementation(() => new Promise<void>((resolve) => {
      resolveStream = resolve;
    }));

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.handleSend("tạo truy vấn kiểm thử");
    });

    // The live stream lives in `streamingMessage`; committed history stays frozen.
    await waitFor(() => {
      expect(result.current.streamingMessage).toEqual(expect.objectContaining({
        role: "assistant",
        isStreaming: true,
        steps: [expect.objectContaining({
          content: "Đang kết nối trợ lý...",
          status: "active",
        })],
      }));
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("user");

    await act(async () => {
      resolveStream?.();
      await sendPromise;
    });

    expect(result.current.streamingMessage).toBeNull();
  });
});

describe("useAIChat long-conversation streaming", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeHistory = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message content ${i}`,
    }));

  it("streams chunks into a separate message without touching committed history", async () => {
    vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
      id: "conv-120",
      messages: makeHistory(120),
    });
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);

    let resolveStream!: () => void;
    let emitChunk!: (chunk: string, event?: string) => void;
    vi.spyOn(aiApi, "streamChat").mockImplementation((_data, onChunk) => {
      emitChunk = onChunk;
      return new Promise<void>((resolve) => {
        resolveStream = () => resolve();
      });
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-120");
    });
    expect(result.current.messages).toHaveLength(120);

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.handleSend("stream test");
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(121);
      expect(result.current.streamingMessage).toBeDefined();
    });

    const committedDuringStream = result.current.messages;

    await act(async () => {
      emitChunk("Hello", "message");
    });
    await waitFor(() => {
      expect(result.current.streamingMessage?.content).toContain("Hello");
    });
    // Committed history is untouched: same array reference, same message objects.
    expect(result.current.messages).toBe(committedDuringStream);
    expect(result.current.messages[0]).toBe(committedDuringStream[0]);

    await act(async () => {
      emitChunk(" world", "message");
    });
    await waitFor(() => {
      expect(result.current.streamingMessage?.content).toContain("Hello world");
    });
    expect(result.current.messages).toBe(committedDuringStream);
    expect(result.current.messages).toHaveLength(121);

    await act(async () => {
      resolveStream();
      await sendPromise;
    });

    expect(result.current.streamingMessage).toBeNull();
    expect(result.current.messages).toHaveLength(122);
    expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Hello world",
      isStreaming: false,
    }));

    // No duplicate messages: every id appears exactly once.
    const ids = result.current.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("concatenates all streamed chunks in order without loss", async () => {
    vi.spyOn(aiApi, "getConversationMessages").mockResolvedValue({
      id: "conv-order",
      messages: makeHistory(100),
    });
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk, onHeaders) => {
      onHeaders?.(new Headers({ "X-Conversation-Id": "conv-order-2" }));
      for (let i = 0; i < 50; i += 1) {
        onChunk(`piece-${i} `, "message");
      }
      onChunk("SELECT 1;", "sql");
      onChunk("Phân tích.", "analysis");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-order");
    });
    expect(result.current.messages).toHaveLength(100);

    await act(async () => {
      await result.current.handleSend("order test");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
        role: "assistant",
        // parseMessageContent trims the accumulated streamed text.
        content: Array.from({ length: 50 }, (_, i) => `piece-${i} `).join("").trim(),
        sql: "SELECT 1;",
        analysis: "Phân tích.",
        isStreaming: false,
      }));
    });
    expect(result.current.messages).toHaveLength(102);
  });

  it("commits the assistant message exactly once", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk) => {
      onChunk("final", "message");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("once test");
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)).toEqual(
        expect.objectContaining({ role: "assistant", content: "final" }),
      );
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.streamingMessage).toBeNull();
  });

  it("discards an in-flight stream when the conversation is switched", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "getConversationMessages").mockImplementation(async (id) => {
      if (id === "conv-a") {
        return { id: "conv-a", messages: [{ id: "a1", role: "user", content: "hi a" }] };
      }
      return { id: "conv-b", messages: [{ id: "b1", role: "user", content: "hi b" }] };
    });

    let resolveStream!: () => void;
    let emitChunk!: (chunk: string, event?: string) => void;
    vi.spyOn(aiApi, "streamChat").mockImplementation((_data, onChunk) => {
      emitChunk = onChunk;
      return new Promise<void>((resolve) => {
        resolveStream = () => resolve();
      });
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-a");
    });
    expect(result.current.messages).toHaveLength(1);

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.handleSend("ask");
    });
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.streamingMessage).toBeDefined();
    });

    await act(async () => {
      await result.current.loadConversation("conv-b");
    });
    expect(result.current.streamingMessage).toBeNull();
    expect(result.current.messages).toEqual([expect.objectContaining({ id: "b1" })]);

    // The abandoned stream must not leak into the new conversation.
    await act(async () => {
      emitChunk("late chunk", "message");
      resolveStream();
      await sendPromise;
    });

    expect(result.current.streamingMessage).toBeNull();
    expect(result.current.messages).toEqual([expect.objectContaining({ id: "b1" })]);
    expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("aborts an abandoned stream, unlocks the input, and lets the new conversation stream cleanly", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "getConversationMessages").mockImplementation(async (id) => {
      if (id === "conv-a") {
        return { id: "conv-a", messages: [{ id: "a1", role: "user", content: "hi a" }] };
      }
      return { id: "conv-b", messages: [{ id: "b1", role: "user", content: "hi b" }] };
    });

    interface CapturedStream {
      onChunk: (chunk: string, event?: string) => void;
      signal?: AbortSignal;
      resolve: () => void;
    }
    const streams: CapturedStream[] = [];
    vi.spyOn(aiApi, "streamChat").mockImplementation((_data, onChunk, _onHeaders, signal) => {
      return new Promise<void>((resolve) => {
        streams.push({ onChunk, signal, resolve });
      });
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.loadConversation("conv-a");
    });
    expect(result.current.messages).toHaveLength(1);

    // Start a stream in conversation A; it stays pending forever.
    let oldSendPromise: Promise<void> = Promise.resolve();
    act(() => {
      oldSendPromise = result.current.handleSend("old ask");
    });
    await waitFor(() => {
      expect(result.current.isTyping).toBe(true);
      expect(streams).toHaveLength(1);
    });

    // Switch conversations while the old stream is still pending.
    await act(async () => {
      await result.current.loadConversation("conv-b");
    });

    // The abandoned request was aborted and the input unlocked immediately.
    expect(streams[0].signal?.aborted).toBe(true);
    expect(result.current.isTyping).toBe(false);
    expect(result.current.streamingMessage).toBeNull();

    // A new message can be sent in the new conversation right away.
    let newSendPromise: Promise<void> = Promise.resolve();
    act(() => {
      newSendPromise = result.current.handleSend("new ask");
    });
    await waitFor(() => {
      expect(streams).toHaveLength(2);
    });
    expect(result.current.isTyping).toBe(true);
    expect(result.current.streamingMessage).toBeDefined();

    // The new stream makes progress.
    await act(async () => {
      streams[1].onChunk("NEW-ANSWER", "message");
    });
    await waitFor(() => {
      expect(result.current.streamingMessage?.content).toContain("NEW-ANSWER");
    });

    // The old stream settles late: its chunks must not commit or overwrite UI.
    await act(async () => {
      streams[0].onChunk("LATE-CHUNK", "message");
      streams[0].resolve();
      await oldSendPromise;
    });

    expect(result.current.streamingMessage?.content).toContain("NEW-ANSWER");
    expect(result.current.streamingMessage?.content).not.toContain("LATE-CHUNK");
    expect(result.current.messages.map((m) => m.content)).not.toContain("LATE-CHUNK");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "b1" }),
      expect.objectContaining({ role: "user", content: "new ask" }),
    ]);

    // The new stream finishes cleanly and commits exactly once.
    await act(async () => {
      streams[1].resolve();
      await newSendPromise;
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "b1" }),
      expect.objectContaining({ role: "user", content: "new ask" }),
      expect.objectContaining({ role: "assistant", content: "NEW-ANSWER", isStreaming: false }),
    ]);
    expect(result.current.isTyping).toBe(false);
  });

  it("starts a new chat during streaming without leaking the in-flight assistant message", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);

    let resolveStream!: () => void;
    let emitChunk!: (chunk: string, event?: string) => void;
    vi.spyOn(aiApi, "streamChat").mockImplementation((_data, onChunk) => {
      emitChunk = onChunk;
      return new Promise<void>((resolve) => {
        resolveStream = () => resolve();
      });
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.handleSend("ask");
    });
    await waitFor(() => {
      expect(result.current.streamingMessage).toBeDefined();
    });

    act(() => {
      result.current.startNewChat();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.streamingMessage).toBeNull();

    await act(async () => {
      emitChunk("late", "message");
      resolveStream();
      await sendPromise;
    });

    expect(result.current.streamingMessage).toBeNull();
    expect(result.current.messages).toHaveLength(0);
  });

  it("aborts the in-flight stream when the hook unmounts", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(aiApi, "streamChat").mockImplementation((_data, _onChunk, _onHeaders, signal) => {
      capturedSignal = signal;
      return new Promise<void>(() => {});
    });

    const { result, unmount } = renderHook(() => useAIChat("db-1", "public"));

    act(() => {
      result.current.handleSend("ask while mounted");
    });
    await waitFor(() => {
      expect(result.current.isTyping).toBe(true);
    });
    expect(capturedSignal?.aborted).toBe(false);

    act(() => {
      unmount();
    });

    // Navigating away aborts the SSE request and clears the typing/stream UI.
    expect(capturedSignal?.aborted).toBe(true);
    // The unmount cleanup must not resubscribe or restart any stream.
    expect(aiApi.streamChat).toHaveBeenCalledTimes(1);
  });

  it("settles consistently when the stream is rejected or cancelled", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockRejectedValue(new Error("Request cancelled"));

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("ask");
    });

    expect(result.current.isTyping).toBe(false);
    expect(result.current.streamingMessage).toBeNull();
    expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Error: Request cancelled",
      isStreaming: false,
    }));
    const lastId = result.current.messages.at(-1)?.id;
    expect(result.current.messages.filter((m) => m.id === lastId)).toHaveLength(1);
  });

  it("preserves stream ordering when chunks from different event types interleave", async () => {
    vi.spyOn(aiApi, "getConversations").mockResolvedValue([]);
    vi.spyOn(aiApi, "streamChat").mockImplementation(async (_data, onChunk) => {
      onChunk("Intent: phân tích.", "thinking");
      onChunk("Đầu tiên", "message");
      onChunk("SQL text", "sql");
      onChunk(" tiếp theo", "message");
    });

    const { result } = renderHook(() => useAIChat("db-1", "public"));

    await act(async () => {
      await result.current.handleSend("interleave");
    });

    await waitFor(() => {
      const last = result.current.messages.at(-1);
      expect(last).toEqual(expect.objectContaining({
        role: "assistant",
        content: "Đầu tiên tiếp theo",
        sql: "SQL text",
        isStreaming: false,
      }));
    });
    expect(result.current.streamingMessage).toBeNull();
  });
});
