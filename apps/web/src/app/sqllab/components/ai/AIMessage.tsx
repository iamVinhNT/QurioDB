/**
 * @file AIMessage.tsx
 * @description Main message orchestrator that handles different types of AI and User responses.
 * Follows SRP by delegating rendering of specialized sections to sub-components.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Check, Clipboard, FileSearch, MessageSquare, User, BrainCircuit } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { aiApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// Types
import { Message } from "./types";

// Sub-components
import { DataTablePreview } from "./DataTablePreview";
import { ContextSources } from "./ContextSources";
import { SQLBlock } from "./SQLBlock";
import { ReasoningSection } from "./ReasoningSection";
import { FeedbackSection } from "./FeedbackSection";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SuggestionList } from "./SuggestionList";

// Utils
import { extractConfidence } from "./ai-utils";

/**
 * Per-message transient UI state that must survive virtualized window shifts.
 * The parent persists this keyed by message id so scrolling a row out of the
 * window and back does not lose expanded reasoning, feedback, or SQL previews.
 */
export interface MessageUiState {
  isThoughtVisible: boolean;
  feedbackRating: 1 | -1 | null;
  shouldShowCorrection: boolean;
  correctionText: string;
  isFeedbackSubmitted: boolean;
}

interface AIMessageProps {
  message: Message;
  onExplain: (sql: string) => void;
  onOptimize: (sql: string) => void;
  onSuggestionClick?: (suggestion: string) => void;
  conversationId?: string | null;
  messageUiState?: Partial<MessageUiState>;
  onMessageUiStateChange?: (messageId: string, patch: Partial<MessageUiState>) => void;
}

const noopSuggestionClick = () => {};

