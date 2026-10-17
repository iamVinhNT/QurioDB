/**
 * @file ContextSources.tsx
 * @description Renders user-readable AI retrieval context sources without exposing raw RAG scoring noise.
 */

import React from "react";
import { Database, FileText } from "lucide-react";

import { cn } from "@/lib/utils";

import { AICitation } from "./types";
import { knowledgeDocumentPath } from "@/app/knowledge/routes";

interface ContextSourcesProps {
  citations?: AICitation[];
  isDark: boolean;
}

interface DisplaySource {
  href?: string;
  key: string;
  label: string;
  typeLabel: string;
  title: string;
  score?: number;
  reasons: string[];
  sourceType: string;
}

const SCHEMA_TITLE_PATTERN = /^\w+\s+schema$/i;

export function ContextSources({ citations = [], isDark }: ContextSourcesProps) {
  const sources = React.useMemo(() => buildDisplaySources(citations), [citations]);

  if (!sources.length) return null;

  return (
    <div
      className={cn(
        "rounded-lg border p-2 text-[11px] leading-5 shadow-sm",
        isDark ? "border-white/10 bg-card/70" : "border-slate-200 bg-white",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Database className="h-3.5 w-3.5 shrink-0" />
          Context used
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {sources.length} reference{sources.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => {
          const Icon = source.sourceType === "database_schema" ? Database : FileText;
          return (
            <span
              key={source.key}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={buildSourceTitle(source)}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{source.href ? <a className="underline" href={source.href}>{source.label}</a> : source.label}</span>
              <span className="rounded border border-border/60 px-1 text-[9px] uppercase tracking-widest text-muted-foreground/70">
                {source.typeLabel}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function buildDisplaySources(citations: AICitation[]): DisplaySource[] {
  const grouped = new Map<string, DisplaySource>();

  for (const citation of citations) {
    const label = sourceLabel(citation);
    if (!label) continue;

    const key = citation.revisionId ? `${citation.revisionId}:${citation.section}` : `${citation.sourceType}:${label}`;
    const current = grouped.get(key);
    const next: DisplaySource = {
      key,
      href: citation.documentId && citation.revisionId && citation.knowledgeBaseId
        ? knowledgeDocumentPath(citation.knowledgeBaseId, citation.documentId, citation)
        : undefined,
      label,
      typeLabel: sourceTypeLabel(citation.sourceType),
      title: citation.title,
      score: citation.score,
      reasons: citation.reasons || [],
      sourceType: citation.sourceType,
    };

    if (!current || Number(next.score || 0) > Number(current.score || 0)) {
      grouped.set(key, {
        ...next,
        reasons: mergeReasons(current?.reasons || [], next.reasons),
      });
    } else {
      current.reasons = mergeReasons(current.reasons, next.reasons);
    }
  }

  return Array.from(grouped.values()).slice(0, 6);
}

function sourceLabel(citation: AICitation) {
  if (citation.sourceType === "database_schema") {
    if (citation.objectName) {
      return citation.schemaName ? `${citation.schemaName}.${citation.objectName}` : citation.objectName;
    }

    if (citation.title && !SCHEMA_TITLE_PATTERN.test(citation.title)) {
      return citation.title;
    }

    return "";
  }

  return citation.objectName || citation.title || citation.id;
}

function sourceTypeLabel(sourceType: string) {
  switch (sourceType) {
    case "database_schema":
      return "schema";
    case "saved_query":
      return "query";
    case "query_history":
      return "history";
    case "knowledge_document":
      return "knowledge";
    case "document":
      return "doc";
    case "web_page":
      return "web";
    default:
      return "source";
  }
}

function mergeReasons(first: string[], second: string[]) {
  return Array.from(new Set([...first, ...second])).slice(0, 4);
}

function buildSourceTitle(source: DisplaySource) {
  const details = [
    source.title,
    source.reasons.length ? `Why: ${source.reasons.join(", ")}` : "",
    source.score !== undefined ? `Retrieval relevance: ${source.score.toFixed(4)}` : "",
  ].filter(Boolean);
  return details.join("\n");
}
