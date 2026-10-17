/** @file GraphView.tsx @description Lazy, read-only graph projection of a bounded authorized neighborhood. */
import { useMemo, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResult } from "./types";
export default function GraphView({
  graph,
  onFocus,
}: {
  graph: GraphResult;
  onFocus: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  useEffect(() => {
    if (!container.current || !instance) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void instance.fitView({ padding: 0.15, duration: 0 });
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [instance]);
  const nodes = useMemo(
    () =>
      graph.nodes.map((n, i) => ({
        id: n.id,
        data: { label: n.label },
        position: { x: (i % 4) * 260, y: Math.floor(i / 4) * 110 },
        style: {
          background: "var(--background)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          fontSize: 12,
          width: 220,
        },
      })),
    [graph.nodes],
  );
  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.relation,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#64748b" },
        labelStyle: { fontSize: 10, fill: "var(--foreground)" },
        labelBgStyle: { fill: "var(--background)" },
      })),
    [graph.edges],
  );
  return (
    <div
      ref={container}
      className="h-[480px] rounded-lg border"
      role="region"
      aria-label="Đồ thị quan hệ"
    >
      <ReactFlow
        onInit={setInstance}
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => onFocus(node.id)}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
