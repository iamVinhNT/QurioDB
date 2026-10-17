/** @file Relations.tsx @description Paginated schema/business evidence inspection with an optional lazy graph. */
import { lazy, Suspense, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { knowledgeApi } from "@/lib/knowledge-api";
import { knowledgeDocumentPath } from "./routes";
import { Button } from "@/components/ui/button";
import { Field, Input, ErrorMessage } from "./controls";
import type { KnowledgeBase } from "./types";
const GraphView = lazy(() => import("./GraphView"));
export function Relations({ base }: { base: KnowledgeBase }) {
  const client = useQueryClient();
  const [schema, setSchema] = useState("");
  const [focus, setFocus] = useState("");
  const [offset, setOffset] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const graph = useQuery({
    queryKey: ["knowledge-graph", base.id, schema, focus, offset],
    queryFn: () =>
      knowledgeApi.graph(base.databaseId, base.id, {
        ...(schema ? { schemaName: schema } : {}),
        ...(focus ? { focus } : {}),
        offset,
        limit: 100,
      }),
  });
  const sync = useMutation({
    mutationFn: () => knowledgeApi.sync(base.id, schema),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["knowledge-graph"] }),
  });
  const nodes = new Map(graph.data?.nodes.map((n) => [n.id, n]));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Quan hệ và bằng chứng</h2>
        <p className="text-sm text-muted-foreground">
          Metadata/FK và quan hệ từ phiên bản đang dùng. Click node để xem lân
          cận. Kho tắt cho SQL không đưa quan hệ tài liệu vào graph.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Schema (để trống xem tất cả)">
          <Input
            value={schema}
            onChange={(e) => {
              setSchema(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Button
          variant="outline"
          disabled={!schema || sync.isPending}
          onClick={() => sync.mutate()}
        >
          Đồng bộ schema
        </Button>
        <Button variant="outline" onClick={() => setShowGraph(!showGraph)}>
          {showGraph ? "Ẩn graph" : "Mở graph"}
        </Button>
        {focus && (
          <Button
            variant="ghost"
            onClick={() => {
              setFocus("");
              setOffset(0);
            }}
          >
            Bỏ focus
          </Button>
        )}
      </div>
      <ErrorMessage error={graph.error || sync.error} />
      {graph.isPending && <p role="status">Đang tải quan hệ…</p>}
      {sync.isSuccess && (
        <p role="status" className="text-sm">
          Đã đồng bộ metadata thành công.
        </p>
      )}
      {showGraph && graph.data && (
        <Suspense fallback={<p role="status">Đang tải graph…</p>}>
          <GraphView
            graph={graph.data}
            onFocus={(id) => {
              setFocus(id);
              setOffset(0);
            }}
          />
        </Suspense>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
        <section className="space-y-2">
          <h3 className="font-medium">Đối tượng ({graph.data?.total || 0})</h3>
          {graph.data?.nodes.map((n) => (
            <Button
              key={n.id}
              type="button"
              variant="ghost"
              onClick={() => {
                setFocus(n.id);
                setOffset(0);
              }}
              className="h-auto w-full justify-start break-all rounded border p-2 text-left text-sm hover:bg-muted"
            >
              <span className="mr-2 text-xs text-muted-foreground">
                {n.nodeType}
              </span>
              {n.label}
            </Button>
          ))}
          {!graph.data?.nodes.length && (
            <p className="text-sm text-muted-foreground">
              Chưa có đối tượng. Chọn schema và đồng bộ, hoặc xuất bản tài liệu
              có liên kết.
            </p>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">Quan hệ trong trang</h3>
          {graph.data?.edges.map((e) => (
            <article
              key={e.id}
              className="space-y-2 rounded border p-3 text-sm"
            >
              <p className="break-all">
                {nodes.get(e.sourceId)?.label} → {nodes.get(e.targetId)?.label}
              </p>
              <p className="font-medium">{e.relation}</p>
              <pre className="overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(e.payloadJson, null, 2)}
              </pre>
              {graph.data.evidence
                .filter((v) => v.edgeId === e.id)
                .map((v) => (
                  <p
                    key={v.id}
                    className="break-all text-xs text-muted-foreground"
                  >
                    {v.revisionId && v.documentId && v.knowledgeBaseId ? (
                      <Link
                        className="underline"
                        to={knowledgeDocumentPath(v.knowledgeBaseId, v.documentId, {
                          revisionId: v.revisionId,
                          section: v.section,
                        })}
                      >
                        Bản tài liệu {v.revisionId.slice(0, 8)}
                      </Link>
                    ) : (
                      <>Metadata snapshot {v.snapshotHash?.slice(0, 12)}</>
                    )}
                  </p>
                ))}
            </article>
          ))}
        </section>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Trang trước
        </Button>
        <span className="text-sm">
          {offset + 1}–{offset + (graph.data?.nodes.length || 0)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!graph.data?.truncated}
          onClick={() => setOffset(offset + 100)}
        >
          Trang sau
        </Button>
      </div>
      {graph.data?.truncated && (
        <p className="text-sm text-muted-foreground">
          Graph đang hiển thị một phần. Focus đối tượng để xem đủ lân cận của
          nó.
        </p>
      )}
    </div>
  );
}
