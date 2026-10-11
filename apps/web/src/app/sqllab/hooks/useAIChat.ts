/**
 * @file useAIChat.ts
 * @description Custom hook for managing AI chat state, streaming responses, and parsing content.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { aiApi } from "../../../lib/api-client";
import { toast } from "sonner";
import { AISuggestion, Message, AIStep } from "../components/ai/types";

const ACTIVE_CONVERSATION_STORAGE_PREFIX = "sqllab_ai_active_conversation";
const INITIAL_ASSISTANT_ACTIVITY = "Đang kết nối trợ lý...";

export const getActiveAIConversationStorageKey = (databaseId?: string) =>
  `${ACTIVE_CONVERSATION_STORAGE_PREFIX}:${databaseId || "global"}`;

const getStoredActiveConversationId = (databaseId?: string) => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(getActiveAIConversationStorageKey(databaseId));
  } catch (error) {
    console.error("Failed to read active AI conversation", error);
    return null;
  }
};

const storeActiveConversationId = (databaseId: string | undefined, id: string) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getActiveAIConversationStorageKey(databaseId), id);
  } catch (error) {
    console.error("Failed to store active AI conversation", error);
  }
};

const clearStoredActiveConversationId = (databaseId?: string) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(getActiveAIConversationStorageKey(databaseId));
  } catch (error) {
    console.error("Failed to clear active AI conversation", error);
  }
};

const getSqlFence = (sql: string) => {
  const longestBacktickRun = Math.max(0, ...Array.from(sql.matchAll(/`+/g), ([match]) => match.length));
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
};

const formatFencedSql = (sql: string) => {
  const fence = getSqlFence(sql);
  return `${fence}sql\n${sql}\n${fence}`;
};

const serializeMessageContent = (message: Message) => {
  const parts = [message.content, message.queryText || (message.sql ? formatFencedSql(message.sql) : ""), message.analysis].filter(Boolean);
  return parts.join("\n\n").trim();
};

export const STATUS_THINKING_EVENTS = new Set([
  "Đang kết nối trợ lý...",
  "Đang chuẩn bị phản hồi...",
  "Initializing context...",
  "Analyzing schema...",
  "Learning from your feedback...",
  "Ready.",
  "Initialization complete.",
  "Generating SQL...",
  "Testing generated SQL safely...",
  "SQL preview passed.",
  "Đang kiểm tra model và hạn mức...",
  "Đang khởi tạo bối cảnh...",
  "Phân tích lược đồ...",
  "Đang phân tích lược đồ...",
  "Học hỏi từ phản hồi của các bạn...",
  "Đang học từ phản hồi của bạn...",
  "Sẵn sàng.",
  "Khởi tạo xong.",
  "Đang tạo SQL...",
  "Đang kiểm tra SQL đã tạo một cách an toàn...",
  "Đang chạy thử SQL đã tạo một cách an toàn...",
  "SQL preview đã đạt kiểm tra.",
  "SQL đã chạy thử thành công.",
]);

const THINKING_STATUS_TRANSLATIONS: Record<string, string> = {
  "Initializing context...": "Đang khởi tạo bối cảnh...",
  "Analyzing schema...": "Đang phân tích lược đồ...",
  "Learning from your feedback...": "Đang học từ phản hồi của bạn...",
  "Ready.": "Sẵn sàng.",
  "Initialization complete.": "Khởi tạo xong.",
  "Generating SQL...": "Đang tạo SQL...",
  "Testing generated SQL safely...": "Đang chạy thử SQL đã tạo một cách an toàn...",
  "SQL preview passed.": "SQL đã chạy thử thành công.",
  "Đang kiểm tra SQL đã tạo một cách an toàn...": "Đang chạy thử SQL đã tạo một cách an toàn...",
  "SQL preview đã đạt kiểm tra.": "SQL đã chạy thử thành công.",
  "Phân tích lược đồ...": "Đang phân tích lược đồ...",
  "Học hỏi từ phản hồi của các bạn...": "Đang học từ phản hồi của bạn...",
};

const SQL_REPAIR_STATUS_PATTERN = /^(?:Preview failed; repairing SQL|Preview thất bại; đang sửa SQL|Bản chạy thử thất bại; đang sửa SQL) \((\d+)\/(\d+)\)\.\.\.$/;

export const isStatusThinkingEvent = (text: string) => {
  const trimmed = text.trim();
  return STATUS_THINKING_EVENTS.has(trimmed) || SQL_REPAIR_STATUS_PATTERN.test(trimmed);
};

export const translateThinkingStatus = (text: string) => {
  const trimmed = String(text || "").trim();
  const translated = THINKING_STATUS_TRANSLATIONS[trimmed];
  if (translated) return translated;

  const repairMatch = trimmed.match(SQL_REPAIR_STATUS_PATTERN);
  if (repairMatch) return `Bản chạy thử thất bại; đang sửa SQL (${repairMatch[1]}/${repairMatch[2]})...`;

  return text;
};

const translateThinkingContent = (text: string) =>
  String(text || "")
    .split(/\n\n/)
    .map((part) => translateThinkingStatus(part))
    .join("\n\n");

const LABELED_THINKING_EVENT_PATTERN = /^(Intent|Schema mapping|Strategy):/i;
const THINKING_LABEL_PATTERN = /^\s*(Intent|Schema mapping|Strategy):\s*/i;