const AIMessageComponent = ({
  message,
  onExplain,
  onOptimize,
  onSuggestionClick,
  conversationId,
  messageUiState,
  onMessageUiStateChange,
}: AIMessageProps) => {
  // Local UI state is initialized from the parent's persisted per-message map
  // so rows remounting after scrolling out of the virtualized window keep
  // their previous expanded/preview/feedback state.
  const [isThoughtVisible, setIsThoughtVisible] = useState(() => messageUiState?.isThoughtVisible ?? false);
  const [isCopied, setIsCopied] = useState(false);
  const [isResponseCopied, setIsResponseCopied] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<1 | -1 | null>(() => messageUiState?.feedbackRating ?? null);
  const [shouldShowCorrection, setShouldShowCorrection] = useState(() => messageUiState?.shouldShowCorrection ?? false);
  const [correctionText, setCorrectionText] = useState(() => messageUiState?.correctionText ?? "");
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(() => messageUiState?.isFeedbackSubmitted ?? false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseCopyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      if (responseCopyResetTimeoutRef.current) clearTimeout(responseCopyResetTimeoutRef.current);
    };
  }, []);

  const status = useMemo(() => {
    if (message.content?.startsWith("Error:")) return null;
    if (message.sql || (message.content && !message.content.includes("Thinking"))) return null;
    return null;
  }, [message.content, message.thought, message.sql, message.isStreaming]);

  const { score, cleaned } = useMemo(() =>
    extractConfidence(message.content || "", message.confidence),
    [message.content, message.confidence]
  );

  const isError = message.content?.startsWith("Error:");
  const hasTextContent = cleaned.trim().length > 0 &&
    !cleaned.includes("Crafting the SQL") &&
    !cleaned.includes("<thinking>");

  const showPrimaryBubble = Boolean(status) || hasTextContent || Boolean(message.explanation) || isError;
  const canCopyResponse = message.role === "assistant" && !status && (hasTextContent || Boolean(message.explanation));
  const shouldShowConfidence = Boolean(message.isStreaming) && message.confidence !== undefined && !status;
  const handleToggleThought = useCallback(() => {
    // Persist the parent state-map mutation outside the state updater so
    // StrictMode's double-invocation of updater functions cannot fire the
    // side effect twice.
    const next = !isThoughtVisible;
    onMessageUiStateChange?.(message.id, { isThoughtVisible: next });
    setIsThoughtVisible(next);
  }, [message.id, onMessageUiStateChange, isThoughtVisible]);

  const handleFeedback = useCallback(async (rating: 1 | -1) => {
    setFeedbackRating(rating);
    if (rating === -1) {
      setShouldShowCorrection(true);
      onMessageUiStateChange?.(message.id, { feedbackRating: rating, shouldShowCorrection: true });
      return;
    }
    onMessageUiStateChange?.(message.id, { feedbackRating: rating });
    try {
      await aiApi.submitFeedback({
        messageId: message.id,
        rating,
        conversationId: conversationId || undefined,
      });
      setIsFeedbackSubmitted(true);
      onMessageUiStateChange?.(message.id, { isFeedbackSubmitted: true });
      toast.success("Thanks for the feedback!");
    } catch {
      toast.error("Failed to save feedback");
    }
  }, [message.id, conversationId, onMessageUiStateChange]);

  const handleSubmitCorrection = useCallback(async () => {
    try {
      await aiApi.submitFeedback({
        messageId: message.id,
        rating: -1,
        correction: correctionText,
        conversationId: conversationId || undefined,
      });
      setIsFeedbackSubmitted(true);
      setShouldShowCorrection(false);
      onMessageUiStateChange?.(message.id, { isFeedbackSubmitted: true, shouldShowCorrection: false });
      toast.success("Feedback saved — we'll improve!");
    } catch {
      toast.error("Failed to save feedback");
    }
  }, [message.id, conversationId, correctionText, onMessageUiStateChange]);

  const handleCorrectionChange = useCallback((text: string) => {
    setCorrectionText(text);
    onMessageUiStateChange?.(message.id, { correctionText: text });
  }, [message.id, onMessageUiStateChange]);

  const handleCopy = useCallback(() => {
    if (message.sql || message.queryText) {
      navigator.clipboard.writeText(message.queryText || message.sql || "");
      setIsCopied(true);
      toast.success('Query copied to clipboard');
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = setTimeout(() => {
        setIsCopied(false);
        copyResetTimeoutRef.current = null;
      }, 2000);
    }
  }, [message.sql, message.queryText]);

  const handleCopyResponse = useCallback(() => {
    const response = [cleaned || message.content, message.explanation].filter(Boolean).join("\n\n");
    if (!response) return;

    navigator.clipboard.writeText(response);
    setIsResponseCopied(true);
    toast.success("Response copied");
    if (responseCopyResetTimeoutRef.current) clearTimeout(responseCopyResetTimeoutRef.current);
    responseCopyResetTimeoutRef.current = setTimeout(() => {
      setIsResponseCopied(false);
      responseCopyResetTimeoutRef.current = null;
    }, 2000);
  }, [cleaned, message.content, message.explanation]);

  return (
    <div className={cn(
      "flex w-full gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300",
      message.role === "user" ? "flex-row-reverse" : "flex-row"
    )}>
      {/* Avatar Icon */}
      <div className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-500",
        message.role === "user"
          ? "bg-primary/20 border-primary/30 text-primary"
          : "bg-card border-border text-muted-foreground"
      )}>
        {message.role === "user" ? <User className="h-3.5 w-3.5" /> : <BrainCircuit className="h-3.5 w-3.5" />}
      </div>

      <div className={cn(
        "group flex min-w-0 flex-col gap-1.5",
        message.role === "user"
          ? cn(message.action ? "max-w-[90%]" : "max-w-[78%]", "items-end")
          : "w-full flex-1 items-start ai-message",
      )}>
        {/* 1. Reasoning Section (Assistant only) */}
        {message.role === "assistant" && (message.thought || (message.steps && message.steps.length > 0)) && (
          <ReasoningSection
            thought={message.thought}
            steps={message.steps}
            showThought={isThoughtVisible}
            onToggle={handleToggleThought}
            isDark={isDark}
            isGeneratingSQL={Boolean(message.isStreaming) && !isError}
          />
        )}

        {/* 2. Primary Response Bubble */}
        {(showPrimaryBubble || message.role === "user") && (
          <div className={cn(
            "relative w-full rounded-xl p-2.5 text-[11px] leading-5 transition-all",
            message.role === "user"
              ? "ml-auto w-fit rounded-tr-md bg-primary text-primary-foreground shadow-sm"
              : isDark ? "border border-white/10 bg-card/70 shadow-sm" : "border border-slate-200 bg-white shadow-sm"
          )}>
            {message.role === "assistant" && (
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  {status ? (
                    <span className="flex items-center gap-1.5 truncate text-[10px] font-semibold text-primary/80">
                      <BrainCircuit className="h-3 w-3" /> {status}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <MessageSquare className="h-3 w-3" /> Assistant
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {shouldShowConfidence && <ConfidenceBadge score={score} />}
                  {canCopyResponse && (
                    <button
                      type="button"
                      onClick={handleCopyResponse}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={isResponseCopied ? "Response copied" : "Copy assistant response"}
                      title={isResponseCopied ? "Copied" : "Copy response"}
                    >
                      {isResponseCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clipboard className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div aria-live={message.isStreaming ? "polite" : undefined}>
              <MarkdownRenderer
                content={message.role === "user" ? message.content : (cleaned || message.content)}
                isDark={isDark}
                role={message.role}
                className={isError ? "text-destructive font-medium" : ""}
              />
            </div>

            {message.explanation && message.role === "assistant" && (
              <div className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-5 text-muted-foreground">
                <MarkdownRenderer
                  content={message.explanation}
                  isDark={isDark}
                  role="assistant"
                />
              </div>
            )}
          </div>
        )}

        {/* 3. Specialized Result Sections (SQL, Data, Analysis) */}
        {message.role === "assistant" && (
          <div className="w-full flex flex-col gap-2 mt-0.5">
            {(message.sql || message.queryText) && (
              <SQLBlock
                sql={message.queryText || message.sql || ""}
                queryLanguage={message.queryLanguage}
                isDark={isDark}
                onCopy={handleCopy}
                copied={isCopied}
                onExplain={onExplain}
                onOptimize={onOptimize}
              />
            )}

            {message.columns && message.data && message.data.length > 0 && (
              <DataTablePreview columns={message.columns} data={message.data} />
            )}

            {message.data && message.data.length === 0 && (
              <div className="rounded-lg border px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Truy vấn thành công, không có dữ liệu phù hợp.
              </div>
            )}

            {message.analysis && (
              <div className={cn(
                "rounded-xl border p-2.5 text-[11px] leading-5 shadow-sm",
                isDark ? "bg-card/70 border-white/10" : "bg-slate-50 border-slate-200"
              )}>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <FileSearch className="h-3.5 w-3.5" /> Detailed Analysis
                </div>
                <MarkdownRenderer
                  content={message.analysis}
                  isDark={isDark}
                  role="assistant"
                />
              </div>
            )}

            <ContextSources citations={message.citations} isDark={isDark} />
          </div>
        )}

        {/* 4. Feedback & Suggestions */}
        {message.role === "assistant" && (
          <div className="w-full">
            {message.content && !message.content.startsWith("Error:") && (
              <FeedbackSection
                feedbackSubmitted={isFeedbackSubmitted}
                feedbackRating={feedbackRating}
                showCorrection={shouldShowCorrection}
                correctionText={correctionText}
                onRating={handleFeedback}
                onCorrectionChange={handleCorrectionChange}
                onSubmitCorrection={handleSubmitCorrection}
              />
            )}

            <SuggestionList
              suggestions={message.suggestions || []}
              onSuggestionClick={onSuggestionClick || noopSuggestionClick}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const AIMessage = React.memo(AIMessageComponent);
AIMessage.displayName = "AIMessage";
