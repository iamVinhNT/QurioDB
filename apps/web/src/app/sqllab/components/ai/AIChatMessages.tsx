/**
 * @file AIChatMessages.tsx
 * @description Renders the list of AI chat messages with virtualization and loading states.
 * Committed history is rendered through a bounded virtualized window; the live
 * streaming message is rendered as the tail virtual item with a stable key so
 * it never remounts when the stream commits. Streaming chunks therefore only
 * re-render the streaming message, never the committed list.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { AIMessage, type MessageUiState } from "./AIMessage";
import { Message } from "./types";

interface AIChatMessagesProps {
  messages: Message[];
  streamingMessage?: Message | null;
  isTyping: boolean;
  isFetchingConversation: boolean;
  parentRef: React.RefObject<HTMLDivElement | null>;
  conversationId?: string | null;
  onExplain: (sql: string) => void;
  onOptimize: (sql: string) => void;
  onSuggestionClick: (suggestion: string) => void;
}

// Initial per-message height used until the dynamic measurement lands.
const ESTIMATED_MESSAGE_HEIGHT = 140;
const ESTIMATED_STREAMING_HEIGHT = 64;
const MESSAGE_GAP_PX = 12;
const OVERSCAN = 6;

// Per-message UI state (expanded reasoning, feedback, SQL previews) is kept in
// a keyed map on the parent so rows that scroll out of the virtualized window
// do not lose it. The map is pruned to messages still in the list and
// additionally hard-capped so it stays bounded.
const MAX_PRESERVED_MESSAGE_UI_STATES = 200;

const AIChatMessagesComponent = ({
  messages,
  streamingMessage,
  isTyping,
  isFetchingConversation,
  parentRef,
  conversationId,
  onExplain,
  onOptimize,
  onSuggestionClick
}: AIChatMessagesProps) => {
  // The streaming message is the tail item of the same virtualized list; its
  // key equals the committed message id so the row survives the commit.
  const itemCount = messages.length + (streamingMessage ? 1 : 0);

  const messageUiStateRef = useRef(new Map<string, Partial<MessageUiState>>());

  const persistMessageUiState = useCallback((id: string, patch: Partial<MessageUiState>) => {
    const map = messageUiStateRef.current;
    map.set(id, { ...map.get(id), ...patch });
    if (map.size > MAX_PRESERVED_MESSAGE_UI_STATES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) map.delete(oldestKey);
    }
  }, []);

  // Drop state for messages that no longer exist (conversation switches) so
  // the map cannot grow beyond the current conversation size.
  useEffect(() => {
    const alive = new Set(messages.map((message) => message.id));
    const map = messageUiStateRef.current;
    for (const id of Array.from(map.keys())) {
      if (!alive.has(id)) map.delete(id);
    }
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      streamingMessage && index === messages.length
        ? ESTIMATED_STREAMING_HEIGHT
        : ESTIMATED_MESSAGE_HEIGHT,
    overscan: OVERSCAN,
    gap: MESSAGE_GAP_PX,
    getItemKey: (index) => {
      if (index < messages.length) return messages[index].id;
      return streamingMessage?.id ?? `stream-${index}`;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto scroll-smooth px-2 py-3 scrollbar-thin scrollbar-thumb-muted focus:outline-none md:px-3"
    >
      <div className="flex w-full flex-col">
        {isFetchingConversation ? (
          <div className="flex flex-col gap-4 w-full animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className={cn("flex gap-2 w-full", i % 2 === 0 ? "flex-row-reverse" : "flex-row")}>
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className={cn("flex flex-col gap-1.5 w-[80%]", i % 2 === 0 ? "items-end" : "items-start")}>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className={cn("h-20 w-full rounded-2xl", i % 2 === 0 ? "rounded-tr-none" : "rounded-tl-none")} />
                  {i % 2 !== 0 && <Skeleton className="h-32 w-full rounded-xl mt-1" />}
                </div>
              </div>
            ))}
          </div>
        ) : itemCount > 0 ? (
          <div
            className="relative w-full"
            style={{ height: `${totalSize}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const index = virtualRow.index;
              const message = index < messages.length ? messages[index] : streamingMessage;
              if (!message) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={index}
                  data-testid="ai-message-row"
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  ref={virtualizer.measureElement}
                >
                  <AIMessage
                    message={message}
                    onExplain={onExplain}
                    onOptimize={onOptimize}
                    onSuggestionClick={onSuggestionClick}
                    conversationId={conversationId}
                    messageUiState={messageUiStateRef.current.get(message.id)}
                    onMessageUiStateChange={persistMessageUiState}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {itemCount === 0 && !isTyping && !isFetchingConversation && (
          <div className="mt-8 flex min-h-56 w-full select-none flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/15 p-4 text-center">
            <Sparkles className="mb-3 h-10 w-10 text-primary/70" />
            <h2 className="text-lg font-black tracking-tight">Start with a data question</h2>
            <p className="mt-1.5 max-w-md text-xs leading-5 text-muted-foreground">
              Ask for SQL, chart-ready queries, explanations, optimization, or a result interpretation.
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-muted-foreground">
              <kbd className="px-2 py-0.5 rounded border border-border/50 bg-muted/50 text-[10px] font-mono font-bold">/</kbd>
              <span className="text-[10px] uppercase tracking-widest font-bold">for quick commands</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const AIChatMessages = React.memo(AIChatMessagesComponent);
AIChatMessages.displayName = "AIChatMessages";
