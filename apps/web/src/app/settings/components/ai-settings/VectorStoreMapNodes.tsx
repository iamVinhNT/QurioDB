/**
 * @file VectorStoreMapNodes.tsx
 * @description Custom node and inspector UI for the RAG vector store map.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Boxes, Database, FileText, Layers3, Waypoints } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  readableSourceType,
  type RagSource,
  type RagSourceDetail,
  type VectorStoreGraphNode,
  type VectorStoreGraphNodeData,
} from "./vector-store-map-graph";
import { parseServerTimestamp } from "./vector-store-overview";

export function RagVectorNode({ data, selected }: NodeProps<VectorStoreGraphNode>) {
  const Icon = nodeIcon(data.kind);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-background shadow-sm transition-colors",
        "flex flex-col justify-between gap-3 px-4 py-3",
        nodeSize(data.kind),
        nodeTone(data.kind, data.status),
        data.kind === "source" && "cursor-pointer",
        selected && "border-primary shadow-lg shadow-primary/15",
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", nodeAccent(data.kind, data.status))} />
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("shrink-0 rounded-md border p-1.5", nodeIconTone(data.kind, data.status))}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {data.meta || data.kind}
            </div>
            <div className="truncate text-[11px] font-semibold text-muted-foreground/90">
              {data.subtitle}
            </div>
          </div>
        </div>
        {typeof data.count === "number" ? (
          <span className="shrink-0 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] font-black tabular-nums">
            {data.count}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 pl-0.5">
        <div
          className="overflow-hidden text-[14px] font-black leading-snug break-words"
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
          title={data.label}
        >
          {data.label}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border/40 pt-2">
        <Badge variant="secondary" className="min-w-0 max-w-full truncate rounded-md px-2 py-0.5 text-[10px] font-bold">
          {data.status || "ready"}
        </Badge>
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

export function SourceInspector({
  source,
  detail,
  databaseLabels = {},
  isLoading,
}: {
  source: RagSource;
  detail?: RagSourceDetail;
  databaseLabels?: Record<string, string>;
  isLoading?: boolean;
}) {
  const databaseLabel = source.databaseId
    ? databaseLabels[source.databaseId] || source.databaseId
    : "global";
  const indexedOn = parseServerTimestamp(source.indexed_on);

  return (
    <div className="space-y-4 rounded-lg border border-border/50 bg-background/70 p-4">
      <div className="min-w-0">
        <div className="break-words text-base font-bold leading-snug">{source.title}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-md text-[10px] font-bold">{source.status}</Badge>
          <Badge variant="secondary" className="rounded-md text-[10px] font-bold">{readableSourceType(source.sourceType)}</Badge>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2.5 text-sm">
        <InspectorRow label="Database" value={databaseLabel} />
        <InspectorRow label="Access" value={source.accessScope || "database"} />
        <InspectorRow label="Indexed" value={indexedOn ? indexedOn.toLocaleString() : "pending"} />
        <InspectorRow label="Chunks" value={isLoading ? "loading" : String(detail?.chunkCount ?? detail?.chunks?.length ?? 0)} />
      </dl>
      {detail?.chunks?.length ? (
        <div className="space-y-1.5">
          {detail.chunks.slice(0, 6).map((chunk) => (
            <div key={chunk.id} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
              <div className="break-words text-xs font-semibold leading-snug">
                {chunk.objectName || chunk.metadata?.citation || `Chunk ${Number(chunk.ordinal || 0) + 1}`}
              </div>
              <div className="mt-1 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                {chunk.chunkType} / {chunk.tokenCount || 0} tokens
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function sourceTypeCounts(sources: RagSource[]) {
  const counts = sources.reduce<Record<string, number>>((result, source) => {
    result[source.sourceType] = (result[source.sourceType] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count);
}

export function miniMapColor(kind: VectorStoreGraphNodeData["kind"]) {
  switch (kind) {
    case "backend":
      return "#10b981";
    case "pipelineStage":
      return "#3b82f6";
    case "sourceGroup":
      return "#a855f7";
    case "source":
      return "#14b8a6";
    case "chunk":
      return "#f59e0b";
    default:
      return "#94a3b8";
  }
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-semibold">{value}</dd>
    </div>
  );
}

function nodeTone(kind: VectorStoreGraphNodeData["kind"], status?: string) {
  if (status === "disabled" || status === "failed") {
    return "border-destructive/40 bg-destructive/5";
  }
  if (status === "mixed" || String(status || "").includes("tokens")) {
    return "border-amber-500/30 bg-amber-500/5";
  }
  if (kind === "backend" || status === "indexed" || status === "enabled") {
    return "border-emerald-500/30 bg-emerald-500/5";
  }
  if (kind === "pipelineStage") {
    return "border-blue-500/30 bg-blue-500/5";
  }
  return "border-border/60";
}

function nodeSize(kind: VectorStoreGraphNodeData["kind"]) {
  switch (kind) {
    case "backend":
      return "h-[132px] w-[300px]";
    case "pipelineStage":
      return "h-[128px] w-[320px]";
    case "sourceGroup":
      return "h-[128px] w-[300px]";
    case "source":
      return "h-[136px] w-[360px]";
    case "chunk":
      return "h-[126px] w-[380px]";
    default:
      return "h-[132px] w-[320px]";
  }
}

function nodeIcon(kind: VectorStoreGraphNodeData["kind"]) {
  switch (kind) {
    case "backend":
      return Database;
    case "pipelineStage":
      return Waypoints;
    case "sourceGroup":
      return Layers3;
    case "source":
      return FileText;
    case "chunk":
      return Boxes;
    default:
      return FileText;
  }
}

function nodeAccent(kind: VectorStoreGraphNodeData["kind"], status?: string) {
  if (status === "disabled" || status === "failed") return "bg-destructive";
  if (kind === "chunk" || status === "mixed" || String(status || "").includes("tokens")) return "bg-amber-500";
  if (kind === "pipelineStage") return "bg-blue-500";
  if (kind === "sourceGroup") return "bg-cyan-500";
  return "bg-emerald-500";
}

function nodeIconTone(kind: VectorStoreGraphNodeData["kind"], status?: string) {
  if (status === "disabled" || status === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (kind === "chunk" || status === "mixed" || String(status || "").includes("tokens")) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600";
  }
  if (kind === "pipelineStage") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-600";
  }
  if (kind === "sourceGroup") {
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-600";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600";
}