export const isLabeledThinkingEvent = (text: string) => LABELED_THINKING_EVENT_PATTERN.test(text.trim());

export const stripThinkingLabel = (text: string) => String(text || "").replace(THINKING_LABEL_PATTERN, "");

const toThinkingSteps = (events: any[]): AIStep[] => {
  return events.reduce<AIStep[]>((steps, event) => {
    if (event?.type !== "thinking" || !event?.content) return steps;

    const rawText = String(event.content);
    const text = rawText.trim();
    if (!text) return steps;
    const displayText = translateThinkingStatus(stripThinkingLabel(text).trim());
    const displayRawText = stripThinkingLabel(rawText);
    if (!displayText) return steps;

    const lastStep = steps[steps.length - 1];
    const shouldStartStep =
      !lastStep ||
      isStatusThinkingEvent(text) ||
      isStatusThinkingEvent(lastStep.content) ||
      isLabeledThinkingEvent(text);

    if (shouldStartStep) {
      return [...steps, { type: "thinking", content: displayText, status: "complete" }];
    }

    return [
      ...steps.slice(0, -1),
      { ...lastStep, content: `${lastStep.content}${displayRawText}` },
    ];
  }, []);
};

const INTERNAL_TOOL_NAMES = new Set(["SchemaContextLoader", "RetrievalTrace"]);

const findJsonObjectEnd = (text: string, startIndex: number) => {
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = isInString;
      continue;
    }

    if (char === '"') {
      isInString = !isInString;
      continue;
    }

    if (isInString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return index + 1;
  }

  return -1;
};

const isInternalToolEnvelope = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const payload = value as { name?: unknown; args?: unknown };
  return typeof payload.name === "string" && INTERNAL_TOOL_NAMES.has(payload.name) && Boolean(payload.args);
};

const normalizeSuggestions = (value: unknown): AISuggestion[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AISuggestion[]>((items, item) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) items.push({ label: text, prompt: text, intent: "other" });
      return items;
    }

    if (!item || typeof item !== "object") return items;

    const candidate = item as Partial<AISuggestion>;
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim() : prompt;
    if (!prompt || !label) return items;

    items.push({
      label,
      prompt,
      intent: candidate.intent || "other",
    });
    return items;
  }, []).slice(0, 4);
};

const stripSuggestionCodeFence = (value: string) => {
  const text = value.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
};

const parseSuggestionJson = (value: string): unknown => {
  const text = stripSuggestionCodeFence(value);
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  }
  return JSON.parse(text);
};

const parseSuggestionsContent = (value: string): AISuggestion[] => {
  const text = value.trim();
  if (!text) return [];

  try {
    return normalizeSuggestions(parseSuggestionJson(text));
  } catch {
    return [];
  }
};

export const stripInternalToolEnvelopes = (text: string) => {
  let cleaned = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "{") {
      cleaned += text[index];
      index += 1;
      continue;
    }

    const endIndex = findJsonObjectEnd(text, index);
    if (endIndex < 0) {
      cleaned += text.slice(index);
      break;
    }

    const candidate = text.slice(index, endIndex);
    try {
      if (isInternalToolEnvelope(JSON.parse(candidate))) {
        index = endIndex;
        while (text[index] === "\n" || text[index] === "\r" || text[index] === " " || text[index] === "\t") index += 1;
        continue;
      }
    } catch {
      // Not a JSON envelope; keep rendering the original text.
    }

    cleaned += candidate;
    index = endIndex;
  }

  return cleaned.trim();
};

