/**
 * @file AIAssistantSidebar.tsx
 * @description AI coding assistant for SQL Lab, providing query generation, explanation, optimization, and bug fixing capabilities.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Activity } from "lucide-react";
import { toast } from "sonner";

import { aiApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAIChat } from "../hooks/useAIChat";
import { parseSlashCommand, filterCommands, type SlashCommand } from "../utils/slash-commands";

// Sub-components
import { ConversationHistory } from "./ai/ConversationHistory";
import { AIChatMessages } from "./ai/AIChatMessages";
import { AIChatInput, AUTO_MODEL_VALUE } from "./ai/AIChatInput";
import { AIDiagnosticsPanel } from "./ai/AIDiagnosticsPanel";
import type { AIRuntimeStatus } from "./ai/types";

interface AIAssistantProps {
  lab: AIAssistantLab;
  active: boolean;
  showHistory: boolean;
  onShowHistoryChange: (show: boolean) => void;
  newChatSignal: number;
}

export interface AIAssistantLab {
  selectedDS: string;
  selectedSchema: string;
  selectedDSType: string;
  sql: string;
  error: string | null;
  fixSQLError: string | null;
  queryLimit: number;
  setFixSQLError: (value: string | null) => void;
}

const shouldShowSlashCommands = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.includes(" ");
};

const VIETNAMESE_RESPONSE_INSTRUCTION =
  "Hãy trả lời bằng tiếng Việt có dấu. Chỉ dùng ngôn ngữ khác khi người dùng yêu cầu rõ ràng; giữ nguyên SQL, tên bảng/cột và từ khóa kỹ thuật cần thiết.";

const buildVietnamesePrompt = (prompt: string) =>
  prompt.startsWith(VIETNAMESE_RESPONSE_INSTRUCTION)
    ? prompt
    : `${VIETNAMESE_RESPONSE_INSTRUCTION}\n\n${prompt}`;

function AIAssistantContent({
  lab,
  active,
  showHistory,
  onShowHistoryChange,
  newChatSignal,
}: AIAssistantProps) {
  const selectedDatabaseId = lab.selectedDS || undefined;
  const selectedSchema = lab.selectedSchema;
  const selectedDatabaseType = lab.selectedDSType;
  const editorSql = lab.sql || "";
  const lastError = lab.error || undefined;
  const [input, setInput] = useState("");
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(AUTO_MODEL_VALUE);
  const [runtimeStatus, setRuntimeStatus] = useState<AIRuntimeStatus | null>(null);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [ragPlan, setRagPlan] = useState<any>(null);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);
  const [isRagPlanning, setIsRagPlanning] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const lastNewChatSignalRef = useRef(newChatSignal);

  const {
    messages,
    streamingMessage,
    isTyping,
    handleSend: _handleSend,
    handleActionStream,
    loadConversations,
    loadConversation,
    startNewChat,
    conversations,
    conversationId,
    addAssistantMessage,
    setIsTyping,
    isFetchingConversation,
    isLoadingConversations
  } = useAIChat(
    selectedDatabaseId,
    selectedSchema,
    selectedModel === AUTO_MODEL_VALUE ? undefined : selectedModel
  );

  // Initialize models and load logic
  useEffect(() => {
    const init = async () => {
      try {
        const [models, status, pipeline] = await Promise.all([
          aiApi.getModels(),
          aiApi.getAIStatus(),
          aiApi.getRagPipelineStatus(),
          loadConversations(selectedDatabaseId)
        ]);
        setAvailableModels(models || []);
        setRuntimeStatus(status);
        setPipelineStatus(pipeline);
        setSelectedModel((current) => current || AUTO_MODEL_VALUE);
        if (status && !status.hasApiKey) {
          toast.warning("AI provider key is not configured.");
        }
      } catch (e) {
        console.error("Failed to initialize AI assistant", e);
      }
    };
    init();
  }, [selectedDatabaseId, loadConversations]);

  // Auto-scroll logic. The streaming message lives outside committed history,
  // so it must drive the same scroll-to-bottom behavior during streaming.
  useEffect(() => {
    if ((messages.length > 0 || streamingMessage) && parentRef.current) {
      parentRef.current.scrollTo?.({
        top: parentRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [
    messages.length,
    messages[messages.length - 1]?.content,
    messages[messages.length - 1]?.analysis,
    messages[messages.length - 1]?.suggestions?.length,
    streamingMessage?.content,
    streamingMessage?.analysis,
    streamingMessage?.suggestions?.length,
    isTyping,
  ]);

  useEffect(() => {
    if (lastNewChatSignalRef.current === newChatSignal) return;
    lastNewChatSignalRef.current = newChatSignal;
    startNewChat();
    onShowHistoryChange(false);
  }, [newChatSignal, onShowHistoryChange, startNewChat]);

  // Fix SQL Error handler
  useEffect(() => {
    if (lab.fixSQLError) {
      const errorMsg = lab.fixSQLError;
      lab.setFixSQLError(null);
      const prompt = buildVietnamesePrompt(`I'm getting this SQL error: "${errorMsg}".\n\nHere is my current SQL:\n\`\`\`sql\n${editorSql}\n\`\`\`\n\nPlease analyze and fix this query.`);
      startNewChat();
      onShowHistoryChange(false);
      setTimeout(() => _handleSend(prompt), 0);
    }
  }, [lab.fixSQLError, editorSql, _handleSend, lab.setFixSQLError, onShowHistoryChange, startNewChat]);

  const filteredCommandOptions = React.useMemo(
    () => (showCommandMenu ? filterCommands(input) : []),
    [input, showCommandMenu],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    const shouldShowCommands = shouldShowSlashCommands(value);
    setShowCommandMenu(shouldShowCommands);
    if (shouldShowCommands) setCommandMenuIndex(0);
  }, []);

  const handleSendRequest = useCallback(async () => {
    if (!input.trim()) return;
    const currentInput = input;
    setInput("");
    setShowCommandMenu(false);

    const parsed = parseSlashCommand(currentInput);
    if (parsed) {
      const prompt = parsed.command.buildPrompt({
        editorSQL: editorSql,
        args: parsed.args,
        databaseType: selectedDatabaseType,
        lastError,
      });

      if (!prompt) {
        if (parsed.command.requiresEditorSQL && !editorSql.trim()) toast.error(`${parsed.command.command} requires SQL in the editor`);
        else if (parsed.command.acceptsArgs && !parsed.args) toast.error(`Usage: ${parsed.command.command} ${parsed.command.argsHint || '<args>'}`);
        return;
      }
      return _handleSend(buildVietnamesePrompt(prompt));
    }
    return _handleSend(currentInput);
  }, [input, editorSql, selectedDatabaseType, selectedSchema, lastError, _handleSend]);

  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    if (cmd.acceptsArgs) {
      setInput(cmd.command + " ");
      setShowCommandMenu(false);
    } else {
      setInput(cmd.command);
      setShowCommandMenu(false);
      setTimeout(async () => {
        const prompt = cmd.buildPrompt({
          editorSQL: editorSql,
          args: "",
          databaseType: selectedDatabaseType,
          lastError,
        });
        if (!prompt) {
          if (cmd.requiresEditorSQL && !editorSql.trim()) toast.error(`${cmd.command} requires SQL in the editor`);
          return;
        }
        setInput("");
        await _handleSend(buildVietnamesePrompt(prompt));
      }, 0);
    }
  }, [editorSql, selectedDatabaseType, selectedSchema, lastError, _handleSend]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showCommandMenu) {
      const filtered = filteredCommandOptions;
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandMenuIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandMenuIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        const selected = filtered[commandMenuIndex];
        if (selected) handleCommandSelect(selected);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowCommandMenu(false);
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendRequest();
    }
  }, [commandMenuIndex, filteredCommandOptions, handleCommandSelect, handleSendRequest, showCommandMenu]);

  const handleExplain = useCallback(async (s: string) => {
    try {
      await handleActionStream("explain", s, {
        databaseId: selectedDatabaseId,
        schema_name: selectedSchema,
        modelId: selectedModel === AUTO_MODEL_VALUE ? undefined : selectedModel,
      });
    } catch (err: any) {
      toast.error(typeof err === "string" ? err : err?.message || "Không thể giải thích SQL.");
    }
  }, [handleActionStream, selectedDatabaseId, selectedModel, selectedSchema]);

  const handleOptimize = useCallback(async (s: string) => {
    if (!selectedDatabaseId) {
      toast.error("Chọn database trước khi tối ưu SQL.");
      return;
    }

    try {
      await handleActionStream("optimize", s, {
        databaseId: selectedDatabaseId,
        schema_name: selectedSchema,
        modelId: selectedModel === AUTO_MODEL_VALUE ? undefined : selectedModel,
      });
    } catch (err: any) {
      toast.error(typeof err === "string" ? err : err?.message || "Không thể tối ưu SQL.");
    }
  }, [handleActionStream, selectedDatabaseId, selectedModel, selectedSchema]);

  const refreshDiagnostics = useCallback(async () => {
    setIsDiagnosticsLoading(true);
    try {
      const [result, pipeline] = await Promise.all([
        aiApi.getDiagnostics({ databaseId: selectedDatabaseId, limit: 25 }),
        aiApi.getRagPipelineStatus(),
      ]);
      setDiagnostics(result);
      setPipelineStatus(pipeline);
    } catch (err: any) {
      toast.error(err.message || "Không thể tải AI trace.");
    } finally {
      setIsDiagnosticsLoading(false);
    }
  }, [selectedDatabaseId]);

  const handleToggleDiagnostics = useCallback(() => {
    setShowDiagnostics((current) => {
      const next = !current;
      if (next) void refreshDiagnostics();
      return next;
    });
  }, [refreshDiagnostics]);

  const handlePlanRag = useCallback(async () => {
    const query = input.trim() || editorSql.trim();
    if (!query) {
      toast.error("Nhập prompt hoặc SQL trước khi plan RAG.");
      return;
    }

    setIsRagPlanning(true);
    try {
      const plan = await aiApi.planRagPipeline({
        query,
        databaseId: selectedDatabaseId,
        schema_name: selectedSchema || "public",
      });
      setRagPlan(plan);
    } catch (err: any) {
      toast.error(err.message || "Không thể plan RAG.");
    } finally {
      setIsRagPlanning(false);
    }
  }, [editorSql, input, selectedDatabaseId, selectedSchema]);

  const handleSuggestionClick = useCallback((suggestion: string) => _handleSend(suggestion), [_handleSend]);

  const handleSelectConversation = useCallback((id: string) => {
    loadConversation(id);
    onShowHistoryChange(false);
  }, [loadConversation, onShowHistoryChange]);

  const handleRefreshConversations = useCallback(() => {
    loadConversations(selectedDatabaseId);
  }, [loadConversations, selectedDatabaseId]);

  const AIActions = React.useMemo(() => ({
    onExplain: handleExplain,
    onOptimize: handleOptimize,
    onSuggestionClick: handleSuggestionClick
  }), [handleExplain, handleOptimize, handleSuggestionClick]);

  if (!active) return null;

  return (
    <div
      className={cn(
        "h-full min-h-0 w-full overflow-hidden bg-background",
        showHistory
          ? "grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]"
          : "flex",
      )}
    >
      <section className="flex min-h-0 min-w-0 flex-col w-full">
        {showHistory && (
          <div className="max-h-60 border-b border-border/70 bg-muted/15 md:hidden">
            <div className="flex h-10 items-center px-4 text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">
              Recent Conversations
            </div>
            <div className="max-h-48 overflow-y-auto overscroll-contain">
              <ConversationHistory
                conversations={conversations}
                currentId={conversationId}
                onSelect={handleSelectConversation}
                onRefresh={handleRefreshConversations}
                isLoading={isLoadingConversations}
              />
            </div>
          </div>
        )}

        <AIChatMessages
          messages={messages}
          streamingMessage={streamingMessage}
          isTyping={isTyping}
          isFetchingConversation={isFetchingConversation}
          parentRef={parentRef}
          conversationId={conversationId}
          {...AIActions}
        />

        {showDiagnostics && (
          <AIDiagnosticsPanel
            diagnostics={diagnostics}
            pipelineStatus={pipelineStatus}
            ragPlan={ragPlan}
            isLoading={isDiagnosticsLoading}
            isPlanning={isRagPlanning}
            onPlan={handlePlanRag}
            onRefresh={refreshDiagnostics}
            onClose={() => setShowDiagnostics(false)}
          />
        )}

        <div className="flex shrink-0 items-center gap-1.5 border-t border-border/70 bg-muted/10 px-2 py-1.5 md:px-3">
          <Button
            type="button"
            variant="ghost"
            className="h-7 rounded-lg text-[10px] font-black uppercase tracking-widest"
            onClick={handleToggleDiagnostics}
          >
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Diagnostics
          </Button>
        </div>

        <AIChatInput
          input={input}
          onInputChange={handleInputChange}
          onKeyDown={onKeyDown}
          isTyping={isTyping}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          availableModels={availableModels}
          runtimeStatus={runtimeStatus}
          onSend={handleSendRequest}
          showCommandMenu={showCommandMenu}
          commandMenuIndex={commandMenuIndex}
          commandOptions={filteredCommandOptions}
          onCommandSelect={handleCommandSelect}
        />
      </section>

      {showHistory && (
        <aside className="hidden h-full min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-border/70 bg-muted/15 md:flex md:flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">
                Conversations
              </p>
              <p className="truncate text-[11px] text-muted-foreground/70">
                Recent AI sessions
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ConversationHistory
              conversations={conversations}
              currentId={conversationId}
              onSelect={handleSelectConversation}
              onRefresh={handleRefreshConversations}
              isLoading={isLoadingConversations}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

export const areAIAssistantPropsEqual = (
  previous: AIAssistantProps,
  next: AIAssistantProps,
) => {
  if (
    previous.active !== next.active ||
    previous.showHistory !== next.showHistory ||
    previous.newChatSignal !== next.newChatSignal
  ) {
    return false;
  }

  if (!previous.active) return true;

  if (previous.onShowHistoryChange !== next.onShowHistoryChange) return false;

  return (
    previous.lab.selectedDS === next.lab.selectedDS &&
    previous.lab.selectedSchema === next.lab.selectedSchema &&
    previous.lab.selectedDSType === next.lab.selectedDSType &&
    previous.lab.sql === next.lab.sql &&
    previous.lab.error === next.lab.error &&
    previous.lab.fixSQLError === next.lab.fixSQLError &&
    previous.lab.queryLimit === next.lab.queryLimit &&
    previous.lab.setFixSQLError === next.lab.setFixSQLError
  );
};

export const AIAssistant = React.memo(AIAssistantContent, areAIAssistantPropsEqual);
