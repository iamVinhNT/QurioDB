/**
 * @file VectorStoreSourceInspector.tsx
 * @description Shared source details with searchable, paginated chunks for the source sheet and map inspector.
 */

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RagSource, RagSourceDetail } from "./vector-store-map-graph";
import {
  parseServerTimestamp,
  readableSourceType,
} from "./vector-store-overview";

const PAGE_SIZE = 10;

export function SourceInspector({
  source,
  detail,
  databaseLabels = {},
  isLoading,
  hasError,
  onRetry,
}: {
  source: RagSource;
  detail?: RagSourceDetail;
  databaseLabels?: Record<string, string>;
  isLoading?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const changePage = (nextPage: number) => {
    setPage(nextPage);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const chunks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (detail?.chunks || []).filter(
      (chunk) =>
        !needle ||
        `${chunk.objectName || ""} ${chunk.schemaName || ""} ${chunk.chunkType} ${chunk.metadata?.citation || ""}`
          .toLowerCase()
          .includes(needle),
    );
  }, [detail, search]);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(chunks.length / PAGE_SIZE) - 1),
  );
  const start = currentPage * PAGE_SIZE;
  const indexedOn = parseServerTimestamp(source.indexed_on);
  const databaseLabel = source.databaseId
    ? databaseLabels[source.databaseId] || "Removed connection"
    : "Shared knowledge";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h4
            className="min-w-0 flex-1 truncate text-sm font-semibold"
            title={source.title}
          >
            {source.title}
          </h4>
          <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
            {source.status}
          </Badge>
        </div>
        <details className="group text-xs">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-2 text-muted-foreground [&::-webkit-details-marker]:hidden"
            aria-label="Source information"
          >
            <span className="truncate" title={databaseLabel}>
              {databaseLabel}
            </span>
            <span className="shrink-0 underline-offset-4 group-open:underline">
              Info
            </span>
          </summary>
          <dl className="mt-2 max-h-28 space-y-2 overflow-y-auto rounded-md bg-muted/30 p-2">
            <InspectorRow
              label="Type"
              value={readableSourceType(source.sourceType)}
            />
            <InspectorRow
              label="Access"
              value={source.accessScope || "database"}
            />
            <InspectorRow
              label="Indexed"
              value={indexedOn ? indexedOn.toLocaleString() : "Not indexed yet"}
            />
            <InspectorRow
              label="Chunks"
              value={
                detail
                  ? String(detail.chunkCount ?? detail.chunks?.length ?? 0)
                  : "Unavailable"
              }
            />
          </dl>
        </details>
        {detail ? (
          <Input
            aria-label="Search chunks"
            placeholder="Find a table or chunk…"
            className="h-8"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              changePage(0);
            }}
          />
        ) : null}
      </div>
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        aria-label="Source detail content"
      >
        {hasError ? (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/30 p-3 text-xs text-destructive"
          >
            <p>Source details could not be loaded.</p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {isLoading && !detail ? (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading source details…
          </div>
        ) : null}
        {detail ? (
          <section aria-label="Source chunks">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-1.5">
              {chunks.slice(start, start + PAGE_SIZE).map((chunk) => (
                <div
                  key={chunk.id}
                  className="rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                >
                  <div className="break-words text-xs font-medium">
                    {chunk.objectName ||
                      chunk.metadata?.citation ||
                      `Chunk ${Number(chunk.ordinal || 0) + 1}`}
                  </div>
                  <div className="mt-1 break-words text-[11px] text-muted-foreground">
                    {[
                      chunk.schemaName,
                      chunk.chunkType,
                      `${chunk.tokenCount || 0} tokens`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
              {!chunks.length ? (
                <p className="py-3 text-xs text-muted-foreground">
                  {search
                    ? "No chunks match this search."
                    : "No chunks have been indexed for this source."}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
      {detail ? (
        <nav
          aria-label="Chunk pagination"
          className="flex shrink-0 items-center justify-between gap-2 border-t border-border/50 bg-background px-3 py-2"
        >
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Previous chunks"
            aria-label="Previous chunks"
            disabled={currentPage === 0}
            onClick={() => changePage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p
            className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground"
            aria-live="polite"
          >
            {chunks.length
              ? `${start + 1}–${Math.min(start + PAGE_SIZE, chunks.length)} of ${chunks.length}`
              : "0"}{" "}
            chunks{search ? " matching your search" : ""}
          </p>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Next chunks"
            aria-label="Next chunks"
            disabled={start + PAGE_SIZE >= chunks.length}
            onClick={() => changePage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}
