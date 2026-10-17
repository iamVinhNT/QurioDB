/**
 * @file VectorStoreMapNodes.tsx
 * @description Custom node and inspector UI for the RAG vector store map.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Boxes, Database, FileText, Layers3, Waypoints } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  VectorStoreGraphNode,
  VectorStoreGraphNodeData,
} from "./vector-store-map-graph";

export function RagVectorNode({
  data,
  selected,
}: NodeProps<VectorStoreGraphNode>) {
  const Icon = nodeIcon(data.kind);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-background shadow-sm transition-colors",
        "flex flex-col justify-between gap-1 px-3 py-2",
        nodeSize(data.kind),
        nodeTone(data.kind, data.status),
        data.kind === "source" && "cursor-pointer",
        selected && "border-primary shadow-lg shadow-primary/15",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          nodeAccent(data.kind, data.status),
        )}
      />
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "shrink-0 rounded-md border p-1.5",
              nodeIconTone(data.kind, data.status),
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-medium text-muted-foreground">
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
          className="overflow-hidden text-sm font-semibold leading-snug break-words"
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 1,
          }}
          title={data.label}
        >
          {data.label}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border/40 pt-1">
        <Badge
          variant="secondary"
          className="min-w-0 max-w-full truncate rounded-md px-2 py-0.5 text-[10px] font-bold"
        >
          {data.status || "ready"}
        </Badge>
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
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
      return "h-[108px] w-[240px]";
    case "pipelineStage":
      return "h-[128px] w-[320px]";
    case "sourceGroup":
      return "h-[108px] w-[240px]";
    case "source":
      return "h-[112px] w-[280px]";
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
  if (
    kind === "chunk" ||
    status === "mixed" ||
    String(status || "").includes("tokens")
  )
    return "bg-amber-500";
  if (kind === "pipelineStage") return "bg-blue-500";
  if (kind === "sourceGroup") return "bg-cyan-500";
  return "bg-emerald-500";
}

function nodeIconTone(kind: VectorStoreGraphNodeData["kind"], status?: string) {
  if (status === "disabled" || status === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (
    kind === "chunk" ||
    status === "mixed" ||
    String(status || "").includes("tokens")
  ) {
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
