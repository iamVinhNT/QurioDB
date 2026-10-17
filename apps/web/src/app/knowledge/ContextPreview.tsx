/** @file ContextPreview.tsx @description Retrieval-only diagnostics and a question handoff that never executes SQL. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { knowledgeApi } from "@/lib/knowledge-api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, ErrorMessage } from "./controls";
import { Markdown } from "./Markdown";
import type { KnowledgeBase } from "./types";
import { knowledgeDocumentPath } from "./routes";
export function ContextPreview({ base }: { base: KnowledgeBase }) {
  const [schema, setSchema] = useState("public");
  const [question, setQuestion] = useState("");
  const preview = useMutation({
    mutationFn: () => knowledgeApi.preview(base.id, question, schema),
  });
  const data = preview.data;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Thử context</h2>
      <p className="text-sm text-muted-foreground">
        Chỉ truy hồi bằng chứng; không sinh hoặc thực thi SQL. Hybrid có thể gửi
        câu hỏi đến Google embedding theo cấu hình AI Assistant.
      </p>
      {!base.enabledForSql && (
        <p className="rounded border p-3 text-sm">
          Kho đang tắt cho SQL. Preview chỉ có schema; bật kho để thử tài liệu
          đã xuất bản.
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          preview.mutate();
        }}
      >
        <Field label="Schema">
          <Input
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            required
          />
        </Field>
        <Field label="Câu hỏi SQL">
          <Textarea
            value={question}
            rows={3}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={4000}
          />
        </Field>
        <Button
          disabled={preview.isPending || !question.trim() || !schema.trim()}
        >
          {preview.isPending ? "Đang truy hồi…" : "Thử context"}
        </Button>
      </form>
      <ErrorMessage error={preview.error} />
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            Truy hồi:{" "}
            {data.retrievalTrace?.retrievalMode === "lexical_fallback"
              ? "lexical fallback"
              : data.retrievalTrace?.retrievalMode || "lexical"}{" "}
            · Embedding: {data.embeddingProvider} / {data.embeddingModel} ·
            Graph: {data.graph.enabled ? "bật" : "tắt"} · Không thực thi SQL
          </p>
          {data.warnings.length > 0 && (
            <div
              role="alert"
              className="rounded border border-amber-500/50 p-3 text-sm"
            >
              <p className="font-medium">Cần bổ sung hoặc làm rõ bằng chứng</p>
              <ul className="list-inside list-disc">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {data.items.length === 0 && <p>Chưa tìm thấy bằng chứng phù hợp.</p>}
          {data.items.map((item, i) => (
            <article
              key={item.citation?.id || i}
              className="space-y-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-medium">{item.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {item.sourceType}
                </span>
              </div>
              <Markdown body={item.content} />
              {item.citation?.documentId && item.citation.knowledgeBaseId && (
                <Link
                  className="text-sm underline"
                  to={knowledgeDocumentPath(item.citation.knowledgeBaseId, item.citation.documentId, {
                    revisionId: item.citation.revisionId,
                    section: item.citation.section,
                  })}
                >
                  Mở đúng phiên bản và đoạn trích
                </Link>
              )}
            </article>
          ))}
          <Button asChild variant="outline">
            <Link
              to="/sqllab"
              state={{
                knowledgeQuestion: question,
                databaseId: base.databaseId,
                schemaName: schema,
              }}
            >
              Chuyển câu hỏi sang SQL Lab
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            SQL Lab dùng các kho đã bật của connection. Bạn kiểm tra câu hỏi rồi
            chọn gửi.
          </p>
        </>
      )}
    </div>
  );
}