const extractLegacyLabeledSections = (value: string) => {
  let content = String(value || "");
  let sql = "";
  let analysis = "";

  const sqlMatch = content.match(/(?:^|\n)\s*SQL:\s*([\s\S]*?)(?=\n\s*(?:#{3}\s*)?Analysis:|\n\s*### SUGGESTIONS:|$)/i);
  if (sqlMatch) {
    sql = sqlMatch[1].trim();
    content = content.replace(sqlMatch[0], "\n").trim();
  }

  const analysisMatch = content.match(/(?:^|\n)\s*(?:#{3}\s*)?Analysis:\s*([\s\S]*?)(?=\n\s*### SUGGESTIONS:|$)/i);
  if (analysisMatch) {
    analysis = analysisMatch[1].trim();
    content = content.replace(analysisMatch[0], "\n").trim();
  }

  return { content: content.trim(), sql, analysis };
};

export function useAIChat(databaseId?: string, schema?: string, selectedModel?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isFetchingConversation, setIsFetchingConversation] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const streamingMessageRef = useRef<Message | null>(null);
  const streamGenerationRef = useRef(0);
  const databaseGenerationRef = useRef(0);
  const conversationLoadTokenRef = useRef(0);
  const restoredConversationRef = useRef<string | null>(null);
  const databaseIdRef = useRef(databaseId);
  // AbortController for the in-flight stream so conversation switches can stop
  // the underlying request instead of waiting for it to settle on its own.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Generation that currently "owns" the typing indicator. A stale stream's
  // finally must not clear `isTyping` for a newer stream (or for an unlocked
  // conversation switch), so it only clears when the generation still matches.
  const typingGenerationRef = useRef(-1);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keeps the live streaming message separate from committed history so a
  // stream chunk never creates a new `messages` array (and therefore never
  // re-renders the committed message list).
  const updateStreamingMessage = useCallback(
    (updater: Message | null | ((prev: Message | null) => Message | null)) => {
      streamingMessageRef.current =
        typeof updater === "function" ? updater(streamingMessageRef.current) : updater;
      setStreamingMessage(streamingMessageRef.current);
    },
    [],
  );

  // Any conversation/history change invalidates the in-flight stream so its
  // late chunks cannot leak into a different conversation. The old request is
  // aborted, the streaming UI is cleared, and the input unlocks immediately.
  const invalidateStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamGenerationRef.current += 1;
    typingGenerationRef.current = -1;
    setIsTyping(false);
    updateStreamingMessage(null);
  }, [updateStreamingMessage]);

  // Abort any pending stream when the hook unmounts (e.g. navigating away).
  // `invalidateStream` is stable (its only dep `updateStreamingMessage` is a
  // memoized callback), so this effect mounts once and its cleanup runs only
  // on unmount — it cannot create an infinite cleanup/restart loop.
  useEffect(() => {
    return () => {
      invalidateStream();
    };
  }, [invalidateStream]);

  useEffect(() => {
    if (databaseIdRef.current === databaseId) return;

    databaseIdRef.current = databaseId;
    databaseGenerationRef.current += 1;
    conversationLoadTokenRef.current += 1;
    invalidateStream();
    conversationIdRef.current = null;
    restoredConversationRef.current = null;
    setConversationId(null);
    setMessages([]);
  }, [databaseId, invalidateStream]);

  const parseMessageContent = useCallback((message: any): Partial<Message> => {
    if (message.role === "user") {
      const content = String(message.content || "");
      const actionMatch = content.match(/^(Explain|Optimize) (?:this SQL: |SQL:\r?\n\r?\n)([\s\S]+)$/);
      if (actionMatch) {
        const [, label, actionContent] = actionMatch;
        const fencedSqlMatch = actionContent.match(/^(`{3,})sql\r?\n([\s\S]*?)\r?\n\1$/i);
        const sql = fencedSqlMatch ? fencedSqlMatch[2] : actionContent;
        const action = label.toLowerCase() as "explain" | "optimize";
        return {
          action,
          content: `${label} SQL:\n\n${formatFencedSql(sql)}`,
        };
      }

      return { content };
    }

    if (message.events || message.sql || message.analysis || message.thought || message.confidence !== undefined) {
      const steps = Array.isArray(message.events) ? toThinkingSteps(message.events) : undefined;
      const legacySections = extractLegacyLabeledSections(message.content || "");
      const hasLegacySections = Boolean(legacySections.sql || legacySections.analysis);

      return {
        content: hasLegacySections ? legacySections.content : message.content || "",
        explanation: message.explanation || "",
        thought: translateThinkingContent(message.thought || message.thinking || ""),
        sql: message.sql || legacySections.sql || "",
        analysis: message.analysis || legacySections.analysis || "",
        confidence: message.confidence,
        columns: message.columns,
        data: message.data,
        queryLanguage: message.queryLanguage,
        queryText: message.queryText,
        suggestions: normalizeSuggestions(message.suggestions),
        citations: message.citations,
        retrievalTrace: message.retrievalTrace,
        warnings: message.warnings,
        steps,
      };
    }

    let text = stripInternalToolEnvelopes(message.content).trim();

    // 1. Check if content is JSON (New Agent format)
    if (text.startsWith("{") && (text.endsWith("}") || text.includes("}"))) {
      try {
        // Find last matching brace in case of trailing junk
        const lastBrace = text.lastIndexOf("}");
        const jsonStr = text.substring(0, lastBrace + 1);
        const data = JSON.parse(jsonStr);

        return {
          content: data.summary || data.content || "",
          explanation: data.explanation || "",
          thought: translateThinkingContent(data.thinking || data.thought || ""), // Map from standard keys
          sql: data.sql || "",
          analysis: data.analysis || "",
          confidence: data.confidence,
          columns: data.columns,
          data: data.data,
          queryLanguage: data.queryLanguage,
          queryText: data.queryText,
          suggestions: normalizeSuggestions(data.suggestions),
          citations: data.citations,
          retrievalTrace: data.retrievalTrace,
          warnings: data.warnings,
          steps: Array.isArray(data.events) ? toThinkingSteps(data.events) : undefined,
        };
      } catch (e) {
        console.warn("Failed to parse JSON message, falling back to regex", e);
      }
    }

    // 2. Legacy Streamed / Text Format extraction
    let content = text;
    let thought = "";
    let sql = "";
    let analysis = "";
    let confidence: number | undefined;

    const confidenceMatch = text.match(/<confidence>([\s\S]*?)<\/confidence>/i);
    if (confidenceMatch) {
      const parsedConfidence = Number(confidenceMatch[1].trim());
      if (!Number.isNaN(parsedConfidence)) confidence = parsedConfidence;
    }

    // Extract all thinking sections as user-visible assistant activity.
    const steps: AIStep[] = [];
    const thinkingContent: string[] = [];

    // Regular expression also matches legacy tool_call tags so they can be stripped later.
    const stepRegex = /<(thinking|tool_call)(?:\s+name="([^"]*)")?(?:\s+intent="([^"]*)")?(?:\s+\/>|>([\s\S]*?)<\/\1>)/gi;
    let stepMatch;

    while ((stepMatch = stepRegex.exec(text)) !== null) {
      const [, type, , , innerContent] = stepMatch;
      if (type === "thinking") {
        const content = translateThinkingStatus(stripThinkingLabel(innerContent || "").trim());
        if (content) {
          thinkingContent.push(content);
          steps.push({
            type: "thinking",
            content,
            status: "complete",
          });
        }
      }
    }

    // Handle partial thinking block at the end of the stream
    const partialThoughtRegex = /<thinking>([\s\S]*)$/i;
    const partialMatch = text.match(partialThoughtRegex);
    if (partialMatch && !text.includes("</thinking>", partialMatch.index)) {
      const content = partialMatch[1].trim();
      if (content) thinkingContent.push(translateThinkingStatus(stripThinkingLabel(content).trim()));
    }

    if (!steps.length && (thinkingContent.length > 0 || (partialMatch && !text.includes("</thinking>", partialMatch.index)))) {
      steps.push({
        type: "thinking",
        content: thinkingContent.join("\n\n") || "Đang phân tích...",
        status: "complete",
      });
    }

    // Extract the final thought text for historical reference (joined)
    thought = thinkingContent.join("\n\n");

    // Clean content by removing all thinking and tool_call blocks
    // We use a more aggressive approach to catch dangling tags or mismatched blocks
    content = text
      .replace(/<confidence>[\s\S]*?<\/confidence>/gi, "")
      .replace(/<(thinking|tool_call)[\s\S]*?(?:<\/\1>|\/>)/gi, "") // Remove balanced blocks
      .replace(/<thinking>[\s\S]*/gi, "") // Remove any unclosed opening tag and everything after
      .replace(/<\/thinking>/gi, "")      // Remove any dangling closing tags
      .replace(/<tool_call[^>]*\/>/gi, "") // Remove any standalone tool tags
      .replace(/thinking>/gi, "")         // Remove common malformed remnants
      .replace(/<\/thinking/gi, "")
      .trim();

    // Extract SQL Block
    const sqlMatch = content.match(/```sql\n([\s\S]*?)\n```/);
    if (sqlMatch) {
      sql = sqlMatch[1].trim();
      content = content.replace(sqlMatch[0], "").trim();
    } else {
      const partialSql = content.match(/```sql\n([\s\S]*)/);
      if (partialSql) {
        sql = partialSql[1].trim();
        content = content.replace(partialSql[0], "").trim();
      }
    }

    if (!sql) {
      const legacySections = extractLegacyLabeledSections(content);
      content = legacySections.content;
      sql = legacySections.sql;
      analysis = legacySections.analysis;
    }

    // Extract Analysis Section
    const analysisMatch = content.match(/### ANALYSIS:([\s\S]*)/i);
    if (analysisMatch) {
      analysis = analysisMatch[1].trim();
      content = content.replace(analysisMatch[0], "").trim();
    }

    if (!content && (thought || sql)) {
      content = "";
    }

    return { content, thought, sql, analysis, confidence, steps };
  }, []);

  const addAssistantMessage = useCallback((content: string, sql?: string, explanation?: string, isActionable = true) => {
    const msg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      sql,
      explanation,
      isActionable,
    };
    setMessages(prev => [...prev, msg]);
  }, []);

  const loadHistory = async (dbId?: string) => {
    const requestDatabaseId = dbId;
    const requestGeneration = databaseGenerationRef.current;
    invalidateStream();
    setIsFetchingConversation(true);
    setMessages([]);
    try {
      const history = await aiApi.getHistory(dbId);
      if (databaseIdRef.current !== requestDatabaseId || databaseGenerationRef.current !== requestGeneration) return;
      if (history && history.length > 0) {
        setMessages(history.map((m: any) => ({
          id: m.id,
          role: m.role,
          ...parseMessageContent(m),
          isActionable: m.role === "assistant"
        } as Message)));
      } else {
        setMessages([]);
      }
    } catch (e) {
      console.error("Failed to load chat history", e);
    } finally {
      if (databaseIdRef.current === requestDatabaseId && databaseGenerationRef.current === requestGeneration) {
        setIsFetchingConversation(false);
      }
    }
  };

  const loadConversations = useCallback(async (dbId?: string) => {
    setIsLoadingConversations(true);
    try {
      const list = await aiApi.getConversations(dbId);
      setConversations(list);
    } catch (e) {
      console.error("Failed to load conversation list", e);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const requestDatabaseId = databaseId;
    const requestGeneration = databaseGenerationRef.current;
    const requestToken = conversationLoadTokenRef.current + 1;
    conversationLoadTokenRef.current = requestToken;
    const isActiveRequest = () =>
      databaseIdRef.current === requestDatabaseId &&
      databaseGenerationRef.current === requestGeneration &&
      conversationLoadTokenRef.current === requestToken;

    invalidateStream();
    setIsFetchingConversation(true);
    setMessages([]); // Clear immediately to show skeletons
    try {
      const res = await aiApi.getConversationMessages(id);
      if (!isActiveRequest()) return;
      conversationIdRef.current = res.id;
      setConversationId(res.id);
      storeActiveConversationId(databaseId, res.id);
      if (res.messages) {
        setMessages(res.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          ...parseMessageContent(m),
          isActionable: m.role === "assistant"
        } as Message)));
      }
    } catch (e) {
      if (!isActiveRequest()) return;
      clearStoredActiveConversationId(databaseId);
      setConversationId(null);
      toast.error("Failed to load conversation");
    } finally {
      if (isActiveRequest()) setIsFetchingConversation(false);
    }
  }, [databaseId, parseMessageContent, invalidateStream]);

  useEffect(() => {
    const activeConversationId = getStoredActiveConversationId(databaseId);
    if (!activeConversationId) {
      restoredConversationRef.current = null;
      return;
    }

    if (conversationId === activeConversationId || restoredConversationRef.current === activeConversationId) return;

    restoredConversationRef.current = activeConversationId;
    loadConversation(activeConversationId);
  }, [conversationId, databaseId, loadConversation]);

  const startNewChat = useCallback(() => {
    conversationLoadTokenRef.current += 1;
    invalidateStream();
    clearStoredActiveConversationId(databaseId);
    restoredConversationRef.current = null;
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
  }, [databaseId, invalidateStream]);

  const streamWithLifecycle = useCallback(async (
    input: string,
    streamRequest: (
      onChunk: (chunk: any, event?: string) => void,
      onHeaders: (headers: Headers) => void,
      signal: AbortSignal,
      ) => Promise<void>,
    requiresDatabase = true,
    userMessage?: Pick<Message, "action" | "content">,
  ) => {
    if (!input.trim() || isTyping || (requiresDatabase && !databaseId)) {
      if (requiresDatabase && !databaseId) toast.error("Connect a database first.");
      return;
    }

    setIsTyping(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage?.content ?? input,
      ...(userMessage?.action ? { action: userMessage.action } : {}),
    };
    const assistantMsgId = (Date.now() + 1).toString();
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isActionable: true,
      isStreaming: true,
      steps: [{ type: "thinking", content: INITIAL_ASSISTANT_ACTIVITY, status: "active" }],
    };

    setMessages(prev => [...prev, userMsg]);
    const streamGeneration = streamGenerationRef.current;
    typingGenerationRef.current = streamGeneration;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    updateStreamingMessage(initialAssistantMsg);

    let responseContent = "";
    let sqlContent = "";
    let query: Pick<Message, "queryLanguage" | "queryText" | "columns" | "data"> = {};
    let analysisContent = "";
    let confidenceScore: number | undefined;
    let citations: Message["citations"] = [];
    let retrievalTrace: Message["retrievalTrace"];
    let warnings: string[] = [];
    let suggestions: AISuggestion[] = [];
    let suggestionsContent = "";
    let streamSteps: AIStep[] = [];
    let lastStreamEvent = "";
    let lastParsedContent = "";
    let lastParsedMessage: Partial<Message> = parseMessageContent({ role: "assistant", content: "" });
    let streamThought = "";
    let pendingAssistantEvent: string | undefined;
    let pendingAssistantChunk: unknown;
    let scheduledAssistantFrame: number | null = null;
    let streamRejected = false;
    let streamFailed = false;

    const completeStreamSteps = () => {
      streamSteps = streamSteps.map((step) => ({ ...step, status: "complete" as const }));
      streamThought = streamSteps.filter((step) => step.type === "thinking").map((step) => step.content).join("\n\n");
    };

    const getParsedMessage = () => {
      if (responseContent !== lastParsedContent) {
        lastParsedContent = responseContent;
        lastParsedMessage = parseMessageContent({ role: "assistant", content: responseContent });
      }

      return lastParsedMessage;
    };

    const cancelScheduledAssistantFrame = () => {
      if (scheduledAssistantFrame !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(scheduledAssistantFrame);
        scheduledAssistantFrame = null;
      }
    };

    const flushAssistantMessage = () => {
      cancelScheduledAssistantFrame();
      if (streamGeneration !== streamGenerationRef.current) return;

      const event = pendingAssistantEvent;
      const chunk = pendingAssistantChunk;
      pendingAssistantEvent = undefined;
      pendingAssistantChunk = undefined;
      const parsed = getParsedMessage();

      updateStreamingMessage(prev => {
        const base = prev ?? initialAssistantMsg;

        if (event === "error") {
          return {
            ...base,
            content: `Error: ${chunk}`,
            isActionable: false,
            isStreaming: false,
          };
        }

        return {
          ...base,
          ...parsed,
          ...query,
          sql: parsed.sql || sqlContent.trim(),
          analysis: parsed.analysis || analysisContent.trim(),
          confidence: parsed.confidence ?? confidenceScore,
          citations,
          retrievalTrace,
          warnings,
          suggestions: parsed.suggestions?.length ? parsed.suggestions : suggestions,
          thought: streamThought,
          steps: streamSteps,
          isStreaming: true,
          isActionable: true
        };
      });
    };

    // Moves the live streaming message into committed history exactly once and
    // only for the current conversation generation. A duplicate guard prevents
    // the same id from being appended twice (e.g. a cancelled stream re-commit).
    const commitStreamingMessage = () => {
      const streamed = streamingMessageRef.current;
      if (!streamed) return;

      const finalMessage: Message = {
        ...streamed,
        isStreaming: false,
        isActionable: streamed.isActionable ?? true,
        steps: streamed.steps?.map((step) => ({ ...step, status: "complete" as const })),
      };

      setMessages(prev => {
        if (streamGeneration !== streamGenerationRef.current) return prev;
        if (prev.some(m => m.id === finalMessage.id)) return prev;
        return [...prev, finalMessage];
      });

      // Only the current generation may clear the live streaming message; an
      // abandoned stream's finally must not wipe a newer stream's UI.
      if (streamGeneration === streamGenerationRef.current) {
        updateStreamingMessage(null);
      }
    };

    const scheduleAssistantMessageFlush = (event?: string, chunk?: unknown) => {
      pendingAssistantEvent = event;
      pendingAssistantChunk = chunk;

      if (scheduledAssistantFrame !== null) return;
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        flushAssistantMessage();
        return;
      }

      scheduledAssistantFrame = window.requestAnimationFrame(() => {
        scheduledAssistantFrame = null;
        flushAssistantMessage();
      });
    };

    try {
      await streamRequest(
        (chunk, event) => {
          if (streamGeneration !== streamGenerationRef.current || streamFailed) return;
          if (event === "error") streamFailed = true;
          if (event === "thinking") {
            const rawText = String(chunk || "");
            const text = rawText.trim();
            if (!text) return;
            const displayText = translateThinkingStatus(stripThinkingLabel(text).trim());
            const displayRawText = stripThinkingLabel(rawText);
            if (!displayText) return;

            const lastStep = streamSteps[streamSteps.length - 1];
            const isStatusEvent = isStatusThinkingEvent(text);
            const isPreviousStatusEvent = lastStep?.type === "thinking" && isStatusThinkingEvent(lastStep.content);
            const shouldKeepSeparateThinkingEvent =
              isStatusEvent || isPreviousStatusEvent || isLabeledThinkingEvent(text);
            if (lastStreamEvent === "thinking" && lastStep?.type === "thinking" && !shouldKeepSeparateThinkingEvent) {
              streamSteps = [
                ...streamSteps.slice(0, -1),
                { ...lastStep, content: `${lastStep.content}${displayRawText}`, status: "active" },
              ];
            } else {
              streamSteps = [
                ...streamSteps.map((step) => ({ ...step, status: "complete" as const })),
                { type: "thinking", content: displayText, status: "active" },
              ];
            }
            streamThought = streamSteps.filter((step) => step.type === "thinking").map((step) => step.content).join("\n\n");
            lastStreamEvent = "thinking";
          } else if (event === "confidence") {
            const parsedConfidence = Number(String(chunk || "").trim());
            if (!Number.isNaN(parsedConfidence)) confidenceScore = parsedConfidence;
            completeStreamSteps();
            lastStreamEvent = "confidence";
          } else if (event === "sql") {
            sqlContent += String(chunk || "");
            completeStreamSteps();
            lastStreamEvent = "sql";
          } else if (event === "query") {
            query = { ...query, queryLanguage: chunk.queryLanguage, queryText: chunk.queryText };
            completeStreamSteps();
            lastStreamEvent = "query";
          } else if (event === "query_result") {
            query = { ...query, columns: chunk.columns, data: chunk.data };
            completeStreamSteps();
            lastStreamEvent = "query_result";
          } else if (event === "analysis") {
            analysisContent += String(chunk || "");
            completeStreamSteps();
            lastStreamEvent = "analysis";
          } else if (event === "citations") {
            citations = Array.isArray(chunk) ? chunk : [];
            completeStreamSteps();
            lastStreamEvent = "citations";
          } else if (event === "retrieval_trace") {
            retrievalTrace = chunk && typeof chunk === "object" ? chunk as Record<string, any> : undefined;
            completeStreamSteps();
            lastStreamEvent = "retrieval_trace";
          } else if (event === "warnings") {
            warnings = Array.isArray(chunk) ? chunk.map(String) : [];
            completeStreamSteps();
            lastStreamEvent = "warnings";
          } else if (event === "suggestions") {
            if (Array.isArray(chunk)) {
              suggestions = normalizeSuggestions(chunk);
            } else {
              suggestionsContent += String(chunk || "");
              suggestions = parseSuggestionsContent(suggestionsContent);
            }
            completeStreamSteps();
            lastStreamEvent = "suggestions";
          } else if (event !== "error") {
            responseContent += String(chunk || "");
            completeStreamSteps();
            lastStreamEvent = event || "message";
          }

          scheduleAssistantMessageFlush(event, chunk);
        },
        (headers) => {
          if (streamGeneration !== streamGenerationRef.current) return;
          const cid = headers.get("X-Conversation-Id");
          if (cid && !conversationId) {
            conversationIdRef.current = cid;
            setConversationId(cid);
            storeActiveConversationId(databaseId, cid);
            loadConversations(databaseId);
          }
        },
        controller.signal,
      );

    } catch (error: any) {
      streamRejected = true;
      // An abandoned stream (conversation switched, new chat started) or an
      // explicit abort must not render error UI or overwrite the newer stream.
      if (streamGeneration === streamGenerationRef.current && error?.name !== "AbortError") {
        const errorMessage = error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Failed to generate SQL";
        toast.error(errorMessage);
        cancelScheduledAssistantFrame();
        updateStreamingMessage(prev => ({
          ...(prev ?? initialAssistantMsg),
          content: `Error: ${errorMessage}`,
          isStreaming: false,
          isActionable: false,
          steps: (prev?.steps ?? []).map((step) => ({ ...step, status: "complete" as const })),
        }));
      }
    } finally {
      // On success flush any last pending chunk; on failure keep the error text.
      if (streamRejected || streamFailed) {
        if (streamFailed && pendingAssistantEvent === "error") {
          flushAssistantMessage();
        } else {
          cancelScheduledAssistantFrame();
        }
      } else {
        flushAssistantMessage();
      }
      // Only the stream that currently owns the typing indicator may clear it;
      // an abandoned stream must not unlock/lock a newer conversation's input.
      if (typingGenerationRef.current === streamGeneration) {
        typingGenerationRef.current = -1;
        abortControllerRef.current = null;
        setIsTyping(false);
      }
      commitStreamingMessage();
    }
  }, [databaseId, schema, selectedModel, isTyping, conversationId, parseMessageContent, loadConversations, updateStreamingMessage]);

  const handleSend = useCallback(async (input: string) => {
    const chatMessages = [
      ...messagesRef.current
        .map((message) => ({
          role: message.role,
          content: serializeMessageContent(message),
        }))
        .filter((message) => message.content),
      { role: "user", content: input },
    ];

    await streamWithLifecycle(input, (onChunk, onHeaders, signal) => aiApi.streamChat(
      {
        text: input,
        messages: chatMessages,
        databaseId,
        schema: schema || "public",
        modelId: selectedModel || undefined,
        conversationId: conversationId || undefined,
      },
      onChunk,
      onHeaders,
      signal,
    ));
  }, [databaseId, schema, selectedModel, conversationId, streamWithLifecycle]);

  const handleActionStream = useCallback(async (
    action: "explain" | "optimize",
    sql: string,
    context?: { databaseId?: string; schema_name?: string; modelId?: string },
  ) => {
    const actionInput = `${action === "explain" ? "Explain" : "Optimize"} SQL:\n\n${sql}`;
    const actionMessage = {
      action,
      content: `${actionInput.split("\n\n")[0]}\n\n${formatFencedSql(sql)}`,
    } as const;
    await streamWithLifecycle(actionInput, (onChunk, onHeaders, signal) => aiApi.streamAction(
      action,
      {
        sql,
        conversationId: conversationIdRef.current || conversationId || undefined,
        databaseId: context?.databaseId ?? databaseId,
        schema_name: context?.schema_name ?? schema,
        modelId: context?.modelId ?? selectedModel,
      },
      onChunk,
       onHeaders,
       signal,
     ), action === "optimize", actionMessage);
  }, [conversationId, databaseId, schema, selectedModel, streamWithLifecycle]);

  return {
    messages,
    setMessages,
    streamingMessage,
    isTyping,
    setIsTyping,
    isFetchingConversation,
    isLoadingConversations,
    handleSend,
    handleActionStream,
    loadHistory,
    loadConversations,
    loadConversation,
    startNewChat,
    conversations,
    conversationId,
    addAssistantMessage
  };
}
