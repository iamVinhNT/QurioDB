/** @file DocumentEditor.tsx @description Versioned Markdown editing, explicit publication and immutable evidence history. */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useSearchParams, useLocation } from "react-router-dom";
import { knowledgeApi } from "@/lib/knowledge-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, Input, Select, ErrorMessage } from "./controls";
import { RevisionPanel } from "./RevisionPanel";
import { MarkdownEditor } from "./MarkdownEditor";
import { DefinitionEditor } from "./DefinitionEditor";
import { templates } from "./templates";
import type { KnowledgeDocument, DocumentKind } from "./types";

export function exportMarkdown(title: string, body: string) {
  const url = URL.createObjectURL(
    new Blob([body], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useDraftGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (
        anchor &&
        anchor.href !== window.location.href &&
        !window.confirm("Bản nháp chưa lưu. Rời màn này?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
}
export function DocumentEditor({
  documentId,
  databaseId,
  knowledgeBaseId,
  onArchived,
}: {
  documentId: string;
  knowledgeBaseId: string;
  databaseId: string;
  onArchived: () => void;
}) {
  const query = useQuery({
    queryKey: ["knowledge-document", documentId],
    queryFn: () => knowledgeApi.document(documentId),
  });
  if (query.isPending) return <p role="status">Đang tải tài liệu…</p>;
  if (query.error) return <ErrorMessage error={query.error} />;
  if (query.data.knowledgeBaseId !== knowledgeBaseId)
    return <ErrorMessage error={new Error("Tài liệu không thuộc kho này.")} />;
  return (
    <Editor
      key={documentId}
      initial={query.data}
      databaseId={databaseId}
      onArchived={onArchived}
    />
  );
}
function Editor({
  initial,
  databaseId,
  onArchived,
}: {
  initial: KnowledgeDocument;
  databaseId: string;
  onArchived: () => void;
}) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [tab, setTab] = useState("markdown");
  const [lexical, setLexical] = useState(true);
  const [jobId, setJobId] = useState(initial.job?.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useDraftGuard(dirty);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["knowledge-documents"] });
    void client.invalidateQueries({
      queryKey: ["knowledge-revisions", draft.id],
    });
    void client.invalidateQueries({ queryKey: ["knowledge-graph"] });
  };
  const save = useMutation({
    mutationFn: () => knowledgeApi.save(draft),
    onSuccess: (doc) => {
      setDraft(doc);
      setSaved(doc);
      refresh();
    },
  });
  const publish = useMutation({
    mutationFn: () => knowledgeApi.publish(draft, lexical),
    onSuccess: (job) => {
      setJobId(job.id);
      void client.invalidateQueries({ queryKey: ["knowledge-job", job.id] });
    },
  });
  const job = useQuery({
    queryKey: ["knowledge-job", jobId],
    queryFn: () => knowledgeApi.job(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.status || "") ? 1000 : false,
  });
  useEffect(() => {
    if (job.data?.status === "succeeded") {
      refresh();
      void client.invalidateQueries({
        queryKey: ["knowledge-document", draft.id],
      });
      void knowledgeApi.document(draft.id).then((doc) => {
        setSaved((previous) => ({
          ...previous,
          activeRevisionId: doc.activeRevisionId,
        }));
        setDraft((previous) => ({
          ...previous,
          activeRevisionId: doc.activeRevisionId,
        }));
      });
    }
  }, [job.data?.status, job.data?.id]);
  const revisions = useQuery({
    queryKey: ["knowledge-revisions", draft.id],
    queryFn: () => knowledgeApi.revisions(draft.id),
  });
  const revisionId = params.get("revision");
  const revision = useQuery({
    queryKey: ["knowledge-revision", draft.id, revisionId],
    queryFn: () => knowledgeApi.revision(draft.id, revisionId!),
    enabled: !!revisionId,
  });
  useEffect(() => {
    if (revision.data && location.hash) {
      document
        .getElementById(decodeURIComponent(location.hash.slice(1)))
        ?.scrollIntoView({ block: "start" });
    }
  }, [revision.data, location.hash]);
  const remove = useMutation({
    mutationFn: (archive: boolean) => knowledgeApi.remove(draft.id, archive),
    onSuccess: (_, archive) => {
      refresh();
      if (archive) onArchived();
      else {
        void knowledgeApi.document(draft.id).then((doc) => {
          setDraft(doc);
          setSaved(doc);
          setJobId(undefined);
        });
      }
    },
  });
  const pending =
    save.isPending ||
    publish.isPending ||
    remove.isPending ||
    ["queued", "running"].includes(job.data?.status || "");
  const update = (patch: Partial<KnowledgeDocument>) =>
    setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Tài liệu · bản nháp v{draft.version}
            {dirty ? " · chưa lưu" : " · đã lưu"}
          </p>
          <p className="text-sm">
            {draft.activeRevisionId
              ? `AI đang dùng bản xuất bản v${revisions.data?.find((revision) => revision.id === draft.activeRevisionId)?.version ?? "…"}`
              : "Chưa có bản xuất bản"}
            {job.data && ` · Index: ${job.data.status} (${job.data.mode})`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportMarkdown(draft.title, draft.bodyMarkdown)}
          >
            Export .md
          </Button>
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() => save.mutate()}
          >
            Lưu nháp
          </Button>
        </div>
      </div>
      <ErrorMessage
        error={save.error || publish.error || remove.error || job.error}
      />
      {(save.error as Error & { status?: number })?.status === 409 && (
        <div className="rounded border p-3 text-sm">
          Tài liệu đã thay đổi ở phiên khác. Export bản đang soạn trước khi tải
          lại.
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              if (
                window.confirm(
                  "Tải phiên bản mới sẽ bỏ các sửa đổi chưa lưu. Tiếp tục?",
                )
              )
                void knowledgeApi.document(draft.id).then((doc) => {
                  setDraft(doc);
                  setSaved(doc);
                  save.reset();
                });
            }}
          >
            Tải bản mới
          </Button>
        </div>
      )}
      {job.data?.error && (
        <p
          role="alert"
          className="rounded border border-destructive/40 p-3 text-sm"
        >
          {job.data.error} Bản đã xuất bản trước vẫn được giữ.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Tiêu đề">
          <Input
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field label="Loại tài liệu">
          <Select
            value={draft.kind}
            onChange={(e) => update({ kind: e.target.value as DocumentKind })}
          >
            {Object.keys(templates).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div
        role="tablist"
        aria-label="Nội dung tài liệu"
        className="flex flex-wrap gap-1 border-b pb-2"
      >
        {[
          ["markdown", "Markdown"],
          ["definitions", "Định nghĩa & liên kết"],
          ["history", "Lịch sử"],
        ].map(([id, name]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            size="sm"
            variant={tab === id ? "secondary" : "ghost"}
            onClick={() => setTab(id)}
          >
            {name}
          </Button>
        ))}
      </div>
      {revisionId ? (
        <RevisionPanel revision={revision} onBack={() => setParams({})} />
      ) : (
        <>
          {tab === "markdown" && (
            <MarkdownEditor
              body={draft.bodyMarkdown}
              onChange={(bodyMarkdown) => update({ bodyMarkdown })}
            />
          )}
          {tab === "definitions" && (
            <DefinitionEditor
              databaseId={databaseId}
              data={draft.definitionData}
              onChange={(definitionData) => update({ definitionData })}
            />
          )}
          {tab === "history" && (
            <section className="space-y-2">
              <ErrorMessage error={revisions.error} />
              {!revisions.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Chưa có phiên bản xuất bản.
                </p>
              )}
              {revisions.data?.map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full flex-wrap justify-between rounded border p-3 text-left text-sm hover:bg-muted"
                  onClick={() => setParams({ revision: r.id })}
                >
                  <span>
                    v{r.version} · {r.title}
                    {r.id === draft.activeRevisionId ? " · AI đang dùng" : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(r.created_on).toLocaleString()}
                  </span>
                </Button>
              ))}
            </section>
          )}
        </>
      )}
      <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <h3 className="font-semibold">Xuất bản cho AI</h3>
        <p className="text-sm text-muted-foreground">
          Chỉ bản xuất bản thành công mới vào context khi kho đã bật cho SQL.
          Lưu nháp không gọi provider. Hybrid gửi nội dung đã che dữ liệu nhạy
          cảm tới Google embedding theo cấu hình AI Assistant; lexical dùng nội
          dung local.
        </p>
        <Label className="flex items-center gap-2 text-sm" htmlFor="knowledge-lexical-mode">
          <Checkbox
            id="knowledge-lexical-mode"
            checked={lexical}
            onCheckedChange={(checked) => setLexical(checked === true)}
          />
          Lexical + graph, không gửi nội dung để tạo embedding
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={dirty || pending || !draft.bodyMarkdown.trim()}
            onClick={() => publish.mutate()}
          >
            {job.data?.status === "failed"
              ? "Thử xuất bản lại"
              : "Xuất bản cho AI"}
          </Button>
          <Button
            variant="outline"
            disabled={dirty || pending || !draft.activeRevisionId}
            onClick={() => {
              if (window.confirm("Gỡ bản đang xuất bản khỏi context AI?"))
                remove.mutate(false);
            }}
          >
            Gỡ xuất bản
          </Button>
          <Button
            variant="ghost"
            disabled={dirty || pending}
            onClick={() => {
              if (window.confirm("Lưu trữ tài liệu và gỡ khỏi context AI?"))
                remove.mutate(true);
            }}
          >
            Lưu trữ
          </Button>
        </div>
        {dirty && (
          <p className="text-sm text-muted-foreground">
            Lưu nháp trước khi xuất bản.
          </p>
        )}
      </section>
    </div>
  );
}
